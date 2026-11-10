// Emulated hardware for the firmware model (firmware/model/README.md).
//
// This file plays the part of the Arduino Uno R3 (ATmega328P) and everything wired to it: the
// clock, GPIO pins, the serial port, the I2C bus with an MPU-6050 and a PN532 on it, the servo
// signal, the EEPROM and the watchdog. Each piece follows the datasheet or the real library, so
// the firmware in src/ can run on it unchanged. It decides nothing about the rack.
#include "hw.h"

#include <emscripten/emscripten.h>

#include "Adafruit_PN532.h"
#include "Arduino.h"
#include "EEPROM.h"
#include "Servo.h"
#include "Wire.h"
#include "avr/wdt.h"

// ---- calls into the page (frontend/model/runner.js sets Module.hooks) ----
EM_JS(void, js_accel, (double ms, float *out), {
  const a = Module.hooks && Module.hooks.accel ? Module.hooks.accel(ms) : [0, 0, 1];
  HEAPF32[out >> 2] = a[0];
  HEAPF32[(out >> 2) + 1] = a[1];
  HEAPF32[(out >> 2) + 2] = a[2];
});

namespace model {

Hw &hw() {
  static Hw instance;
  return instance;
}

jmp_buf resetJump;
bool resetJumpReady = false;

namespace {
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

// The chip resets: the page sees restartRequested and boots a fresh instance (RAM gone,
// EEPROM kept). Leaves the firmware right away, like the real reset line does.
[[noreturn]] void chipReset(int reason) {
  Hw &h = hw();
  h.restartRequested = true;
  h.resetReason = reason;
  if (resetJumpReady) longjmp(resetJump, 1);
  // setup() never arms a short watchdog, so this can only happen from inside loop().
  abort();
}

// Moves the clock. If the watchdog's time runs out on the way, the chip resets at that moment.
void advanceTo(uint64_t targetUs) {
  Hw &h = hw();
  if (h.wdtOn) {
    uint64_t deadline = h.wdtKickUs + uint64_t(h.wdtTimeoutMs) * 1000;
    if (targetUs >= deadline) {
      if (deadline > h.us) h.us = deadline;
      chipReset(RESET_WATCHDOG);
    }
  }
  if (targetUs > h.us) h.us = targetUs;
}
}  // namespace

void seedRandom(uint32_t seed) { noiseState = seed * 2654435761u + 7; }

}  // namespace model

using model::hw;

uint32_t millis() { return static_cast<uint32_t>(hw().us / 1000); }
uint32_t micros() { return static_cast<uint32_t>(hw().us); }
void delay(uint32_t ms) { model::advanceTo(hw().us + uint64_t(ms) * 1000); }
void delayMicroseconds(uint32_t us) { model::advanceTo(hw().us + us); }
void yield() {}

// ---------------------------------------------------------------- watchdog
volatile uint8_t hbr_model_mcusr = 0;

void wdt_enable(uint8_t timeout) {
  model::Hw &h = hw();
  h.wdtOn = true;
  h.wdtTimeoutMs = 16u << (timeout > 9 ? 9 : timeout);  // nominal: WDTO_15MS = 16 ms ... WDTO_8S = 8.2 s
  h.wdtKickUs = h.us;
  // The `reboot` command: arm a 15 ms watchdog, then spin forever until it fires. The spin
  // has nothing in it the model could see, so the reset happens here, 16 ms later.
  if (timeout == WDTO_15MS && model::resetJumpReady) model::advanceTo(h.us + uint64_t(h.wdtTimeoutMs) * 1000);
}
void wdt_disable() { hw().wdtOn = false; }
void wdt_reset() {
  hw().wdtKickUs = hw().us;
  hw().wdtKicks++;
}

// ---------------------------------------------------------------- GPIO
namespace {
bool realPin(uint8_t pin) {
  if (pin < model::kPins) return true;
  // On a real Uno this would read past the pin tables and write to some random register.
  auto &bad = hw().badPins;
  if (bad.size() < 16) bad.push_back(pin);
  return false;
}
}  // namespace

void pinMode(uint8_t pin, uint8_t mode) {
  if (!realPin(pin)) return;
  hw().mode[pin] = mode;
  hw().modeSet[pin] = true;
}
void digitalWrite(uint8_t pin, uint8_t value) {
  model::Hw &h = hw();
  if (!realPin(pin)) return;
  uint8_t level = value ? 1 : 0;
  if (h.level[pin] == level) return;
  h.level[pin] = level;
  if (h.edges.size() < 20000) h.edges.push_back({millis(), pin, level});
}
int digitalRead(uint8_t pin) { return pin < model::kPins ? hw().level[pin] : 0; }

