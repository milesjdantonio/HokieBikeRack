// Emulated hardware for the firmware model (firmware/model/README.md).
//
// This file plays the part of the ESP32 chip and everything wired to it: the clock, GPIO pins,
// the serial port, the I2C bus with an MPU-6050 and a PN532 on it, the servo signal, flash
// storage, Wi-Fi, internet time and FreeRTOS. Each piece follows the datasheet or the real
// library, so the firmware in src/ can run on it unchanged. It decides nothing about the rack.
#include "hw.h"

#include <emscripten/emscripten.h>
#include <emscripten/heap.h>
#include <malloc.h>
#include <setjmp.h>
#include <time.h>
#include <unistd.h>

#include "Adafruit_PN532.h"
#include "Arduino.h"
#include "ESP32Servo.h"
#include "HTTPClient.h"
#include "LittleFS.h"
#include "WiFi.h"
#include "Wire.h"
#include "esp_random.h"
#include "esp_sntp.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "mbedtls/md.h"

// ---- calls into the page (frontend/model/rack-model.js sets Module.hooks) ----
EM_JS(void, js_accel, (double ms, float *out), {
  const a = Module.hooks && Module.hooks.accel ? Module.hooks.accel(ms) : [0, 0, 1];
  HEAPF32[out >> 2] = a[0];
  HEAPF32[(out >> 2) + 1] = a[1];
  HEAPF32[(out >> 2) + 2] = a[2];
});
EM_JS(int, js_http, (const char *method, const char *url, const char *headers, const char *body), {
  if (!Module.hooks || !Module.hooks.http) return -1;
  const r = Module.hooks.http(UTF8ToString(method), UTF8ToString(url), JSON.parse(UTF8ToString(headers)),
                              UTF8ToString(body));
  Module.lastHttpBody = r.body || "";
  return r.status | 0;
});
EM_JS(char *, js_http_body, (), { return stringToNewUTF8(Module.lastHttpBody || ""); });

namespace model {

Hw &hw() {
  static Hw instance;
  return instance;
}

// ---------------------------------------------------------------- clock + FreeRTOS scheduler
// loop() runs on "core 1" and the network task on "core 0". With one browser thread they take
// turns: the task runs whenever the clock passes its wake-up time, and its vTaskDelay() jumps
// back here. That is safe for backend_sync.cpp because its loop keeps nothing on the stack
// between turns (everything lives in globals).
namespace {
TaskFunction_t taskFn = nullptr;
void *taskParam = nullptr;
bool inTask = false;
jmp_buf taskJump;

void runTaskOnce() {
  Hw &h = hw();
  inTask = true;
  h.taskRuns++;
  if (setjmp(taskJump) == 0) {
    taskFn(taskParam);
    taskFn = nullptr;  // a FreeRTOS task should never return; treat it as ended
  }
  inTask = false;
}

void advanceTo(uint64_t targetUs) {
  Hw &h = hw();
  if (inTask) {  // only loop() moves the clock; the task's own waits are vTaskDelay
    if (targetUs > h.us) h.us = targetUs;
    return;
  }
  while (taskFn && h.taskNextUs <= targetUs) {
    if (h.taskNextUs > h.us) h.us = h.taskNextUs;
    runTaskOnce();
  }
  if (targetUs > h.us) h.us = targetUs;
}

uint32_t rngState = 1;
uint32_t noiseState = 12345;
uint32_t xorshift(uint32_t &s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return s;
}
float gaussian() {  // sum of 4 uniforms, scaled to standard deviation 1
  float sum = 0;
  for (int i = 0; i < 4; i++) sum += (xorshift(noiseState) & 0xffffff) / float(0x1000000);
  return (sum - 2.0f) * 1.7320508f;
}
}  // namespace

void seedRandom(uint32_t seed) {
  rngState = seed ? seed : 1;
  noiseState = seed * 2654435761u + 7;
}

bool wifiConnected() {
  Hw &h = hw();
  if (!h.hotspotOn || !h.wifiBegun) return false;
  uint64_t since = h.wifiBeginUs > h.hotspotOnUs ? h.wifiBeginUs : h.hotspotOnUs;
  return h.us >= since + uint64_t(h.assume.wifiConnectMs) * 1000;
}

void refreshClock() {
  Hw &h = hw();
  if (!h.clockSet && h.ntpConfigured && h.us >= h.ntpDueUs && wifiConnected()) h.clockSet = true;
}

}  // namespace model

