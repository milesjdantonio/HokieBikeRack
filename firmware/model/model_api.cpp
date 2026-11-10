// The firmware model's entry point (firmware/model/README.md).
//
// This file #includes the REAL firmware files below, unchanged, so they end up in the same
// compile unit as the functions the page calls. That lets the page look at their internal
// state (the tamper detector's baseline, the re-lock timer, the card reader's poll timing,
// enrol mode) without adding a single line to src/. Everything the rack does comes from those
// files; this file only starts them, steps the clock and reports what they did.
//
// Built by tools/model/build.mjs into frontend/model/firmware.js.
#include <emscripten/emscripten.h>

// Library headers first, so the trick below cannot touch them.
#include <Arduino.h>

#include <cmath>
#include <string>
#include <vector>

// Read-only peek at private members (baseline, timers) for the page. Changes no behaviour:
// the same classes are compiled the normal way in lib/hbr_logic/.
#define private public
#include "card_list.h"
#include "feedback_player.h"
#include "hbr_util.h"
#include "lock_controller.h"
#include "tamper_detector.h"
#undef private

// ---- the real firmware ----
#include "../src/main.cpp"         // setup(), loop(), card + tamper handling, serial console
#include "../src/lock.cpp"         // re-lock timer -> servo
#include "../src/feedback.cpp"     // light + buzzer patterns -> GPIO pins
#include "../src/card_reader.cpp"  // PN532 polling
#include "../src/card_store.cpp"   // the card list in EEPROM
// (tamper_sensor.cpp, credential_ref.cpp and lib/hbr_logic/ are compiled as their own files.)

#include "hw.h"

namespace model {
void seedRandom(uint32_t seed);
void resetChips();
}  // namespace model

namespace {
using model::hw;

// A small JSON writer, so the model needs no JSON library.
class Json {
 public:
  Json &beginObject() { pre(); s_ += '{'; st_.push_back({'}', false}); return *this; }
  Json &beginArray() { pre(); s_ += '['; st_.push_back({']', false}); return *this; }
  Json &end() { s_ += st_.back().close; st_.pop_back(); return *this; }
  Json &key(const char *k) { pre(); quote(k); s_ += ':'; afterKey_ = true; return *this; }
  Json &val(const char *v) { pre(); quote(v ? v : ""); return *this; }
  Json &val(const std::string &v) { return val(v.c_str()); }
  Json &val(bool v) { pre(); s_ += v ? "true" : "false"; return *this; }
  Json &val(int v) { return num(static_cast<long long>(v)); }
  Json &val(unsigned v) { return num(static_cast<long long>(v)); }
  Json &val(long v) { return num(static_cast<long long>(v)); }
  Json &val(unsigned long v) { return num(static_cast<long long>(v)); }
  Json &val(long long v) { return num(v); }
  Json &val(unsigned long long v) { return num(static_cast<long long>(v)); }
  Json &val(double v) {
    pre();
    char b[40];
    if (std::isfinite(v)) snprintf(b, sizeof(b), "%.9g", v);
    else snprintf(b, sizeof(b), "null");
    s_ += b;
    return *this;
  }
  Json &val(float v) { return val(static_cast<double>(v)); }
  template <class T>
  Json &kv(const char *k, T v) { key(k); return val(v); }
  const std::string &str() const { return s_; }

 private:
  struct Level { char close; bool any; };
  void pre() {
    if (afterKey_) { afterKey_ = false; return; }
    if (!st_.empty()) {
      if (st_.back().any) s_ += ',';
      st_.back().any = true;
    }
  }
  Json &num(long long v) {
    pre();
    char b[24];
    snprintf(b, sizeof(b), "%lld", v);
    s_ += b;
    return *this;
  }
  void quote(const char *v) {
    s_ += '"';
    for (const char *p = v; *p; p++) {
      unsigned char c = static_cast<unsigned char>(*p);
      if (c == '"' || c == '\\') { s_ += '\\'; s_ += static_cast<char>(c); }
      else if (c == '\n') s_ += "\\n";
      else if (c == '\r') s_ += "\\r";
      else if (c == '\t') s_ += "\\t";
      else if (c < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); s_ += b; }
      else s_ += static_cast<char>(c);
    }
    s_ += '"';
  }
  std::vector<Level> st_;
  std::string s_;
  bool afterKey_ = false;
};

