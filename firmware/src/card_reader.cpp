#include "card_reader.h"

#include <Arduino.h>

#include "device_config.h"
#include "pins.h"

#if !HBR_READER_UART
// ============================================================================
// PN532 over I2C (HBR_READER_UART 0, the default; also what the Rack Model runs)
// ============================================================================
#include <Adafruit_PN532.h>
#include <Wire.h>

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
    nfc = new Adafruit_PN532(PN532_IRQ_PIN, PN532_RESET_PIN, &Wire);
  }
  if (!nfc->begin()) return false;
  uint32_t version = nfc->getFirmwareVersion();
  if (!version) return false;  // nothing answered at address 0x24
  Serial.print(F("[nfc] PN5"));
  Serial.print((version >> 24) & 0xFF, HEX);
  Serial.print(F(" firmware "));
  Serial.print((version >> 16) & 0xFF);
  Serial.print('.');
  Serial.println((version >> 8) & 0xFF);
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
    Serial.println(F("[nfc] reader stopped answering; will retry"));
  }
}
}  // namespace

bool cardReaderSetup() {
  healthy = initReader();
  if (!healthy) Serial.println(F("[nfc] PN532 not found. Check wiring and the I2C DIP switches."));
  return healthy;
}

bool cardReaderHealthy() { return healthy; }

