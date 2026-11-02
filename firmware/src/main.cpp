/* HokieBikeRack firmware. Shared file: keep it short and talk before changing it.
 * Each part lives in its own .h/.cpp pair; main.cpp just connects them.
 * Walkthrough of a card tap from start to finish: docs/notes/overview.md
 *
 * Two things run at the same time:
 *   - loop() (core 1): cards, tamper sensor, lock timer, lights/buzzer. Never waits on the network.
 *   - the network task (core 0, backend_sync.cpp): Wi-Fi, clock, card list, uploads.
 */
#include <Arduino.h>
#include <Wire.h>
#include <esp_system.h>

#include "access_policy.h"
#include "backend_sync.h"
#include "card_reader.h"
#include "credential_ref.h"
#include "device_config.h"
#include "device_status.h"
#include "event_queue.h"
#include "feedback.h"
#include "hbr_util.h"
#include "lock.h"
#include "pins.h"
#include "tamper_detector.h"
#include "tamper_sensor.h"

namespace {
hbr::TamperDetector tamper([] {
  hbr::TamperConfig c;
  c.alarmDurationMs = HBR_TAMPER_ALARM_MS;
  return c;
}());
hbr::CardDebouncer debouncer(2000);
uint32_t lastTamperSampleMs = 0;
bool readerWasOk = true;
bool accelWasOk = true;
bool simShakeActive = false;  // serial `shake` command
uint32_t simShakeUntilMs = 0;

// Only the first 12 characters are printed: enough to recognise a card in
// the dashboard, without dumping the full reference into logs.
String shortRef(const std::string &ref) { return String(ref.substr(0, 12).c_str()) + "..."; }

void handleCard(const CardId &card) {
  std::string ref;
  if (!credentialRefFromCard(card, ref)) {
    Serial.println("[card] read a card, but HBR_CARD_KEY isn't set in config.h -> denied");
    if (debouncer.shouldProcess(hbr::toHex(card.bytes, card.length), millis()))
      feedbackPlay(hbr::Pattern::Denied);
    return;
  }
  if (!debouncer.shouldProcess(ref, millis())) return;  // same card still on the reader
  Serial.printf("[card] read a %u-byte card ID\n", card.length);  // length only, never the ID

  hbr::AccessResult result = accessPolicyCheck(ref);
  JsonDocument details;
  details["credentialReference"] = ref;
  if (result.allowed) {
    Serial.printf("[card] %s ALLOWED\n", shortRef(ref).c_str());
    lockRequestUnlock();
    // An allowed card also silences a tamper alarm (the owner is back).
    tamper.silence();
    feedbackStop();
    feedbackPlay(hbr::Pattern::Granted, HBR_UNLOCK_DURATION_MS);
    eventQueuePush("ACCESS_GRANTED", "INFO", details);
  } else {
    const char *reason = hbr::denyReasonName(result.reason);
    Serial.printf("[card] %s DENIED (%s)\n", shortRef(ref).c_str(), reason);
    feedbackPlay(hbr::Pattern::Denied);
    details["reason"] = reason;
    eventQueuePush("ACCESS_DENIED", "LOW", details);
  }
  backendSyncRequestUpload();
}

void handleTamperSignal(hbr::TamperSignal signal) {
  if (signal == hbr::TamperSignal::None) return;
  JsonDocument details;
  details["deviationG"] = roundf(tamper.lastDeviationG() * 100) / 100;
  details["thresholdG"] = tamper.config().thresholdG;
  if (signal == hbr::TamperSignal::Warning) {
    Serial.printf("[tamper] WARNING (%.2f g)\n", tamper.lastDeviationG());
    feedbackPlay(hbr::Pattern::TamperWarning);
    eventQueuePush("TAMPER_WARNING", "MEDIUM", details);
  } else {
    Serial.printf("[tamper] ALARM (%.2f g) - siren for %u s\n", tamper.lastDeviationG(),
                  (unsigned)(HBR_TAMPER_ALARM_MS / 1000));
    feedbackPlay(hbr::Pattern::TamperAlarm, HBR_TAMPER_ALARM_MS);
    eventQueuePush("TAMPER_ALARM", "HIGH", details);
  }
  backendSyncRequestUpload();
}

void sampleTamperSensor() {
  uint32_t now = millis();
  if (now - lastTamperSampleMs < HBR_TAMPER_SAMPLE_MS) return;
  lastTamperSampleMs = now;
  AccelReading r;
  bool have = tamperSensorRead(r);
  if (simShakeActive) {
    // Fake readings from the serial `shake` command (for testing without shaking).
    have = true;
    r = {((now / 20) % 2) ? 0.9f : -0.9f, 0.0f, 1.0f};
    if (static_cast<int32_t>(now - simShakeUntilMs) >= 0) simShakeActive = false;
  } else if (!have) {
    return;
  }
  // Don't treat a rider pulling their bike out as tampering.
  bool armed = !lockRecentlyUnlocked(HBR_TAMPER_GRACE_MS);
  handleTamperSignal(tamper.update(r.x, r.y, r.z, now, armed));
  deviceStatus.lastDeviationG = tamper.lastDeviationG();
}

void reportSensorChanges() {
  bool readerOk = cardReaderHealthy();
  bool accelOk = tamperSensorHealthy();
  deviceStatus.readerOk = readerOk;
  deviceStatus.accelOk = accelOk;
  if (readerOk != readerWasOk) {
    JsonDocument d;
    d["sensor"] = "PN532";
    d["state"] = readerOk ? "RECOVERED" : "NOT_RESPONDING";
    eventQueuePush("SENSOR_FAULT", readerOk ? "INFO" : "MEDIUM", d);
    readerWasOk = readerOk;
  }
  if (accelOk != accelWasOk) {
    JsonDocument d;
    d["sensor"] = "MPU6050";
    d["state"] = accelOk ? "RECOVERED" : "NOT_RESPONDING";
    eventQueuePush("SENSOR_FAULT", accelOk ? "INFO" : "MEDIUM", d);
    accelWasOk = accelOk;
  }
}

void printStatus() {
  AccessPolicyInfo info = accessPolicyInfo();
  int64_t now = deviceNowEpoch();
  Serial.println("---- HokieBikeRack status ----");
  Serial.printf("firmware %s, uptime %lu s, free heap %u\n", HBR_FIRMWARE_VERSION,
                (unsigned long)(millis() / 1000), (unsigned)ESP.getFreeHeap());
  Serial.printf("config.h %s, network %s, Wi-Fi %s\n", HBR_HAS_LOCAL_CONFIG ? "found" : "MISSING",
                backendSyncConfigured() ? "configured" : "NOT configured",
                backendSyncWifiConnected() ? "connected" : "disconnected");
  Serial.printf("clock %s\n", now ? hbr::formatIsoUtc(now).c_str() : "NOT SET");
  Serial.printf("card list: %s, revision %llu, %u cards, valid until %s\n",
                info.loaded ? "yes" : "none", (unsigned long long)info.revision,
                (unsigned)info.cardCount, hbr::formatIsoUtc(info.validUntilEpoch).c_str());
  Serial.printf("ready for cards: %s, card key %s\n", accessPolicyReady() ? "YES" : "NO",
                credentialKeyConfigured() ? "set" : "MISSING");
  Serial.printf("reader %s, accelerometer %s (last %.2f g), servo %s, lock %s\n",
                cardReaderHealthy() ? "OK" : "FAULT", tamperSensorHealthy() ? "OK" : "FAULT",
                tamper.lastDeviationG(), lockServoEnabled() ? "REAL" : "simulated",
                lockIsCommandedUnlocked() ? "UNLOCKED" : "locked");
  Serial.printf("events waiting to upload: %u\n", (unsigned)eventQueueCount());
}

// Tiny serial console. Type a command in the PlatformIO serial monitor + Enter.
void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c != '\n') {
      if (line.length() < 64) line += c;
      continue;
    }
    line.trim();
    if (line == "status") {
      printStatus();
    } else if (line == "sync") {
      backendSyncRequestSnapshot();
      backendSyncRequestUpload();
      Serial.println("ok: asked the network task to sync now");
    } else if (line == "forget-snapshot") {
      accessPolicyForget();
      backendSyncRequestSnapshot();
      Serial.println("ok: card list forgotten; downloading a fresh one");
    } else if (line == "clear-queue") {
      eventQueueClear();
      Serial.println("ok: event queue cleared");
    } else if (line == "reboot") {
      ESP.restart();
    } else if (line == "i2c-scan") {
      // Who answers on the I2C bus? Expect 0x24 (PN532) and 0x68 (MPU-6050).
      Serial.println("Scanning I2C bus...");
      int found = 0;
      for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
          Serial.printf("  found 0x%02X%s\n", addr,
                        addr == 0x24 ? " (PN532)" : addr == 0x68 ? " (MPU-6050)" : addr == 0x69 ? " (MPU-6050, AD0 high)" : "");
          found++;
        }
      }
      Serial.printf("%d device(s). None? Check SDA=21, SCL=22, power, GND, and the PN532 I2C switches.\n", found);
    } else if (line == "accel") {
      // 2 seconds of raw readings, for calibrating the tamper threshold.
      // (This command pauses the rack for 2 s; it's only for testing.)
      for (int i = 0; i < 20; i++) {
        AccelReading r;
        if (tamperSensorRead(r)) {
          Serial.printf("  x=%+.3f y=%+.3f z=%+.3f g   deviation from baseline %.3f g (threshold %.2f)\n",
                        r.x, r.y, r.z, tamper.lastDeviationG(), tamper.config().thresholdG);
        } else {
          Serial.println("  no reading (sensor fault?)");
        }
        delay(100);
      }
#if HBR_ENABLE_SERIAL_SIM
    } else if (line.startsWith("tap ")) {
      // Pretend a card with this ID (hex) was tapped. Goes through the exact
      // same path as a real card, so it can only unlock for a registered card.
      String hex = line.substring(4);
      hex.trim();
      CardId card{};
      for (size_t i = 0; i + 1 < hex.length() && card.length < CARD_ID_MAX_LENGTH; i += 2) {
        card.bytes[card.length++] = static_cast<uint8_t>(strtoul(hex.substring(i, i + 2).c_str(), nullptr, 16));
      }
      if (card.length) handleCard(card);
      else Serial.println("usage: tap 04a1b2c3d4");
    } else if (line == "shake") {
      simShakeActive = true;
      simShakeUntilMs = millis() + 400;
      Serial.println("ok: simulating a 0.4 s shake");
#endif
    } else if (line.length()) {
      Serial.println("commands: status, sync, forget-snapshot, clear-queue, reboot, i2c-scan, accel"
#if HBR_ENABLE_SERIAL_SIM
                     ", tap <hex-id>, shake"
#endif
      );
    }
    line = "";
  }
}