using model::hw;

uint32_t millis() { return static_cast<uint32_t>(hw().us / 1000); }
uint32_t micros() { return static_cast<uint32_t>(hw().us); }
void delay(uint32_t ms) {
  if (model::inTask) {
    vTaskDelay(ms);
    return;
  }
  model::advanceTo(hw().us + uint64_t(ms) * 1000);
}
void delayMicroseconds(uint32_t us) { model::advanceTo(hw().us + us); }
void yield() {}

void vTaskDelay(TickType_t ticks) {
  if (!model::inTask) {
    delay(ticks);
    return;
  }
  hw().taskNextUs = hw().us + uint64_t(ticks) * 1000;
  longjmp(model::taskJump, 1);
}

BaseType_t xTaskCreatePinnedToCore(TaskFunction_t task, const char *name, uint32_t stackDepth,
                                   void *parameter, unsigned priority, TaskHandle_t *handle,
                                   int core) {
  (void)priority;
  if (handle) *handle = nullptr;
  model::taskFn = task;
  model::taskParam = parameter;
  model::Hw &h = hw();
  h.taskName = name ? name : "";
  h.taskStack = stackDepth;
  h.taskCore = core;
  h.taskNextUs = h.us;
  return pdPASS;
}

SemaphoreHandle_t xSemaphoreCreateMutex() { return reinterpret_cast<SemaphoreHandle_t>(1); }
BaseType_t xSemaphoreTake(SemaphoreHandle_t, TickType_t) { return pdTRUE; }
BaseType_t xSemaphoreGive(SemaphoreHandle_t) { return pdTRUE; }

// ---------------------------------------------------------------- GPIO
void pinMode(uint8_t pin, uint8_t mode) {
  if (pin < 40) hw().mode[pin] = mode;
}
void digitalWrite(uint8_t pin, uint8_t value) {
  model::Hw &h = hw();
  if (pin >= 40) return;
  uint8_t level = value ? 1 : 0;
  if (h.level[pin] == level) return;
  h.level[pin] = level;
  if (h.edges.size() < 20000) h.edges.push_back({millis(), pin, level});
}
int digitalRead(uint8_t pin) { return pin < 40 ? hw().level[pin] : 0; }

// Same as the ESP32 Arduino core's map().
long map(long x, long inMin, long inMax, long outMin, long outMax) {
  long run = inMax - inMin;
  if (run == 0) return -1;
  return (x - inMin) * (outMax - outMin) / run + outMin;
}

// ---------------------------------------------------------------- serial port
HardwareSerial Serial;
size_t Print::printf(const char *format, ...) {
  char small[256];
  va_list args;
  va_start(args, format);
  int n = vsnprintf(small, sizeof(small), format, args);
  va_end(args);
  if (n < 0) return 0;
  if (n < static_cast<int>(sizeof(small))) return write(reinterpret_cast<const uint8_t *>(small), n);
  std::string big(n + 1, '\0');
  va_start(args, format);
  vsnprintf(&big[0], big.size(), format, args);
  va_end(args);
  return write(reinterpret_cast<const uint8_t *>(big.data()), n);
}
void HardwareSerial::begin(unsigned long baud) { hw().baud = baud; }
int HardwareSerial::available() { return static_cast<int>(hw().serialIn.size()); }
int HardwareSerial::read() {
  std::string &in = hw().serialIn;
  if (in.empty()) return -1;
  int c = static_cast<uint8_t>(in[0]);
  in.erase(0, 1);
  return c;
}
size_t HardwareSerial::write(uint8_t c) {
  std::string &out = hw().serialOut;
  if (out.size() < 400000) out += static_cast<char>(c);
  return 1;
}
size_t HardwareSerial::write(const uint8_t *buffer, size_t size) {
  std::string &out = hw().serialOut;
  if (out.size() < 400000) out.append(reinterpret_cast<const char *>(buffer), size);
  return size;
}