bool cardReaderPoll(CardId &card) {
  uint32_t now = millis();
  if (!healthy) {
    if (now - lastInitAttemptMs >= kRetryInitEveryMs) {
      healthy = initReader();
      if (healthy) Serial.println(F("[nfc] reader is back"));
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

#else
// ============================================================================
// PN532 over UART ("HSU", HBR_READER_UART 1). Reader switches: both OFF.
// Reader TXD (front label SDA) -> Uno D2, reader RXD (front label SCL) -> Uno D3.
//
// Why: on our bench (2026-11-17) the PN532 grabbed the I2C clock line the moment
// it switched its antenna on and never let go, which also took the MPU-6050 off
// the bus. Over UART the same board reads cards fine, and a stuck reader can no
// longer block the I2C bus.
//
// The Uno's only hardware serial port is the USB console, so this uses
// SoftwareSerial on D2/D3. SoftwareSerial drops bits at the PN532's power-up speed
// (115200), so at start-up we tell the reader to switch to 38400, which it
// receives reliably. If only the Uno restarted (watchdog, serial monitor), the
// reader is still at 38400, so we try that first.
//
// Frames (PN532 user manual, section 6.2):
//   normal: 00 00 FF LEN LCS D4 <cmd> <data...> DCS 00   (LEN counts D4..data)
//   ACK:    00 00 FF 00 FF 00
// The reader answers a command with an ACK, then a frame starting D5 <cmd+1>.
// ============================================================================
#include <SoftwareSerial.h>

namespace {
constexpr uint32_t kPowerUpBaud = 115200;  // PN532 HSU default after power-up
constexpr uint32_t kWorkingBaud = 38400;   // what we switch it to
constexpr uint8_t kBaudCode38400 = 0x02;   // SetSerialBaudRate code for 38400
constexpr uint32_t kRestAfterReadMs = 150;
constexpr uint32_t kRetryInitEveryMs = 15000;
constexpr uint32_t kCheckAliveEveryMs = 10000;  // no card for this long: is the reader still there?
constexpr uint8_t kCmdSamConfig = 0x14;
constexpr uint8_t kCmdGetFirmwareVersion = 0x02;
constexpr uint8_t kCmdSetSerialBaudRate = 0x10;
constexpr uint8_t kCmdRfConfiguration = 0x32;
constexpr uint8_t kCmdInListPassiveTarget = 0x4A;

SoftwareSerial link(PN532_UART_RX_PIN, PN532_UART_TX_PIN);

bool healthy = false;
bool searchPending = false;  // we asked the reader to wait for a card
uint32_t searchStartedMs = 0;
uint32_t resumeAtMs = 0;
uint32_t lastInitAttemptMs = 0;

// ---- frame parser (byte at a time, so it works both blocking and in loop()) ----
enum class Got : uint8_t { Nothing, Ack, Data };
uint8_t frame[32];  // payload of the last data frame, starting at D5
uint8_t frameLen = 0;
uint8_t parseStep = 0, expectLen = 0, gotLen = 0, sum = 0, lastByte = 0xAA;

Got feed(uint8_t b) {
  Got result = Got::Nothing;
  switch (parseStep) {
    case 0:  // looking for the 00 FF start code
      if (lastByte == 0x00 && b == 0xFF) parseStep = 1;
      break;
    case 1:  // LEN
      expectLen = b;
      parseStep = 2;
      break;
    case 2:  // LCS: LEN + LCS must be 0 (mod 256)
      if (expectLen == 0) {
        // 00 FF 00 FF = ACK. Anything else with LEN 0 is a mangled start: resync.
        if (b == 0xFF) result = Got::Ack;
        parseStep = 0;
      } else if (static_cast<uint8_t>(expectLen + b) == 0 && expectLen <= sizeof(frame)) {
        gotLen = 0;
        sum = 0;
        parseStep = 3;
      } else {
        parseStep = 0;  // garbage; start over
      }
      break;
    case 3:  // payload
      frame[gotLen++] = b;
      sum += b;
      if (gotLen == expectLen) parseStep = 4;
      break;
    case 4:  // DCS: payload + DCS must be 0
      if (static_cast<uint8_t>(sum + b) == 0) {
        frameLen = gotLen;
        result = Got::Data;
      }
      parseStep = 0;
      break;
  }
  lastByte = b;
  return result;
}

void resetParser() {
  parseStep = 0;
  lastByte = 0xAA;
}

void drainInput() {
  while (link.available()) link.read();
  resetParser();
}

void sendFrame(const uint8_t *payload, uint8_t len) {  // payload starts with D4
  uint8_t dcs = 0;
  for (uint8_t i = 0; i < len; i++) dcs += payload[i];
  const uint8_t head[] = {0x00, 0x00, 0xFF, len, static_cast<uint8_t>(~len + 1)};
  link.write(head, sizeof(head));
  link.write(payload, len);
  link.write(static_cast<uint8_t>(~dcs + 1));
  link.write(static_cast<uint8_t>(0x00));
}

void sendAck() {  // from the host: "got it" (and: abort whatever you were doing)
  const uint8_t ack[] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};
  link.write(ack, sizeof(ack));
}

// Wait up to timeoutMs for `want`. Data frames must be the reply to `cmd`.
bool waitFor(Got want, uint8_t cmd, uint32_t timeoutMs) {
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    while (link.available()) {
      Got g = feed(static_cast<uint8_t>(link.read()));
      if (g != want) continue;
      if (want == Got::Ack) return true;
      if (frameLen >= 2 && frame[0] == 0xD5 && frame[1] == cmd + 1) return true;
    }
  }
  return false;
}

// Send a command and wait for its reply. The reply ends up in frame[].
// We don't insist on seeing the ACK first: the reader starts it a moment before
// SoftwareSerial is listening again, so its first bytes often arrive garbled.
bool command(const uint8_t *payload, uint8_t len, uint32_t replyTimeoutMs = 100) {
  drainInput();
  sendFrame(payload, len);
  return waitFor(Got::Data, payload[1], replyTimeoutMs);
}

bool getFirmwareVersion() {
  const uint8_t cmd[] = {0xD4, kCmdGetFirmwareVersion};
  if (!command(cmd, sizeof(cmd))) return false;
  if (frameLen < 6) return false;
  Serial.print(F("[nfc] PN5"));
  Serial.print(frame[2], HEX);
  Serial.print(F(" firmware "));
  Serial.print(frame[3]);
  Serial.print('.');
  Serial.print(frame[4]);
  Serial.println(F(" (UART)"));
  return true;
}

bool samConfig() {  // normal mode, no timeout, use IRQ
  const uint8_t cmd[] = {0xD4, kCmdSamConfig, 0x01, 0x14, 0x01};
  return command(cmd, sizeof(cmd));
}

bool waitForeverForCards() {  // MxRtyPassiveActivation = 0xFF: a search waits until a card comes
  const uint8_t cmd[] = {0xD4, kCmdRfConfiguration, 0x05, 0xFF, 0x01, 0xFF};
  return command(cmd, sizeof(cmd));
}

void wakeUp() {  // HSU wake-up: a run of 0x55 then zeros
  const uint8_t wake[] = {0x55, 0x55, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  link.write(wake, sizeof(wake));
  delay(2);
}

// Reader at power-up speed -> tell it to switch to kWorkingBaud.
bool switchToWorkingBaud() {
  link.begin(kPowerUpBaud);
  wakeUp();
  samConfig();  // replies at 115200 may arrive garbled; the baud switch is what matters
  drainInput();
  const uint8_t cmd[] = {0xD4, kCmdSetSerialBaudRate, kBaudCode38400};
  sendFrame(cmd, sizeof(cmd));
  delay(10);    // ACK + reply (we can't trust our reading of them at this speed)
  sendAck();    // the reader changes speed after it gets our ACK
  delay(5);
  link.end();
  link.begin(kWorkingBaud);
  delay(10);
  drainInput();
  return true;
}

bool initReader() {
  lastInitAttemptMs = millis();
  searchPending = false;
  // 1) Uno restarted but the reader didn't: it is still at kWorkingBaud,
  //    possibly in the middle of a card search. ACK aborts that search.
  link.begin(kWorkingBaud);
  sendAck();
  delay(5);
  drainInput();
  bool ok = getFirmwareVersion();
  // 2) Fresh power-up: the reader is at 115200. Switch it, then check again.
  for (uint8_t attempt = 0; !ok && attempt < 3; attempt++) {
    switchToWorkingBaud();
    ok = getFirmwareVersion();
  }
  if (!ok) return false;
  return samConfig() && waitForeverForCards();
}

bool startSearch() {  // "tell me when one ISO14443A card (MIFARE/NTAG) shows up"
  const uint8_t cmd[] = {0xD4, kCmdInListPassiveTarget, 0x01, 0x00};
  drainInput();
  sendFrame(cmd, sizeof(cmd));
  searchPending = true;
  searchStartedMs = millis();
  return true;
}

void markUnhealthy() {
  if (healthy) Serial.println(F("[nfc] reader stopped answering; will retry"));
  healthy = false;
  searchPending = false;
}
}  // namespace

bool cardReaderSetup() {
  healthy = initReader();
  if (!healthy) {
    Serial.println(F("[nfc] PN532 (UART) not answering. Check: switches both OFF, reader TXD -> D2,"));
    Serial.println(F("      RXD -> D3 (swap them if unsure), VCC, GND."));
  }
  return healthy;
}

bool cardReaderHealthy() { return healthy; }

bool cardReaderPoll(CardId &card) {
  uint32_t now = millis();
  if (!healthy) {
    if (now - lastInitAttemptMs >= kRetryInitEveryMs) {
      healthy = initReader();
      if (healthy) Serial.println(F("[nfc] reader is back"));
    }
    return false;
  }

  if (!searchPending) {
    if (static_cast<int32_t>(now - resumeAtMs) < 0) return false;
    startSearch();
    return false;
  }

  // Read whatever has arrived; never wait here.
  while (link.available()) {
    Got g = feed(static_cast<uint8_t>(link.read()));
    if (g == Got::Data && frameLen >= 3 && frame[0] == 0xD5 &&
               frame[1] == kCmdInListPassiveTarget + 1) {
      searchPending = false;
      resumeAtMs = now + kRestAfterReadMs;
      // D5 4B NbTg Tg SENS_RES(2) SEL_RES NFCIDLength NFCID...
      uint8_t targets = frame[2];
      if (targets < 1 || frameLen < 8) return false;
      uint8_t length = frame[7];
      if (length == 0 || length > CARD_ID_MAX_LENGTH || frameLen < 8 + length) return false;
      memcpy(card.bytes, frame + 8, length);
      card.length = length;
      return true;
    }
  }

  // (A missing ACK alone doesn't mean much over SoftwareSerial; see command().
  // The check below catches a reader that really stopped answering.)
  if (now - searchStartedMs > kCheckAliveEveryMs) {
    // No card for a while. Stop the search and make sure the reader still answers.
    sendAck();
    delay(5);
    drainInput();
    const uint8_t cmd[] = {0xD4, kCmdGetFirmwareVersion};
    if (!command(cmd, sizeof(cmd))) {
      markUnhealthy();
      return false;
    }
    searchPending = false;  // start a fresh search next loop
  }
  return false;
}
#endif