long map(long x, long inMin, long inMax, long outMin, long outMax) {
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

// ---------------------------------------------------------------- serial port
HardwareSerial Serial;
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

// The firmware's freeRam() measures from these two linker symbols. In WebAssembly they mean
// nothing, so `status` shows a made-up number in the model (see "Model Assumptions").
extern "C" {
char __heap_start = 0;
char *__brkval = nullptr;
}

// ---------------------------------------------------------------- EEPROM
EEPROMClass EEPROM;
uint16_t EEPROMClass::length() { return model::kEepromSize; }
uint8_t EEPROMClass::read(int address) {
  return address >= 0 && address < model::kEepromSize ? hw().eeprom[address] : 0xFF;
}
void EEPROMClass::write(int address, uint8_t value) {
  if (address < 0 || address >= model::kEepromSize) return;
  hw().eeprom[address] = value;
  hw().eepromWrites++;
  model::advanceTo(hw().us + 3300);  // a real EEPROM byte write takes 3.3 ms
}
void EEPROMClass::update(int address, uint8_t value) {
  if (read(address) != value) write(address, value);
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

void TwoWire::begin() {
  hw().i2cBegun = true;
  // Like the AVR core: Wire.begin() turns on the chip's weak internal pull-ups on A4/A5.
  pinMode(SDA, INPUT_PULLUP);
  pinMode(SCL, INPUT_PULLUP);
}
void TwoWire::setClock(uint32_t frequency) { hw().i2cHz = frequency; }
void TwoWire::setWireTimeout(uint32_t timeoutUs, bool) { hw().i2cTimeoutUs = timeoutUs; }
void TwoWire::beginTransmission(uint8_t address) {
  txAddress = address;
  txBytes.clear();
}
size_t TwoWire::write(uint8_t data) {
  if (txBytes.size() >= 32) return 0;  // the AVR Wire buffer is 32 bytes
  txBytes.push_back(data);
  return 1;
}
uint8_t TwoWire::endTransmission(uint8_t) {
  busTime(txBytes.size());
  if (txAddress < 128) hw().i2cTx[txAddress]++;
  if (!linked(txAddress)) return 2;  // address not acknowledged
  if (txAddress == kMpuAddress) mpuWrite(txBytes);
  return 0;
}
uint8_t TwoWire::requestFrom(uint8_t address, uint8_t count) {
  rxBytes.clear();
  rxPos = 0;
  if (count > 32) count = 32;
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
// Like the real constructor, it sets up the IRQ and reset pins it was given.
Adafruit_PN532::Adafruit_PN532(uint8_t irq, uint8_t reset, TwoWire *) {
  hw().pnIrqPin = irq;
  hw().pnResetPin = reset;
  pinMode(irq, INPUT);
  pinMode(reset, OUTPUT);
}
static bool pnCommand(size_t bytes) {
  busTime(bytes);
  hw().i2cTx[kPnAddress]++;
  return hw().pn532Linked;
}
bool Adafruit_PN532::begin() {
  // reset(): a short low pulse on the reset pin (harmless if nothing is wired to it).
  digitalWrite(static_cast<uint8_t>(hw().pnResetPin), LOW);
  delay(1);
  digitalWrite(static_cast<uint8_t>(hw().pnResetPin), HIGH);
  delay(2);
  return pnCommand(1);
}
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

// ---------------------------------------------------------------- servo (AVR Servo library)
uint8_t Servo::attach(int pin) { return attach(pin, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH); }
uint8_t Servo::attach(int pin, int minUs, int maxUs) {
  // The library keeps min/max as offsets from 544/2400 in 4 us steps.
  min_ = MIN_PULSE_WIDTH - ((MIN_PULSE_WIDTH - minUs) / 4) * 4;
  max_ = MAX_PULSE_WIDTH - ((MAX_PULSE_WIDTH - maxUs) / 4) * 4;
  bool fresh = pin_ < 0;
  pin_ = pin;
  pinMode(static_cast<uint8_t>(pin), OUTPUT);
  model::Hw &h = hw();
  h.servoPin = pin;
  h.servoMinUs = min_;
  h.servoMaxUs = max_;
  if (fresh) writeMicroseconds(DEFAULT_PULSE_WIDTH);  // pulses start at 1500 us
  return 0;
}
void Servo::detach() { pin_ = -1; }
void Servo::write(int value) {
  if (value < MIN_PULSE_WIDTH) {
    if (value < 0) value = 0;
    if (value > 180) value = 180;
    value = static_cast<int>(map(value, 0, 180, min_, max_));
  }
  writeMicroseconds(value);
}
void Servo::writeMicroseconds(int us) {
  if (us < min_) us = min_;
  if (us > max_) us = max_;
  us_ = us;
  model::Hw &h = hw();
  h.servoUs = us;
  h.servoWrites++;
  if (h.servoLog.size() < 4000) h.servoLog.push_back({millis(), us});
}
int Servo::read() { return static_cast<int>(map(us_, min_, max_, 0, 180)); }