std::string out;  // returned strings live here until the next call
const char *finish(const Json &j) {
  out = j.str();
  return out.c_str();
}

uint32_t seenSampleMs = 0;
struct Sample {
  uint32_t ms;
  float deviation;
  uint8_t over;
  bool armed;
};
std::vector<Sample> samples;

const char *patternName(hbr::Pattern p) {
  switch (p) {
    case hbr::Pattern::None: return "None";
    case hbr::Pattern::Boot: return "Boot";
    case hbr::Pattern::Granted: return "Granted";
    case hbr::Pattern::Denied: return "Denied";
    case hbr::Pattern::TamperWarning: return "TamperWarning";
    case hbr::Pattern::TamperAlarm: return "TamperAlarm";
  }
  return "?";
}

const char *cardModeName(CardMode m) {
  switch (m) {
    case CardMode::Check: return "check";
    case CardMode::Enroll: return "enroll";
    case CardMode::Unenroll: return "unenroll";
  }
  return "?";
}

bool parseUid(const char *hex, uint8_t *bytes, uint8_t &length) {
  length = 0;
  while (hex && length < CARD_ID_MAX_LENGTH && hbr::fromHex(hex + 2 * length, &bytes[length], 1)) length++;
  return length > 0;
}

std::string hexOf(const uint8_t *data, size_t length) {
  std::string s(2 * length + 1, '\0');
  hbr::toHex(data, length, &s[0]);
  s.resize(2 * length);
  return s;
}

// One firmware value for the page's "Values" list. `file` is relative to firmware/; the build
// script looks up the line where `id` is defined.
void value(Json &j, const char *group, const char *id, double v, const char *unit, const char *file,
           const char *what) {
  j.beginObject().kv("group", group).kv("id", id).kv("value", v).kv("unit", unit).kv("file", file)
      .kv("what", what).end();
}

void steps(Json &j, hbr::Pattern p, uint32_t hold) {
  hbr::Step s[hbr::kMaxSteps];
  uint8_t n = hbr::FeedbackPlayer::stepsFor(p, hold, s);
  j.key(patternName(p)).beginArray();
  for (uint8_t i = 0; i < n; i++) j.beginArray().val(s[i].ms).val(s[i].red).val(s[i].green).val(s[i].buzzer).end();
  j.end();
}
}  // namespace