EspClass ESP;
uint32_t EspClass::getFreeHeap() {
  // The model's own free memory (WebAssembly heap), not an ESP32 figure.
  struct mallinfo info = mallinfo();
  size_t top = reinterpret_cast<size_t>(sbrk(0));
  size_t heap = emscripten_get_heap_size();
  return static_cast<uint32_t>(info.fordblks + (heap > top ? heap - top : 0));
}
void EspClass::restart() { hw().restartRequested = true; }
esp_reset_reason_t esp_reset_reason() { return static_cast<esp_reset_reason_t>(hw().resetReason); }

uint32_t esp_random() { return model::xorshift(model::rngState); }
void esp_fill_random(void *buffer, size_t length) {
  uint8_t *p = static_cast<uint8_t *>(buffer);
  for (size_t i = 0; i < length; i++) p[i] = static_cast<uint8_t>(esp_random() >> 8);
}

// ---------------------------------------------------------------- I2C bus + chips
TwoWire Wire;
namespace {
uint8_t txAddress = 0;
std::vector<uint8_t> txBytes;
std::vector<uint8_t> rxBytes;
size_t rxPos = 0;

constexpr uint8_t kMpuAddress = 0x68;
constexpr uint8_t kPnAddress = PN532_I2C_ADDRESS;

// Bus time: about 9 clock cycles per byte (8 bits + acknowledge), plus the address byte.
void busTime(size_t bytes) {
  uint32_t hz = hw().i2cHz ? hw().i2cHz : 100000;
  model::advanceTo(hw().us + (uint64_t(bytes + 1) * 9 * 1000000) / hz);
}

bool linked(uint8_t address) {
  if (address == kMpuAddress) return hw().mpuLinked;
  if (address == kPnAddress) return hw().pn532Linked;
  return false;
}

// MPU-6050 register map (InvenSense RM-MPU-6000A): power-on values and the bits we act on.
void mpuReset() {
  model::Hw &h = hw();
  memset(h.mpuReg, 0, sizeof(h.mpuReg));
  h.mpuReg[0x6B] = 0x40;  // PWR_MGMT_1: SLEEP after power-on
  h.mpuReg[0x75] = 0x68;  // WHO_AM_I of a genuine MPU-6050
}

void mpuWrite(const std::vector<uint8_t> &bytes) {
  model::Hw &h = hw();
  if (bytes.empty()) return;
  h.mpuPtr = bytes[0] & 0x7f;
  for (size_t i = 1; i < bytes.size(); i++) {
    uint8_t reg = h.mpuPtr;
    if (reg == 0x6B && (bytes[i] & 0x80)) mpuReset();  // DEVICE_RESET
    else h.mpuReg[reg] = bytes[i];
    h.mpuPtr = (h.mpuPtr + 1) & 0x7f;
  }
}

// Fresh accelerometer sample: the page's physics + sensor noise, scaled by the range the
// firmware chose in ACCEL_CONFIG (AFS_SEL bits 4:3), clipped at the 16-bit limits.
void mpuSample() {
  model::Hw &h = hw();
  float g[3];
  js_accel(static_cast<double>(h.us) / 1000.0, g);
  bool asleep = h.mpuReg[0x6B] & 0x40;
  int afs = (h.mpuReg[0x1C] >> 3) & 0x03;
  float countsPerG = 16384.0f / float(1 << afs);
  for (int i = 0; i < 3; i++) {
    float v = g[i] + h.assume.mpuNoiseG * model::gaussian();
    h.mpuG[i] = v;
    long counts = asleep ? 0 : lroundf(v * countsPerG);
    if (counts > 32767) counts = 32767;
    if (counts < -32768) counts = -32768;
    h.mpuRaw[i] = static_cast<int16_t>(counts);
    uint8_t *r = &h.mpuReg[0x3B + i * 2];
    r[0] = static_cast<uint8_t>((counts >> 8) & 0xff);
    r[1] = static_cast<uint8_t>(counts & 0xff);
  }
  uint32_t now = millis();
  if (h.mpuReads) h.mpuReadGapMs = now - h.mpuLastReadMs;
  h.mpuLastReadMs = now;
  h.mpuReads++;
}

uint8_t mpuReadByte() {
  model::Hw &h = hw();
  uint8_t v = h.mpuReg[h.mpuPtr];
  h.mpuPtr = (h.mpuPtr + 1) & 0x7f;
  return v;
}

// PN532: after "start detection" it answers the 1-byte status read with 0x01 once a card has
// been in the field for a moment, and keeps that answer until the firmware reads the card ID.
uint8_t pnStatusByte() {
  model::Hw &h = hw();
  uint32_t now = millis();
  if (h.pnPolls) h.pnPollGapMs = now - h.pnLastPollMs;
  h.pnLastPollMs = now;
  h.pnPolls++;
  if (!h.pnReady && h.pnArmed && h.cardPresent) {
    uint64_t since = h.cardSinceUs > h.pnArmedUs ? h.cardSinceUs : h.pnArmedUs;
    if (h.us >= since + uint64_t(h.assume.pn532DetectMs) * 1000) h.pnReady = true;
  }
  return h.pnReady ? PN532_I2C_READY : 0x00;
}
}  // namespace

