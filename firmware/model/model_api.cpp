// The firmware model's entry point (firmware/model/README.md).
//
// This file #includes the REAL firmware files below, unchanged, so they end up in the same
// compile unit as the functions the page calls. That lets the page look at their internal
// state (the tamper detector's baseline, the re-lock timer, the card reader's poll timing)
// without adding a single line to src/. Everything the rack does comes from those files; this
// file only starts them, steps the clock and reports what they did.
//
// Built by tools/model/build.mjs into frontend/model/firmware.js.
#include <emscripten/emscripten.h>

// Library headers first, so the trick below cannot touch them.
#include <Arduino.h>
#include <ArduinoJson.h>

#include <algorithm>
#include <atomic>
#include <string>
#include <vector>

// Read-only peek at private members (baseline, timers) for the page. Changes no behaviour:
// the same classes are compiled the normal way in lib/hbr_logic/.
#define private public
#include "feedback_player.h"
#include "hbr_util.h"
#include "lock_controller.h"
#include "tamper_detector.h"
#undef private

// ---- the real firmware ----
#include "../src/main.cpp"          // setup(), loop(), card + tamper handling, serial console
#include "../src/lock.cpp"          // re-lock timer -> servo
#include "../src/feedback.cpp"      // light + buzzer patterns -> GPIO pins
#include "../src/backend_sync.cpp"  // the network task: Wi-Fi, clock, card list, uploads
#include "../src/card_reader.cpp"   // PN532 polling
// (tamper_sensor.cpp, access_policy.cpp, event_queue.cpp, credential_ref.cpp, device_status.cpp
// and lib/hbr_logic/ are compiled as their own files.)

#include "hw.h"

namespace model {
void seedRandom(uint32_t seed);
void resetChips();
}  // namespace model

namespace {
using model::hw;

std::string out;  // returned strings live here until the next call
uint32_t seenSampleMs = 0;
struct Sample {
  uint32_t ms;
  float deviation;
  uint8_t over;
  bool armed;
};
std::vector<Sample> samples;

const char *finish(const JsonDocument &doc) {
  out.clear();
  serializeJson(doc, out);
  return out.c_str();
}

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

bool parseUid(const char *hex, uint8_t *bytes, uint8_t &length) {
  length = 0;
  size_t n = hex ? strlen(hex) : 0;
  for (size_t i = 0; i + 1 < n && length < CARD_ID_MAX_LENGTH; i += 2) {
    char pair[3] = {hex[i], hex[i + 1], 0};
    bytes[length++] = static_cast<uint8_t>(strtoul(pair, nullptr, 16));
  }
  return length > 0;
}

// One firmware value for the page's "Values" list. `file` is relative to firmware/; the build
// script looks up the line where `id` is defined.
void value(JsonArray list, const char *group, const char *id, double v, const char *unit, const char *file,
           const char *what) {
  JsonObject o = list.add<JsonObject>();
  o["group"] = group;
  o["id"] = id;
  o["value"] = v;
  o["unit"] = unit;
  o["file"] = file;
  o["what"] = what;
}

void steps(JsonObject patterns, hbr::Pattern p, uint32_t hold) {
  JsonArray a = patterns[patternName(p)].to<JsonArray>();
  for (const hbr::Step &s : hbr::FeedbackPlayer::stepsFor(p, hold)) {
    JsonArray step = a.add<JsonArray>();
    step.add(s.ms);
    step.add(s.red);
    step.add(s.green);
    step.add(s.buzzer);
  }
}
}  // namespace