extern "C" {

// ---- EEPROM, kept by the page across a power cycle (1024 bytes as hex) ----
EMSCRIPTEN_KEEPALIVE const char *hbr_eeprom_get() {
  out = hexOf(hw().eeprom, model::kEepromSize);
  return out.c_str();
}
EMSCRIPTEN_KEEPALIVE void hbr_eeprom_put(const char *hex) {
  if (hex && strlen(hex) == 2u * model::kEepromSize) hbr::fromHex(hex, hw().eeprom, model::kEepromSize);
}

// Before the very first boot: enrol a card, like a teammate did on the bench with `enroll`.
// Uses the firmware's own CardList on the model's EEPROM, then rewinds the clock.
EMSCRIPTEN_KEEPALIVE void hbr_preload_card(const char *uidHex) {
  CardId card{};
  uint8_t ref[hbr::kCardRefLength];
  if (!parseUid(uidHex, card.bytes, card.length) || !credentialRefFromCard(card, ref)) return;
  EepromStore store;
  hbr::CardList factory(store);
  factory.begin();
  factory.add(ref);
  hw().us = 0;
  hw().eepromWrites = 0;
}

// Power on: start the firmware's setup(). Call once per module instance; a reboot makes a
// new instance (fresh RAM) and copies the EEPROM across first.
EMSCRIPTEN_KEEPALIVE void hbr_boot(int resetReason, uint32_t seed) {
  hw().resetReason = resetReason;
  model::seedRandom(seed);
  model::resetChips();
  setup();
}

// Run loop() until the clock reaches `ms` since boot, or the watchdog resets the chip.
EMSCRIPTEN_KEEPALIVE void hbr_run_until(double ms) {
  const uint64_t target = static_cast<uint64_t>(ms * 1000.0);
  if (setjmp(model::resetJump)) {  // the watchdog fired somewhere inside loop()
    model::resetJumpReady = false;
    return;
  }
  model::resetJumpReady = true;
  while (hw().us < target && !hw().restartRequested) {
    uint64_t before = hw().us;
    loop();
    if (lastTamperSampleMs != seenSampleMs) {
      seenSampleMs = lastTamperSampleMs;
      if (samples.size() < 20000) {
        samples.push_back({lastTamperSampleMs, tamper.lastDeviationG(), tamper.overCount_,
                           !lockRecentlyUnlocked(HBR_TAMPER_GRACE_MS)});
      }
    }
    if (hw().us == before) hw().us += 1000;  // never spin without time passing
  }
  model::resetJumpReady = false;
}

EMSCRIPTEN_KEEPALIVE double hbr_now_ms() { return static_cast<double>(hw().us) / 1000.0; }
EMSCRIPTEN_KEEPALIVE int hbr_restart_requested() { return hw().restartRequested ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int hbr_reset_reason() { return hw().resetReason; }

// ---- inputs: what the hardware senses ----
EMSCRIPTEN_KEEPALIVE void hbr_card(int present, const char *uidHex) {
  model::Hw &h = hw();
  if (present) {
    uint8_t len = 0;
    if (!parseUid(uidHex, h.uid, len)) return;
    h.uidLength = len;
    if (!h.cardPresent) h.cardSinceUs = h.us;
    h.cardPresent = true;
  } else {
    h.cardPresent = false;
  }
}
EMSCRIPTEN_KEEPALIVE void hbr_link(int which, int connected) {
  if (which == 0) hw().pn532Linked = connected != 0;
  else hw().mpuLinked = connected != 0;
}
EMSCRIPTEN_KEEPALIVE void hbr_serial_write(const char *text) {
  if (text) hw().serialIn += text;
}

// The reference src/credential_ref.cpp makes for a card: the 16 bytes saved in EEPROM, as hex.
EMSCRIPTEN_KEEPALIVE const char *hbr_card_ref(const char *uidHex) {
  CardId card{};
  uint8_t ref[hbr::kCardRefLength];
  out.clear();
  if (parseUid(uidHex, card.bytes, card.length) && credentialRefFromCard(card, ref)) {
    out = hexOf(ref, hbr::kCardRefLength);
  }
  return out.c_str();
}

// ---- everything that happened since the last call: pin edges, servo pulses, tamper samples
// and serial output ----
EMSCRIPTEN_KEEPALIVE const char *hbr_take_log() {
  model::Hw &h = hw();
  Json j;
  j.beginObject();
  j.key("edges").beginArray();
  for (const model::Edge &e : h.edges) j.beginArray().val(e.ms).val(e.pin).val(e.level).end();
  j.end();
  j.key("servo").beginArray();
  for (const auto &s : h.servoLog) j.beginArray().val(s.first).val(s.second).end();
  j.end();
  j.key("samples").beginArray();
  for (const Sample &s : samples) {
    j.beginArray().val(s.ms).val(roundf(s.deviation * 1000) / 1000).val(s.over).val(s.armed).end();
  }
  j.end();
  j.kv("serial", h.serialOut);
  j.end();
  h.edges.clear();
  h.servoLog.clear();
  samples.clear();
  h.serialOut.clear();
  return finish(j);
}

// ---- the firmware's state right now ----
EMSCRIPTEN_KEEPALIVE const char *hbr_state() {
  model::Hw &h = hw();
  uint32_t now = millis();
  Json j;
  j.beginObject().kv("ms", now);

  j.key("lock").beginObject()
      .kv("unlocked", controller.unlocked_)
      .kv("leftMs", controller.unlocked_ ? (long long)(controller.unlockMs_ - (now - controller.unlockedAtMs_)) : 0LL)
      .kv("sinceUnlockMs", controller.everUnlocked_ ? (long long)(now - controller.unlockedAtMs_) : -1LL)
      .kv("servoUs", h.servoUs)
      .kv("servoAttached", servo.attached())
      .kv("servoWrites", h.servoWrites)
      .end();

  j.key("feedback").beginObject()
      .kv("pattern", patternName(player.current_))
      .kv("elapsedMs", player.current_ == hbr::Pattern::None ? 0u : now - player.startMs_)
      .kv("ready", player.ready_)
      .kv("red", h.level[LED_RED_PIN])
      .kv("green", h.level[LED_GREEN_PIN])
      .kv("buzzer", h.level[BUZZER_PIN])
      .end();

  const hbr::TamperConfig &tc = tamper.config();
  bool alarm = tamper.alarmActive(now);
  uint32_t since = now - tamper.lastSignalMs_;
  uint32_t sinceEsc = now - tamper.escalateFromMs_;
  j.key("tamper").beginObject()
      .kv("deviationG", tamper.lastDeviation_)
      .kv("over", tamper.overCount_);
  j.key("baseline").beginArray().val(tamper.baseX_).val(tamper.baseY_).val(tamper.baseZ_).end();
  j.kv("started", tamper.started_)
      .kv("warmingUp", tamper.started_ && (now - tamper.startMs_) < tc.warmupMs)
      .kv("armed", !lockRecentlyUnlocked(HBR_TAMPER_GRACE_MS))
      .kv("alarm", alarm)
      .kv("alarmLeftMs", tamper.alarmLeftMs(now))
      .kv("alarmMs", alarm ? now - tamper.alarmStartMs_ : 0u)
      .kv("sinceJoltMs", alarm ? now - tamper.lastJoltMs_ : 0u)
      .kv("cooldownLeftMs", tamper.hasSignaled_ && since < tc.cooldownMs ? tc.cooldownMs - since : 0u)
      .kv("escalateLeftMs", !alarm && tamper.hasSignaled_ && sinceEsc <= tc.escalationWindowMs
                                ? tc.escalationWindowMs - sinceEsc : 0u)
      .end();

  j.key("reader").beginObject()
      .kv("healthy", healthy)
      .kv("waiting", detectionPending)
      .kv("failures", failures)
      .kv("polls", h.pnPolls)
      .kv("pollGapMs", h.pnPollGapMs)
      .kv("reads", h.pnReads)
      .kv("cardPresent", h.cardPresent)
      .kv("linked", h.pn532Linked)
      .kv("debounceLastMs", debouncer.hasLast_ ? (long long)(now - debouncer.lastSeenMs_) : -1LL)
      .end();

  j.key("accel").beginObject()
      .kv("healthy", tamperSensorHealthy())
      .kv("linked", h.mpuLinked)
      .kv("reads", h.mpuReads)
      .kv("readGapMs", h.mpuReadGapMs)
      .kv("accelConfig", h.mpuReg[0x1C])
      .kv("config", h.mpuReg[0x1A])
      .kv("asleep", (h.mpuReg[0x6B] & 0x40) != 0);
  j.key("raw").beginArray().val(h.mpuRaw[0]).val(h.mpuRaw[1]).val(h.mpuRaw[2]).end();
  j.key("g").beginArray().val(h.mpuG[0]).val(h.mpuG[1]).val(h.mpuG[2]).end();
  j.end();

  hbr::CardList &cards = cardStore();
  j.key("cards").beginObject()
      .kv("count", cards.count())
      .kv("capacity", cards.capacity())
      .kv("keySet", credentialKeyConfigured())
      .kv("ready", rackReady())
      .kv("mode", cardModeName(cardMode))
      .kv("modeLeftMs", cardMode == CardMode::Check ? 0LL : (long long)(int32_t)(cardModeUntilMs - now))
      .kv("eepromWrites", h.eepromWrites);
  j.key("refs").beginArray();
  uint8_t ref[hbr::kCardRefLength];
  for (uint8_t i = 0; i < cards.count(); i++) {
    if (cards.get(i, ref)) j.val(hexOf(ref, hbr::kCardRefLength));
  }
  j.end();
  j.end();

  j.key("watchdog").beginObject()
      .kv("on", h.wdtOn)
      .kv("timeoutMs", h.wdtTimeoutMs)
      .kv("sinceKickMs", (long long)((h.us - h.wdtKickUs) / 1000))
      .kv("kicks", h.wdtKicks)
      .end();

  j.kv("restart", h.restartRequested).kv("resetReason", h.resetReason);
  j.key("i2c").beginObject().kv("pn532", h.i2cTx[PN532_I2C_ADDRESS]).kv("mpu", h.i2cTx[0x68]).end();
  j.end();
  return finish(j);
}

// ---- the firmware's settings, straight from the compiled code ----
EMSCRIPTEN_KEEPALIVE const char *hbr_config() {
  model::Hw &h = hw();
  Json j;
  j.beginObject()
      .kv("firmwareVersion", HBR_FIRMWARE_VERSION)
      .kv("hasLocalConfig", HBR_HAS_LOCAL_CONFIG != 0)
      .kv("board", "Arduino Uno R3");

  j.key("pins").beginObject()
      .kv("sda", SDA).kv("scl", SCL).kv("servo", SERVO_SIGNAL_PIN)
      .kv("green", LED_GREEN_PIN).kv("red", LED_RED_PIN).kv("buzzer", BUZZER_PIN)
      .kv("pnIrq", PN532_IRQ_PIN).kv("pnReset", PN532_RESET_PIN)
      .end();

  // What setup() actually did to the hardware (read back from the emulated chips).
  j.key("seen").beginObject()
      .kv("baud", h.baud)
      .kv("i2cBegun", h.i2cBegun)
      .kv("i2cHz", h.i2cHz)
      .kv("i2cTimeoutUs", h.i2cTimeoutUs)
      .kv("servoPin", h.servoPin)
      .kv("servoHz", 1000000 / REFRESH_INTERVAL)
      .kv("servoMinUs", h.servoMinUs)
      .kv("servoMaxUs", h.servoMaxUs)
      .kv("mpuAccelConfig", h.mpuReg[0x1C])
      .kv("mpuConfig", h.mpuReg[0x1A])
      .kv("pnIrqPin", h.pnIrqPin)
      .kv("pnResetPin", h.pnResetPin)
      .kv("watchdogMs", h.wdtOn ? h.wdtTimeoutMs : 0u)
      .kv("cardCapacity", cardStore().capacity());
  j.key("badPins").beginArray();
  for (int p : h.badPins) j.val(p);
  j.end();
  j.end();

  const hbr::TamperConfig &tc = tamper.config();
  j.key("values").beginArray();
  const char *L = "Lock and servo", *F_ = "Lights and buzzer", *T = "Tamper detection", *C = "Card reader",
             *A = "Card list", *B = "Board";
#ifdef HBR_MODEL_SERVO_FROM_CONFIG
  const char *servoAngles = "include/config.h";  // build.mjs --local-config copied the two lines
#else
  const char *servoAngles = "include/device_config.h";
#endif
  value(j, L, "HBR_UNLOCK_DURATION_MS", HBR_UNLOCK_DURATION_MS, "ms", "include/device_config.h", "How long the lock stays open after an allowed card");
  value(j, L, "HBR_SERVO_LOCKED_DEG", HBR_SERVO_LOCKED_DEG, "deg", servoAngles, "Servo angle when locked");
  value(j, L, "HBR_SERVO_UNLOCKED_DEG", HBR_SERVO_UNLOCKED_DEG, "deg", servoAngles, "Servo angle when open");
  value(j, L, "kServoMinUs", kServoMinUs, "us", "src/lock.cpp", "Pulse for 0 degrees, passed to servo.attach()");
  value(j, L, "kServoMaxUs", kServoMaxUs, "us", "src/lock.cpp", "Pulse for 180 degrees");
  value(j, L, "HBR_ENABLE_SERVO", HBR_ENABLE_SERVO, "", "model/config.h", "1 = drive the servo (the model always does)");
  value(j, F_, "kIdleBlipEveryMs", hbr::kIdleBlipEveryMs, "ms", "lib/hbr_logic/src/feedback_player.h", "Idle heartbeat blip period");
  value(j, F_, "kIdleBlipMs", hbr::kIdleBlipMs, "ms", "lib/hbr_logic/src/feedback_player.h", "Idle blip length");
  value(j, T, "thresholdG", tc.thresholdG, "g", "lib/hbr_logic/src/tamper_detector.h", "Deviation from the baseline that counts as a jolt");
  value(j, T, "samplesToTrigger", tc.samplesToTrigger, "samples", "lib/hbr_logic/src/tamper_detector.h", "Jolt must last this many samples in a row");
  value(j, T, "baselineFollow", tc.baselineFollow, "", "lib/hbr_logic/src/tamper_detector.h", "How fast the baseline follows when calm");
  value(j, T, "baselineFollowShaking", tc.baselineFollowShaking, "", "lib/hbr_logic/src/tamper_detector.h", "How fast it follows while shaking");
  value(j, T, "warmupMs", tc.warmupMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "Learn the baseline this long after start");
  value(j, T, "cooldownMs", tc.cooldownMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "After a signal, ignore jolts this long");
  value(j, T, "escalationWindowMs", tc.escalationWindowMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "A jolt within this time of the last one, or of the siren stopping, is an alarm");
  value(j, T, "HBR_TAMPER_ALARM_MS", HBR_TAMPER_ALARM_MS, "ms", "include/device_config.h", "The siren runs at least this long");
  value(j, T, "HBR_TAMPER_ALARM_QUIET_MS", HBR_TAMPER_ALARM_QUIET_MS, "ms", "include/device_config.h", "...and until the post has been still this long");
  value(j, T, "HBR_TAMPER_SAMPLE_MS", HBR_TAMPER_SAMPLE_MS, "ms", "include/device_config.h", "Time between accelerometer readings");
  value(j, T, "HBR_TAMPER_GRACE_MS", HBR_TAMPER_GRACE_MS, "ms", "include/device_config.h", "Jolts ignored this long after a re-lock");
  value(j, C, "kPollEveryMs", kPollEveryMs, "ms", "src/card_reader.cpp", "How often the PN532 is asked if a card is there");
  value(j, C, "kRestAfterReadMs", kRestAfterReadMs, "ms", "src/card_reader.cpp", "Pause after reading a card");
  value(j, C, "kRetryInitEveryMs", kRetryInitEveryMs, "ms", "src/card_reader.cpp", "Retry a missing reader this often");
  value(j, C, "kFailuresBeforeUnhealthy", kFailuresBeforeUnhealthy, "", "src/card_reader.cpp", "Failed reads before the reader counts as faulty");
  value(j, C, "debouncer", debouncer.quietMs_, "ms", "src/main.cpp", "Same card ignored until it has been gone this long");
  value(j, C, "CARD_ID_MAX_LENGTH", CARD_ID_MAX_LENGTH, "bytes", "include/card_reader.h", "Longest card ID kept");
  value(j, A, "kCardRefLength", hbr::kCardRefLength, "bytes", "lib/hbr_logic/src/card_list.h", "Bytes saved per card: the first half of its HMAC reference");
  value(j, A, "HBR_ENROLL_WINDOW_MS", HBR_ENROLL_WINDOW_MS, "ms", "include/device_config.h", "After `enroll` or `unenroll`, how long the rack waits for the tap");
  value(j, B, "I2C_CLOCK_HZ", I2C_CLOCK_HZ, "Hz", "include/pins.h", "I2C bus speed");
  value(j, B, "HBR_ENABLE_WATCHDOG", HBR_ENABLE_WATCHDOG, "", "model/config.h", "1 = restart (and re-lock) if loop() freezes for 4 s");
  j.end();

  j.key("patterns").beginObject();
  steps(j, hbr::Pattern::Boot, 0);
  steps(j, hbr::Pattern::Granted, HBR_UNLOCK_DURATION_MS);
  steps(j, hbr::Pattern::Denied, 0);
  steps(j, hbr::Pattern::TamperWarning, 0);
  steps(j, hbr::Pattern::TamperAlarm, HBR_TAMPER_ALARM_MS);
  j.end();

  const model::Assumptions &m = h.assume;
  j.key("assumptions").beginObject()
      .kv("pn532DetectMs", m.pn532DetectMs)
      .kv("mpuNoiseG", m.mpuNoiseG)
      .kv("servoDegPerS", m.servoDegPerS)
      .kv("servoUs0", m.servoUs0)
      .kv("servoUs180", m.servoUs180)
      .end();
  j.end();
  return finish(j);
}

}  // extern "C"