const char *resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "POWER_ON";
    case ESP_RST_SW: return "SOFTWARE";
    case ESP_RST_PANIC: return "CRASH";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "WATCHDOG";
    case ESP_RST_BROWNOUT: return "BROWNOUT";  // power dipped: often the servo!
    case ESP_RST_DEEPSLEEP: return "DEEP_SLEEP";
    default: return "OTHER";
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nHokieBikeRack firmware %s starting\n", HBR_FIRMWARE_VERSION);
  if (!HBR_HAS_LOCAL_CONFIG) Serial.println("No include/config.h found: offline, all cards denied.");

  // Lights/buzzer and lock first, so outputs are in a known safe state early.
  feedbackSetup();
  lockSetup();

  if (!eventQueueSetup()) Serial.println("Event queue storage unavailable; events will not be saved.");
  accessPolicySetup();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_CLOCK_HZ);
  readerWasOk = cardReaderSetup();
  accelWasOk = tamperSensorSetup();
  deviceStatus.readerOk = readerWasOk;
  deviceStatus.accelOk = accelWasOk;

  JsonDocument boot;
  esp_reset_reason_t reason = esp_reset_reason();
  boot["resetReason"] = resetReasonName(reason);
  boot["servoEnabled"] = lockServoEnabled();
  boot["readerOk"] = readerWasOk;
  boot["accelOk"] = accelWasOk;
  eventQueuePush("DEVICE_BOOT", reason == ESP_RST_BROWNOUT ? "MEDIUM" : "INFO", boot);
  if (!readerWasOk) {
    JsonDocument d;
    d["sensor"] = "PN532";
    d["state"] = "NOT_FOUND_AT_BOOT";
    eventQueuePush("SENSOR_FAULT", "MEDIUM", d);
  }
  if (!accelWasOk) {
    JsonDocument d;
    d["sensor"] = "MPU6050";
    d["state"] = "NOT_FOUND_AT_BOOT";
    eventQueuePush("SENSOR_FAULT", "MEDIUM", d);
  }

  feedbackPlay(hbr::Pattern::Boot);
  backendSyncSetup();
  Serial.println("Ready. Type `status` in the serial monitor for details.");
}

void loop() {
  handleSerial();

  // Card tapped -> decide locally (never depends on Wi-Fi) -> unlock or deny.
  CardId card;
  if (cardReaderPoll(card)) handleCard(card);

  // Shaking -> warning, then alarm. Never moves the lock.
  sampleTamperSensor();

  lockUpdate();
  deviceStatus.lockUnlocked = lockIsCommandedUnlocked();
  deviceStatus.alarmActive = tamper.alarmActive(millis());
  reportSensorChanges();

  feedbackSetReady(accessPolicyReady() && credentialKeyConfigured() && cardReaderHealthy());
  feedbackUpdate();

  // Short pause so the loop runs a few hundred times a second: fast enough
  // for smooth patterns and quick card reads, while letting other tasks run.
  // Avoid long delay() calls anywhere: they freeze everything else.
  delay(2);
}