extern "C" {

// Power on: start the firmware's setup(). Call once per module instance; a reboot makes a
// new instance (fresh RAM) and copies the flash files across first.
EMSCRIPTEN_KEEPALIVE void hbr_boot(int resetReason, double worldEpochSeconds, uint32_t seed) {
  hw().resetReason = resetReason;
  hw().worldEpochAtBoot = worldEpochSeconds;
  model::seedRandom(seed);
  model::resetChips();
  setup();
}

// Run loop() (and the network task, in turns) until the clock reaches `ms` since boot.
EMSCRIPTEN_KEEPALIVE void hbr_run_until(double ms) {
  uint64_t target = static_cast<uint64_t>(ms * 1000.0);
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
}

EMSCRIPTEN_KEEPALIVE double hbr_now_ms() { return static_cast<double>(hw().us) / 1000.0; }
EMSCRIPTEN_KEEPALIVE int hbr_restart_requested() { return hw().restartRequested ? 1 : 0; }

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
EMSCRIPTEN_KEEPALIVE void hbr_hotspot(int on) {
  if (on && !hw().hotspotOn) hw().hotspotOnUs = hw().us;
  hw().hotspotOn = on != 0;
}
EMSCRIPTEN_KEEPALIVE void hbr_serial_write(const char *text) {
  if (text) hw().serialIn += text;
}

// The same reference src/credential_ref.cpp makes for a card (the model server uses it to
// pre-register the kit card, like an admin would).
EMSCRIPTEN_KEEPALIVE const char *hbr_card_ref(const char *uidHex) {
  CardId card{};
  out.clear();
  if (parseUid(uidHex, card.bytes, card.length)) credentialRefFromCard(card, out);
  return out.c_str();
}

// ---- flash, kept by the page across a reboot ----
EMSCRIPTEN_KEEPALIVE const char *hbr_flash_json() {
  JsonDocument doc;
  for (const auto &f : hw().files) doc[f.first] = f.second;
  return finish(doc);
}
EMSCRIPTEN_KEEPALIVE void hbr_flash_put(const char *path, const char *content) {
  if (path && content) hw().files[path] = content;
}
EMSCRIPTEN_KEEPALIVE const char *hbr_flash_file(const char *path) {
  auto it = hw().files.find(path ? path : "");
  out = it == hw().files.end() ? "" : it->second;
  return out.c_str();
}

// ---- everything that happened since the last call: pin edges, servo pulses, tamper samples,
// event lines written to flash, and serial output ----
EMSCRIPTEN_KEEPALIVE const char *hbr_take_log() {
  model::Hw &h = hw();
  JsonDocument doc;
  JsonArray edges = doc["edges"].to<JsonArray>();
  for (const model::Edge &e : h.edges) {
    JsonArray a = edges.add<JsonArray>();
    a.add(e.ms);
    a.add(e.pin);
    a.add(e.level);
  }
  JsonArray servoLog = doc["servo"].to<JsonArray>();
  for (const auto &s : h.servoLog) {
    JsonArray a = servoLog.add<JsonArray>();
    a.add(s.first);
    a.add(s.second);
  }
  JsonArray sampleLog = doc["samples"].to<JsonArray>();
  for (const Sample &s : samples) {
    JsonArray a = sampleLog.add<JsonArray>();
    a.add(s.ms);
    a.add(roundf(s.deviation * 1000) / 1000);
    a.add(s.over);
    a.add(s.armed);
  }
  JsonArray events = doc["events"].to<JsonArray>();
  for (const std::string &line : h.eventLines) events.add(line);
  doc["serial"] = h.serialOut;
  h.edges.clear();
  h.servoLog.clear();
  samples.clear();
  h.eventLines.clear();
  h.serialOut.clear();
  return finish(doc);
}

// ---- the firmware's state right now ----
EMSCRIPTEN_KEEPALIVE const char *hbr_state() {
  model::Hw &h = hw();
  uint32_t now = millis();
  JsonDocument doc;
  doc["ms"] = now;

  JsonObject lock = doc["lock"].to<JsonObject>();
  lock["unlocked"] = controller.unlocked_;
  lock["leftMs"] = controller.unlocked_ ? (int32_t)(controller.unlockMs_ - (now - controller.unlockedAtMs_)) : 0;
  lock["sinceUnlockMs"] = controller.everUnlocked_ ? (int64_t)(now - controller.unlockedAtMs_) : -1;
  lock["servoUs"] = h.servoUs;
  lock["servoAttached"] = servo.attached();
  lock["servoWrites"] = h.servoWrites;

  JsonObject fb = doc["feedback"].to<JsonObject>();
  fb["pattern"] = patternName(player.current_);
  fb["elapsedMs"] = player.current_ == hbr::Pattern::None ? 0 : now - player.startMs_;
  fb["ready"] = player.ready_;
  fb["red"] = h.level[LED_RED_PIN];
  fb["green"] = h.level[LED_GREEN_PIN];
  fb["buzzer"] = h.level[BUZZER_PIN];

  const hbr::TamperConfig &tc = tamper.config();
  JsonObject t = doc["tamper"].to<JsonObject>();
  t["deviationG"] = tamper.lastDeviation_;
  t["over"] = tamper.overCount_;
  JsonArray base = t["baseline"].to<JsonArray>();
  base.add(tamper.baseX_);
  base.add(tamper.baseY_);
  base.add(tamper.baseZ_);
  t["started"] = tamper.started_;
  t["warmingUp"] = tamper.started_ && (now - tamper.startMs_) < tc.warmupMs;
  t["armed"] = !lockRecentlyUnlocked(HBR_TAMPER_GRACE_MS);
  bool alarm = tamper.alarmActive(now);
  t["alarm"] = alarm;
  t["alarmLeftMs"] = alarm ? tc.alarmDurationMs - (now - tamper.alarmStartMs_) : 0;
  uint32_t since = now - tamper.lastSignalMs_;
  t["cooldownLeftMs"] = tamper.hasSignaled_ && since < tc.cooldownMs ? tc.cooldownMs - since : 0;
  t["escalateLeftMs"] = tamper.hasSignaled_ && since <= tc.escalationWindowMs ? tc.escalationWindowMs - since : 0;

  JsonObject r = doc["reader"].to<JsonObject>();
  r["healthy"] = healthy;
  r["waiting"] = detectionPending;
  r["failures"] = failures;
  r["polls"] = h.pnPolls;
  r["pollGapMs"] = h.pnPollGapMs;
  r["reads"] = h.pnReads;
  r["cardPresent"] = h.cardPresent;
  r["linked"] = h.pn532Linked;
  r["debounceLastMs"] = debouncer.hasLast_ ? static_cast<int64_t>(now - debouncer.lastSeenMs_) : -1;

  JsonObject a = doc["accel"].to<JsonObject>();
  a["healthy"] = tamperSensorHealthy();
  a["linked"] = h.mpuLinked;
  a["reads"] = h.mpuReads;
  a["readGapMs"] = h.mpuReadGapMs;
  a["accelConfig"] = h.mpuReg[0x1C];
  a["config"] = h.mpuReg[0x1A];
  a["asleep"] = (h.mpuReg[0x6B] & 0x40) != 0;
  JsonArray raw = a["raw"].to<JsonArray>();
  JsonArray g = a["g"].to<JsonArray>();
  for (int i = 0; i < 3; i++) {
    raw.add(h.mpuRaw[i]);
    g.add(h.mpuG[i]);
  }

  JsonObject n = doc["net"].to<JsonObject>();
  n["wifi"] = deviceStatus.wifiConnected.load();
  n["hotspot"] = h.hotspotOn;
  n["configured"] = backendSyncConfigured();
  n["lastSyncOk"] = deviceStatus.lastSyncOk.load();
  n["http"] = h.httpRequests;
  n["backoffMs"] = uploadBackoffMs;
  n["taskRuns"] = h.taskRuns;
  n["taskName"] = h.taskName;
  n["taskCore"] = h.taskCore;
  n["nextSnapshotMs"] = lastSnapshotMs ? (int32_t)(kSnapshotEveryMs - (now - lastSnapshotMs)) : 0;
  n["sinceUploadMs"] = now - lastUploadMs;

  AccessPolicyInfo info = accessPolicyInfo();
  JsonObject ac = doc["access"].to<JsonObject>();
  ac["loaded"] = info.loaded;
  ac["revision"] = info.revision;
  ac["validUntil"] = info.validUntilEpoch;
  ac["cards"] = info.cardCount;
  ac["ready"] = accessPolicyReady();
  ac["keySet"] = credentialKeyConfigured();

  doc["epoch"] = deviceNowEpoch();
  doc["queue"] = eventQueueCount();
  doc["restart"] = h.restartRequested;

  JsonObject bus = doc["i2c"].to<JsonObject>();
  bus["pn532"] = h.i2cTx[PN532_I2C_ADDRESS];
  bus["mpu"] = h.i2cTx[0x68];
  return finish(doc);
}

// ---- the firmware's settings, straight from the compiled code ----
EMSCRIPTEN_KEEPALIVE const char *hbr_config() {
  model::Hw &h = hw();
  JsonDocument doc;
  doc["firmwareVersion"] = HBR_FIRMWARE_VERSION;
  doc["hasLocalConfig"] = HBR_HAS_LOCAL_CONFIG != 0;

  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["sda"] = I2C_SDA_PIN;
  pins["scl"] = I2C_SCL_PIN;
  pins["servo"] = SERVO_SIGNAL_PIN;
  pins["green"] = LED_GREEN_PIN;
  pins["red"] = LED_RED_PIN;
  pins["buzzer"] = BUZZER_PIN;

  // What setup() actually did to the hardware (read back from the emulated chips).
  JsonObject seen = doc["seen"].to<JsonObject>();
  seen["baud"] = h.baud;
  seen["i2cSda"] = h.sda;
  seen["i2cScl"] = h.scl;
  seen["i2cHz"] = h.i2cHz;
  seen["servoPin"] = h.servoPin;
  seen["servoHz"] = h.servoHz;
  seen["servoMinUs"] = h.servoMinUs;
  seen["servoMaxUs"] = h.servoMaxUs;
  seen["mpuAccelConfig"] = h.mpuReg[0x1C];
  seen["mpuConfig"] = h.mpuReg[0x1A];
  seen["taskName"] = h.taskName;
  seen["taskStack"] = h.taskStack;
  seen["taskCore"] = h.taskCore;

  const hbr::TamperConfig &tc = tamper.config();
  JsonArray v = doc["values"].to<JsonArray>();
  const char *L = "Lock and servo", *F = "Lights and buzzer", *T = "Tamper detection", *C = "Card reader",
             *N = "Network task", *A = "Card list";
#ifdef HBR_MODEL_SERVO_FROM_CONFIG
  const char *servoAngles = "include/config.h";  // build.mjs --local-config copied the two lines
#else
  const char *servoAngles = "include/device_config.h";
#endif
  value(v, L, "HBR_UNLOCK_DURATION_MS", HBR_UNLOCK_DURATION_MS, "ms", "include/device_config.h", "How long the lock stays open after an allowed card");
  value(v, L, "HBR_SERVO_LOCKED_DEG", HBR_SERVO_LOCKED_DEG, "deg", servoAngles, "Servo angle when locked");
  value(v, L, "HBR_SERVO_UNLOCKED_DEG", HBR_SERVO_UNLOCKED_DEG, "deg", servoAngles, "Servo angle when open");
  value(v, L, "kServoMinUs", kServoMinUs, "us", "src/lock.cpp", "Pulse for 0 degrees, passed to servo.attach()");
  value(v, L, "kServoMaxUs", kServoMaxUs, "us", "src/lock.cpp", "Pulse for 180 degrees");
  value(v, L, "HBR_ENABLE_SERVO", HBR_ENABLE_SERVO, "", "model/config.h", "1 = drive the servo (the model always does)");
  value(v, F, "kIdleBlipEveryMs", hbr::kIdleBlipEveryMs, "ms", "lib/hbr_logic/src/feedback_player.h", "Idle heartbeat blip period");
  value(v, F, "kIdleBlipMs", hbr::kIdleBlipMs, "ms", "lib/hbr_logic/src/feedback_player.h", "Idle blip length");
  value(v, T, "thresholdG", tc.thresholdG, "g", "lib/hbr_logic/src/tamper_detector.h", "Deviation from the baseline that counts as a jolt");
  value(v, T, "samplesToTrigger", tc.samplesToTrigger, "samples", "lib/hbr_logic/src/tamper_detector.h", "Jolt must last this many samples in a row");
  value(v, T, "baselineFollow", tc.baselineFollow, "", "lib/hbr_logic/src/tamper_detector.h", "How fast the baseline follows when calm");
  value(v, T, "baselineFollowShaking", tc.baselineFollowShaking, "", "lib/hbr_logic/src/tamper_detector.h", "How fast it follows while shaking");
  value(v, T, "warmupMs", tc.warmupMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "Learn the baseline this long after start");
  value(v, T, "cooldownMs", tc.cooldownMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "After a signal, ignore jolts this long");
  value(v, T, "escalationWindowMs", tc.escalationWindowMs, "ms", "lib/hbr_logic/src/tamper_detector.h", "A jolt within this time of the last one is an alarm");
  value(v, T, "HBR_TAMPER_ALARM_MS", HBR_TAMPER_ALARM_MS, "ms", "include/device_config.h", "Siren length (main.cpp passes it to the detector)");
  value(v, T, "HBR_TAMPER_SAMPLE_MS", HBR_TAMPER_SAMPLE_MS, "ms", "include/device_config.h", "Time between accelerometer readings");
  value(v, T, "HBR_TAMPER_GRACE_MS", HBR_TAMPER_GRACE_MS, "ms", "include/device_config.h", "Jolts ignored this long after a re-lock");
  value(v, C, "kPollEveryMs", kPollEveryMs, "ms", "src/card_reader.cpp", "How often the PN532 is asked if a card is there");
  value(v, C, "kRestAfterReadMs", kRestAfterReadMs, "ms", "src/card_reader.cpp", "Pause after reading a card");
  value(v, C, "kRetryInitEveryMs", kRetryInitEveryMs, "ms", "src/card_reader.cpp", "Retry a missing reader this often");
  value(v, C, "kFailuresBeforeUnhealthy", kFailuresBeforeUnhealthy, "", "src/card_reader.cpp", "Failed reads before the reader counts as faulty");
  value(v, C, "debouncer", debouncer.quietMs_, "ms", "src/main.cpp", "Same card ignored until it has been gone this long");
  value(v, C, "CARD_ID_MAX_LENGTH", CARD_ID_MAX_LENGTH, "bytes", "include/card_reader.h", "Longest card ID kept");
  value(v, A, "kEarliestPlausibleEpoch", static_cast<double>(hbr::kEarliestPlausibleEpoch), "s", "lib/hbr_logic/src/hbr_util.h", "Earlier clock = not set");
  value(v, A, "kMaxSnapshotRefs", hbr::kMaxSnapshotRefs, "cards", "lib/hbr_logic/src/access_rules.h", "Most cards in one card list");
  value(v, N, "kTaskTickMs", kTaskTickMs, "ms", "src/backend_sync.cpp", "Network task wakes up this often");
  value(v, N, "kSnapshotEveryMs", kSnapshotEveryMs, "ms", "src/backend_sync.cpp", "Card list download period");
  value(v, N, "kHeartbeatEveryMs", kHeartbeatEveryMs, "ms", "src/backend_sync.cpp", "Heartbeat period");
  value(v, N, "kIdleUploadEveryMs", kIdleUploadEveryMs, "ms", "src/backend_sync.cpp", "Retry leftover events this often");
  value(v, N, "kWifiRetryEveryMs", kWifiRetryEveryMs, "ms", "src/backend_sync.cpp", "Wi-Fi reconnect attempts");
  value(v, N, "kMaxBackoffMs", kMaxBackoffMs, "ms", "src/backend_sync.cpp", "Longest wait between failed uploads");
  value(v, N, "kBatchLimit", kBatchLimit, "events", "src/backend_sync.cpp", "Events per upload");

  JsonObject patterns = doc["patterns"].to<JsonObject>();
  steps(patterns, hbr::Pattern::Boot, 0);
  steps(patterns, hbr::Pattern::Granted, HBR_UNLOCK_DURATION_MS);
  steps(patterns, hbr::Pattern::Denied, 0);
  steps(patterns, hbr::Pattern::TamperWarning, 0);
  steps(patterns, hbr::Pattern::TamperAlarm, HBR_TAMPER_ALARM_MS);

  const model::Assumptions &m = h.assume;
  JsonObject as = doc["assumptions"].to<JsonObject>();
  as["wifiConnectMs"] = m.wifiConnectMs;
  as["ntpDelayMs"] = m.ntpDelayMs;
  as["pn532DetectMs"] = m.pn532DetectMs;
  as["mpuNoiseG"] = m.mpuNoiseG;
  as["servoDegPerS"] = m.servoDegPerS;
  as["servoUs0"] = m.servoUs0;
  as["servoUs180"] = m.servoUs180;
  return finish(doc);
}

}  // extern "C"