namespace model {
void resetChips() { mpuReset(); }
}  // namespace model

bool TwoWire::begin(int sda, int scl, uint32_t frequency) {
  hw().sda = sda;
  hw().scl = scl;
  hw().i2cHz = frequency;
  return true;
}
void TwoWire::beginTransmission(uint8_t address) {
  txAddress = address;
  txBytes.clear();
}
size_t TwoWire::write(uint8_t data) {
  txBytes.push_back(data);
  return 1;
}
uint8_t TwoWire::endTransmission(bool sendStop) {
  (void)sendStop;
  busTime(txBytes.size());
  if (txAddress < 128) hw().i2cTx[txAddress]++;
  if (!linked(txAddress)) return 2;  // address not acknowledged
  if (txAddress == kMpuAddress) mpuWrite(txBytes);
  return 0;
}
uint8_t TwoWire::requestFrom(uint8_t address, uint8_t count) {
  rxBytes.clear();
  rxPos = 0;
  busTime(count);
  if (address < 128) hw().i2cTx[address]++;
  if (!linked(address)) return 0;
  if (address == kMpuAddress) {
    if (hw().mpuPtr == 0x3B) mpuSample();
    for (uint8_t i = 0; i < count; i++) rxBytes.push_back(mpuReadByte());
  } else if (address == kPnAddress) {
    for (uint8_t i = 0; i < count; i++) rxBytes.push_back(i == 0 ? pnStatusByte() : 0);
  }
  return count;
}
int TwoWire::available() { return static_cast<int>(rxBytes.size() - rxPos); }
int TwoWire::read() { return rxPos < rxBytes.size() ? rxBytes[rxPos++] : -1; }

// The PN532 library's commands, each costing a little bus time like the real frames do.
Adafruit_PN532::Adafruit_PN532(uint8_t, uint8_t, TwoWire *) {}
static bool pnCommand(size_t bytes) {
  busTime(bytes);
  hw().i2cTx[kPnAddress]++;
  return hw().pn532Linked;
}
bool Adafruit_PN532::begin() { return pnCommand(1); }
uint32_t Adafruit_PN532::getFirmwareVersion() { return pnCommand(12) ? 0x32010607u : 0; }  // PN532 v1.6
bool Adafruit_PN532::SAMConfig() { return pnCommand(12); }
bool Adafruit_PN532::setPassiveActivationRetries(uint8_t) { return pnCommand(12); }
bool Adafruit_PN532::startPassiveTargetIDDetection(uint8_t) {
  if (!pnCommand(12)) return false;
  hw().pnArmed = true;
  hw().pnArmedUs = hw().us;
  hw().pnReady = false;
  return true;
}
bool Adafruit_PN532::readDetectedPassiveTargetID(uint8_t *uid, uint8_t *uidLength) {
  model::Hw &h = hw();
  if (!pnCommand(20) || !h.pnReady) return false;
  memcpy(uid, h.uid, h.uidLength);
  *uidLength = h.uidLength;
  h.pnReady = false;
  h.pnArmed = false;
  h.pnReads++;
  return true;
}

