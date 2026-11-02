#include "card_reader.h"

#include <Adafruit_PN532.h>
#include <Arduino.h>
#include <Wire.h>

#include "pins.h"

namespace {
constexpr uint32_t kPollEveryMs = 50;        // how often to check "is a card there?"
constexpr uint32_t kRestAfterReadMs = 150;   // short pause after a read
constexpr uint32_t kRetryInitEveryMs = 15000;
constexpr uint8_t kFailuresBeforeUnhealthy = 5;

Adafruit_PN532 *nfc = nullptr;
bool healthy = false;
bool detectionPending = false;  // we told the PN532 to wait for a card
uint32_t lastPollMs = 0;
uint32_t resumeAtMs = 0;
uint32_t lastInitAttemptMs = 0;
uint8_t failures = 0;

bool initReader() {
  lastInitAttemptMs = millis();
  detectionPending = false;
  failures = 0;
  if (!nfc) {
    // Created here (not as a global) so pinMode() inside the constructor runs
    // after the Arduino core has started.
    nfc = new Adafruit_PN532(static_cast<uint8_t>(PN532_IRQ_PIN),
                             static_cast<uint8_t>(PN532_RESET_PIN), &Wire);
  }
  if (!nfc->begin()) return false;
  uint32_t version = nfc->getFirmwareVersion();
  if (!version) return false;  // nothing answered at address 0x24
  Serial.printf("[nfc] PN5%02X firmware %u.%u\n", (unsigned)((version >> 24) & 0xFF),
                (unsigned)((version >> 16) & 0xFF), (unsigned)((version >> 8) & 0xFF));
  // SAM = "Security Access Module" config; this call just puts the PN532 in
  // normal card-reading mode.
  if (!nfc->SAMConfig()) return false;
  // 0xFF = keep waiting for a card forever once asked. Fine, because we only
  // poll the "ready" flag and never block waiting for it.
  nfc->setPassiveActivationRetries(0xFF);
  return true;
}

void markFailure() {
  if (++failures >= kFailuresBeforeUnhealthy && healthy) {
    healthy = false;
    Serial.println("[nfc] reader stopped answering; will retry");
  }
}
}  // namespace

bool cardReaderSetup() {
  healthy = initReader();
  if (!healthy) Serial.println("[nfc] PN532 not found. Check wiring and the I2C DIP switches.");
  return healthy;
}

bool cardReaderHealthy() { return healthy; }

bool cardReaderPoll(CardId &card) {
  uint32_t now = millis();
  if (!healthy) {
    if (now - lastInitAttemptMs >= kRetryInitEveryMs) {
      healthy = initReader();
      if (healthy) Serial.println("[nfc] reader is back");
    }
    return false;
  }

  if (!detectionPending) {
    if (static_cast<int32_t>(now - resumeAtMs) < 0) return false;
    // "Tell me when an ISO14443A card (MIFARE/NTAG) shows up." Waits for the
    // PN532's quick acknowledgement (a few ms), not for a card.
    if (!nfc->startPassiveTargetIDDetection(PN532_MIFARE_ISO14443A)) {
      markFailure();
      resumeAtMs = now + 200;
      return false;
    }
    detectionPending = true;
    lastPollMs = now;
    return false;
  }

  if (now - lastPollMs < kPollEveryMs) return false;
  lastPollMs = now;

  // Over I2C, the PN532's first byte is a status flag: 0x01 = "answer ready".
  if (Wire.requestFrom(static_cast<uint8_t>(PN532_I2C_ADDRESS), static_cast<uint8_t>(1)) != 1) {
    markFailure();  // nobody answered: unplugged or bus problem
    return false;
  }
  uint8_t status = Wire.read();
  failures = 0;
  if (status != PN532_I2C_READY) return false;  // still waiting for a card

  detectionPending = false;
  resumeAtMs = now + kRestAfterReadMs;
  uint8_t uid[CARD_ID_MAX_LENGTH] = {0};
  uint8_t length = 0;
  if (!nfc->readDetectedPassiveTargetID(uid, &length)) return false;
  if (length == 0 || length > CARD_ID_MAX_LENGTH) return false;
  memcpy(card.bytes, uid, length);
  card.length = length;
  return true;
}