// ---------------------------------------------------------------- servo (ESP32Servo library)
void Servo::setPeriodHertz(int hz) { hw().servoHz = hz; }
int Servo::attach(int pin, int minUs, int maxUs) {
  if (minUs < MIN_PULSE_WIDTH) minUs = MIN_PULSE_WIDTH;
  if (maxUs > MAX_PULSE_WIDTH) maxUs = MAX_PULSE_WIDTH;
  min_ = minUs;
  max_ = maxUs;
  bool fresh = pin_ < 0;
  pin_ = pin;
  hw().servoPin = pin;
  hw().servoMinUs = minUs;
  hw().servoMaxUs = maxUs;
  if (fresh) writeMicroseconds(1500);  // the library starts at its default 1500 us pulse
  return 1;
}
void Servo::write(int value) {
  if (value < MIN_PULSE_WIDTH) {
    if (value < 0) value = 0;
    else if (value > 180) value = 180;
    value = static_cast<int>(map(value, 0, 180, min_, max_));
  }
  writeMicroseconds(value);
}
void Servo::writeMicroseconds(int us) {
  us_ = us;
  model::Hw &h = hw();
  h.servoUs = us;
  h.servoWrites++;
  if (h.servoLog.size() < 4000) h.servoLog.push_back({millis(), us});
}
int Servo::read() { return static_cast<int>(map(us_, min_, max_, 0, 180)); }

// ---------------------------------------------------------------- flash (LittleFS)
LittleFSFS LittleFS;
bool LittleFSFS::begin(bool) {
  hw().fsMounted = true;
  return true;
}
File LittleFSFS::open(const char *path, const char *mode) {
  char m = mode && mode[0] ? mode[0] : 'r';
  if (m == 'r' && !exists(path)) return File();
  return File(path, m);
}
bool LittleFSFS::exists(const char *path) { return hw().files.count(path) > 0; }
bool LittleFSFS::remove(const char *path) { return hw().files.erase(path) > 0; }
bool LittleFSFS::rename(const char *from, const char *to) {
  auto &files = hw().files;
  auto it = files.find(from);
  if (it == files.end()) return false;
  std::string content = std::move(it->second);
  files.erase(it);
  files[to] = std::move(content);
  return true;
}

File::File(const std::string &path, char mode) : path_(path), mode_(mode), open_(true) {
  std::string &content = hw().files[path_];
  if (mode_ == 'w') content.clear();
  pos_ = (mode_ == 'a') ? content.size() : 0;
}
int File::available() {
  if (!open_) return 0;
  const std::string &c = hw().files[path_];
  return pos_ < c.size() ? static_cast<int>(c.size() - pos_) : 0;
}
int File::read() {
  if (!open_) return -1;
  const std::string &c = hw().files[path_];
  return pos_ < c.size() ? static_cast<uint8_t>(c[pos_++]) : -1;
}
size_t File::size() { return open_ ? hw().files[path_].size() : 0; }
size_t File::write(uint8_t c) { return write(&c, 1); }
size_t File::write(const uint8_t *buffer, size_t size) {
  if (!open_ || mode_ == 'r') return 0;
  std::string &content = hw().files[path_];
  content.append(reinterpret_cast<const char *>(buffer), size);
  pos_ = content.size();
  // Watch new event lines being written, like a logic analyser on the flash.
  if (path_ == "/events.jsonl" && mode_ == 'a' && size == 1 && buffer[0] == '\n') {
    size_t start = content.rfind('\n', content.size() - 2);
    start = (start == std::string::npos) ? 0 : start + 1;
    hw().eventLines.push_back(content.substr(start, content.size() - 1 - start));
  }
  return size;
}
String File::readString() {
  String out;
  int c;
  while ((c = read()) >= 0) out += static_cast<char>(c);
  return out;
}
String File::readStringUntil(char terminator) {
  String out;
  int c;
  while ((c = read()) >= 0 && c != terminator) out += static_cast<char>(c);
  return out;
}

// ---------------------------------------------------------------- Wi-Fi, NTP, HTTP
WiFiClass WiFi;
String IPAddress::toString() const { return model::wifiConnected() ? hw().assume.hotspotIp : "0.0.0.0"; }
wl_status_t WiFiClass::status() { return model::wifiConnected() ? WL_CONNECTED : WL_DISCONNECTED; }
bool WiFiClass::mode(int) { return true; }
bool WiFiClass::setSleep(bool) { return true; }
bool WiFiClass::disconnect() {
  hw().wifiBegun = false;
  return true;
}
wl_status_t WiFiClass::begin(const char *, const char *) {
  hw().wifiBegun = true;
  hw().wifiBeginUs = hw().us;
  hw().wifiBegins++;
  return WL_DISCONNECTED;
}
IPAddress WiFiClass::localIP() { return IPAddress(); }
int WiFiClass::RSSI() { return model::wifiConnected() ? hw().assume.rssi : 0; }

void configTime(long, int, const char *, const char *, const char *) {
  model::Hw &h = hw();
  if (!h.ntpConfigured) {
    h.ntpConfigured = true;
    h.ntpDueUs = h.us + uint64_t(h.assume.ntpDelayMs) * 1000;
  }
}

// device_status.cpp is compiled with -Dtime=hbr_model_time so its time() lands here.
extern "C" time_t hbr_model_time(time_t *out) {
  model::refreshClock();
  model::Hw &h = hw();
  double seconds = static_cast<double>(h.us) / 1e6;
  // Before NTP the ESP32 clock counts up from 1970, which the firmware treats as "not set".
  time_t now = static_cast<time_t>(h.clockSet ? h.worldEpochAtBoot + seconds : seconds);
  if (out) *out = now;
  return now;
}

bool HTTPClient::begin(WiFiClient &, const String &url) {
  url_ = url;
  headers_.clear();
  response_ = "";
  return url.startsWith("http://") || url.startsWith("https://");
}
void HTTPClient::addHeader(const String &name, const String &value) {
  headers_.push_back({name.c_str(), value.c_str()});
}
int HTTPClient::GET() { return request("GET", ""); }
int HTTPClient::POST(const String &body) { return request("POST", body); }
int HTTPClient::request(const char *method, const String &body) {
  if (!model::wifiConnected()) return HTTPC_ERROR_CONNECTION_REFUSED;
  hw().httpRequests++;
  std::string headers = "{";
  for (size_t i = 0; i < headers_.size(); i++) {
    if (i) headers += ",";
    headers += "\"" + headers_[i].first + "\":\"" + headers_[i].second + "\"";
  }
  headers += "}";
  int status = js_http(method, url_.c_str(), headers.c_str(), body.c_str());
  char *text = js_http_body();
  response_ = text;
  free(text);
  return status;
}

// ---------------------------------------------------------------- HMAC-SHA256 (mbedTLS stand-in)
namespace {
const uint32_t kSha256K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void sha256(const uint8_t *data, size_t length, uint8_t out[32]) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::vector<uint8_t> m(data, data + length);
  uint64_t bits = uint64_t(length) * 8;
  m.push_back(0x80);
  while (m.size() % 64 != 56) m.push_back(0);
  for (int i = 7; i >= 0; i--) m.push_back(static_cast<uint8_t>(bits >> (i * 8)));
  for (size_t chunk = 0; chunk < m.size(); chunk += 64) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) {
      const uint8_t *p = &m[chunk + i * 4];
      w[i] = (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | p[3];
    }
    for (int i = 16; i < 64; i++) {
      uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (int i = 0; i < 64; i++) {
      uint32_t t1 = k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + kSha256K[i] + w[i];
      uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      k = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  for (int i = 0; i < 8; i++)
    for (int j = 0; j < 4; j++) out[i * 4 + j] = static_cast<uint8_t>(h[i] >> (24 - j * 8));
}
}  // namespace

const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t type) {
  static const mbedtls_md_info_t sha256Info = {MBEDTLS_MD_SHA256};
  return type == MBEDTLS_MD_SHA256 ? &sha256Info : nullptr;
}

int mbedtls_md_hmac(const mbedtls_md_info_t *info, const unsigned char *key, size_t keyLength,
                    const unsigned char *input, size_t inputLength, unsigned char *output) {
  if (!info || info->type != MBEDTLS_MD_SHA256) return -1;
  uint8_t block[64] = {};
  if (keyLength > 64) sha256(key, keyLength, block);
  else memcpy(block, key, keyLength);
  std::vector<uint8_t> inner(64), outer(64);
  for (int i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.insert(inner.end(), input, input + inputLength);
  uint8_t innerHash[32];
  sha256(inner.data(), inner.size(), innerHash);
  outer.insert(outer.end(), innerHash, innerHash + 32);
  sha256(outer.data(), outer.size(), output);
  return 0;
}
