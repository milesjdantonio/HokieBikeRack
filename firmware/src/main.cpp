/* HokieBikeRack firmware for the Arduino Uno R3. Shared file: keep it short and talk before changing it.
 * Each part lives in its own .h/.cpp pair; main.cpp just connects them.
 * Walkthrough of a card tap from start to finish: docs/notes/overview.md
 *
 * Everything runs in loop(): cards, tamper sensor, lock timer, lights/buzzer.
 * The Uno has no Wi-Fi, so this version works on its own:
 *   - allowed cards are saved in EEPROM, added with the `enroll` serial command
 *   - events (granted, denied, tamper...) are printed to the serial monitor
 *     instead of being uploaded to the backend
 * The last ESP32 version, with Wi-Fi and backend sync, is the git tag `esp32-final`.
 *
 * RAM is tiny (2 KB), so:
 *   - every fixed message is wrapped in F("..."), which keeps it in flash
 *   - no String objects (they chop up the little RAM there is)
 */
#include <Arduino.h>
#include <Wire.h>
#include <avr/wdt.h>
#include <string.h>

#include "card_reader.h"
#include "card_store.h"
#include "credential_ref.h"
#include "device_config.h"
#include "feedback.h"
#include "hbr_util.h"
#include "lock.h"
#include "pins.h"
#include "tamper_detector.h"
#include "tamper_sensor.h"

// Runs before setup(), right after any reset. After a watchdog reset the
// watchdog is still switched on, so turn it off before it fires again during
// start-up. (Standard avr-libc pattern; ".init3" = very early start-up code.
// Only AVR chips have that start-up section, so the browser model skips it.)
#if defined(__AVR__)
void disableWatchdogAtBoot() __attribute__((naked, used, section(".init3")));
void disableWatchdogAtBoot() {
  MCUSR = 0;
  wdt_disable();
}
#endif

namespace {
hbr::TamperDetector tamper([] {
  hbr::TamperConfig c;
  c.alarmMinMs = HBR_TAMPER_ALARM_MS;
  c.alarmQuietMs = HBR_TAMPER_ALARM_QUIET_MS;
  return c;
}());
hbr::CardDebouncer debouncer(2000);
uint32_t lastTamperSampleMs = 0;
bool readerWasOk = true;
bool accelWasOk = true;
bool alarmWasOn = false;
bool simShakeActive = false;  // serial `shake` command
uint32_t simShakeUntilMs = 0;

// `enroll` / `unenroll`: the next card tapped is added / removed instead of checked.
enum class CardMode : uint8_t { Check, Enroll, Unenroll };
CardMode cardMode = CardMode::Check;
uint32_t cardModeUntilMs = 0;

// Bytes of free RAM between the heap and the stack. Shown by `status`.
extern "C" char *__brkval;
extern "C" char __heap_start;
int freeRam() {
  char top;
  return &top - (__brkval ? __brkval : &__heap_start);
}

// Only the first 6 bytes (12 hex characters) are printed: enough to recognise
// a card, without dumping the whole reference into the log.
void printShortRef(const uint8_t ref[hbr::kCardRefLength]) {
  char hex[13];
  hbr::toHex(ref, 6, hex);
  Serial.print(hex);
  Serial.print(F("..."));
}

// "[event] t+12s ACCESS_GRANTED (INFO)". The caller adds details + newline.
// These are the same event types the backend uses, so the log reads the same.
void printEvent(const __FlashStringHelper *type, const __FlashStringHelper *severity) {
  Serial.print(F("[event] t+"));
  Serial.print(millis() / 1000);
  Serial.print(F("s "));
  Serial.print(type);
  Serial.print(F(" ("));
  Serial.print(severity);
  Serial.print(F(")"));
}

void enrollCard(const uint8_t ref[hbr::kCardRefLength]) {
  cardMode = CardMode::Check;
  Serial.print(F("[cards] "));
  printShortRef(ref);
  switch (cardStore().add(ref)) {
    case hbr::AddResult::Added:
      Serial.print(F(" ENROLLED, "));
      Serial.print(cardStore().count());
      Serial.println(F(" cards saved"));
      feedbackPlay(hbr::Pattern::Granted, 1000);
      break;
    case hbr::AddResult::AlreadyListed:
      Serial.println(F(" was already enrolled"));
      feedbackPlay(hbr::Pattern::Granted, 300);
      break;
    case hbr::AddResult::Full:
      Serial.println(F(" NOT added: the list is full. Remove a card first (`list`, `remove <n>`)"));
      feedbackPlay(hbr::Pattern::Denied);
      break;
  }
}

void unenrollCard(const uint8_t ref[hbr::kCardRefLength]) {
  cardMode = CardMode::Check;
  int index = cardStore().find(ref);
  Serial.print(F("[cards] "));
  printShortRef(ref);
  if (index < 0) {
    Serial.println(F(" wasn't enrolled; nothing removed"));
    feedbackPlay(hbr::Pattern::Denied);
    return;
  }
  cardStore().removeAt(static_cast<uint8_t>(index));
  Serial.print(F(" REMOVED, "));
  Serial.print(cardStore().count());
  Serial.println(F(" cards left"));
  feedbackPlay(hbr::Pattern::Denied);  // red = this card no longer opens the rack
}

void handleCard(const CardId &card) {
  if (!debouncer.shouldProcess(card.bytes, card.length, millis())) return;  // still on the reader
  Serial.print(F("[card] read a "));
  Serial.print(card.length);
  Serial.println(F("-byte card ID"));  // length only, never the ID

  uint8_t ref[hbr::kCardRefLength];
  if (!credentialRefFromCard(card, ref)) {
    Serial.println(F("[card] HBR_CARD_KEY isn't set in config.h -> denied"));
    feedbackPlay(hbr::Pattern::Denied);
    printEvent(F("ACCESS_DENIED"), F("LOW"));
    Serial.println(F(" reason=NO_CARD_KEY"));
    return;
  }
  if (cardMode == CardMode::Enroll) return enrollCard(ref);
  if (cardMode == CardMode::Unenroll) return unenrollCard(ref);

  if (cardStore().contains(ref)) {
    lockRequestUnlock();
    // An allowed card also silences a tamper alarm (the owner is back).
    tamper.silence();
    alarmWasOn = false;
    feedbackStop();
    feedbackPlay(hbr::Pattern::Granted, HBR_UNLOCK_DURATION_MS);
    printEvent(F("ACCESS_GRANTED"), F("INFO"));
    Serial.print(F(" card="));
    printShortRef(ref);
    Serial.println();
  } else {
    feedbackPlay(hbr::Pattern::Denied);
    printEvent(F("ACCESS_DENIED"), F("LOW"));
    Serial.print(F(" card="));
    printShortRef(ref);
    Serial.println(cardStore().count() ? F(" reason=NOT_LISTED")
                                       : F(" reason=NOT_LISTED (no cards enrolled yet: use `enroll`)"));
  }
}

void handleTamperSignal(hbr::TamperSignal signal) {
  if (signal == hbr::TamperSignal::None) return;
  if (signal == hbr::TamperSignal::Warning) {
    feedbackPlay(hbr::Pattern::TamperWarning);
    printEvent(F("TAMPER_WARNING"), F("MEDIUM"));
  } else {
    // The siren runs until loop() sees the tamper detector say the post is still again.
    feedbackPlay(hbr::Pattern::TamperAlarm, hbr::kUntilStopped);
    printEvent(F("TAMPER_ALARM"), F("HIGH"));
    Serial.print(F(" siren for at least "));
    Serial.print(HBR_TAMPER_ALARM_MS / 1000);
    Serial.print(F(" s, until still for "));
    Serial.print(HBR_TAMPER_ALARM_QUIET_MS / 1000);
    Serial.print(F(" s,"));
  }
  Serial.print(F(" deviation="));
  Serial.print(tamper.lastDeviationG(), 2);
  Serial.print(F(" g, threshold="));
  Serial.print(tamper.config().thresholdG, 2);
  Serial.println(F(" g"));
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
}

void printSensorFault(const __FlashStringHelper *sensor, bool ok) {
  printEvent(F("SENSOR_FAULT"), ok ? F("INFO") : F("MEDIUM"));
  Serial.print(F(" sensor="));
  Serial.print(sensor);
  Serial.println(ok ? F(" state=RECOVERED") : F(" state=NOT_RESPONDING"));
}

void reportSensorChanges() {
  bool readerOk = cardReaderHealthy();
  bool accelOk = tamperSensorHealthy();
  if (readerOk != readerWasOk) {
    printSensorFault(F("PN532"), readerOk);
    readerWasOk = readerOk;
  }
  if (accelOk != accelWasOk) {
    printSensorFault(F("MPU6050"), accelOk);
    accelWasOk = accelOk;
  }
}

bool rackReady() {
  return cardStore().count() > 0 && credentialKeyConfigured() && cardReaderHealthy();
}

void printStatus() {
  Serial.println(F("---- HokieBikeRack status ----"));
  Serial.print(F("firmware " HBR_FIRMWARE_VERSION " (Arduino Uno R3), uptime "));
  Serial.print(millis() / 1000);
  Serial.print(F(" s, free RAM "));
  Serial.print(freeRam());
  Serial.println(F(" bytes"));
  Serial.print(F("config.h "));
  Serial.print(HBR_HAS_LOCAL_CONFIG ? F("found") : F("MISSING"));
  Serial.print(F(", card key "));
  Serial.println(credentialKeyConfigured() ? F("set") : F("MISSING"));
  Serial.print(F("cards enrolled: "));
  Serial.print(cardStore().count());
  Serial.print(F(" of "));
  Serial.println(cardStore().capacity());
  Serial.print(F("ready for cards: "));
  Serial.println(rackReady() ? F("YES") : F("NO"));
  Serial.print(F("reader "));
  Serial.print(cardReaderHealthy() ? F("OK") : F("FAULT"));
  Serial.print(F(", accelerometer "));
  Serial.print(tamperSensorHealthy() ? F("OK") : F("FAULT"));
  Serial.print(F(" (last "));
  Serial.print(tamper.lastDeviationG(), 2);
  Serial.print(F(" g), servo "));
  Serial.print(lockServoEnabled() ? F("REAL") : F("simulated"));
  Serial.print(F(", lock "));
  Serial.println(lockIsCommandedUnlocked() ? F("UNLOCKED") : F("locked"));
  if (tamper.alarmActive(millis())) Serial.println(F("TAMPER ALARM is sounding"));
}

void listCards() {
  uint8_t n = cardStore().count();
  Serial.print(n);
  Serial.println(F(" card(s) enrolled:"));
  uint8_t ref[hbr::kCardRefLength];
  for (uint8_t i = 0; i < n; i++) {
    cardStore().get(i, ref);
    Serial.print(F("  "));
    Serial.print(i);
    Serial.print(F(": "));
    printShortRef(ref);
    Serial.println();
  }
}

void scanI2c() {
  // Who answers on the I2C bus? Expect 0x24 (PN532) and 0x68 (MPU-6050).
  Serial.println(F("Scanning I2C bus..."));
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("  found 0x"));
      if (addr < 0x10) Serial.print('0');
      Serial.print(addr, HEX);
      if (addr == 0x24) Serial.print(F(" (PN532)"));
      if (addr == 0x68) Serial.print(F(" (MPU-6050)"));
      if (addr == 0x69) Serial.print(F(" (MPU-6050, AD0 high)"));
      Serial.println();
      found++;
    }
  }
  Serial.print(found);
  Serial.println(F(" device(s). None? Check SDA=A4, SCL=A5, power, GND, and the PN532 I2C switches."));
}

void printAccel() {
  // 2 seconds of raw readings, for calibrating the tamper threshold.
  // (This command pauses the rack for 2 s; it's only for testing.)
  for (int i = 0; i < 20; i++) {
    AccelReading r;
    if (tamperSensorRead(r)) {
      Serial.print(F("  x="));
      Serial.print(r.x, 3);
      Serial.print(F(" y="));
      Serial.print(r.y, 3);
      Serial.print(F(" z="));
      Serial.print(r.z, 3);
      Serial.print(F(" g   deviation from baseline "));
      Serial.print(tamper.lastDeviationG(), 3);
      Serial.print(F(" g (threshold "));
      Serial.print(tamper.config().thresholdG, 2);
      Serial.println(F(")"));
    } else {
      Serial.println(F("  no reading (sensor fault?)"));
    }
    delay(100);
    wdt_reset();
  }
}

void startCardMode(CardMode mode) {
  cardMode = mode;
  cardModeUntilMs = millis() + HBR_ENROLL_WINDOW_MS;
  Serial.print(mode == CardMode::Enroll ? F("ok: tap the card to ADD within ")
                                        : F("ok: tap the card to REMOVE within "));
  Serial.print(HBR_ENROLL_WINDOW_MS / 1000);
  Serial.println(F(" s"));
}

void addCardRef(const char *hex) {
  // Paste a credential reference (e.g. from the dashboard). Only its first
  // 32 hex characters are used; it must have been made with the same card key.
  uint8_t ref[hbr::kCardRefLength];
  if (!hbr::fromHex(hex, ref, hbr::kCardRefLength)) {
    Serial.println(F("usage: add <reference>  (at least 32 hex characters)"));
    return;
  }
  enrollCard(ref);
}

void removeCard(const char *number) {
  char *end = nullptr;
  long index = strtol(number, &end, 10);
  if (end == number || index < 0 || index >= cardStore().count()) {
    Serial.println(F("usage: remove <n>  (the number shown by `list`)"));
    return;
  }
  cardStore().removeAt(static_cast<uint8_t>(index));
  Serial.print(F("ok: removed card "));
  Serial.print(index);
  Serial.println(F(" (numbers of the other cards may have changed; see `list`)"));
}

#if HBR_ENABLE_SERIAL_SIM
void simulateTap(const char *hex) {
  // Pretend a card with this ID (hex) was tapped. Goes through the exact
  // same path as a real card, so it can only unlock for an enrolled card.
  CardId card{};
  while (card.length < CARD_ID_MAX_LENGTH && hbr::fromHex(hex + 2 * card.length,
                                                          &card.bytes[card.length], 1)) {
    card.length++;
  }
  if (card.length) handleCard(card);
  else Serial.println(F("usage: tap 04a1b2c3d4"));
}
#endif

void printHelp() {
  Serial.println(F("commands: status, enroll, unenroll, list, add <reference>, remove <n>,"));
  Serial.print(F("          wipe-cards, i2c-scan, accel, reboot"));
#if HBR_ENABLE_SERIAL_SIM
  Serial.print(F(", tap <hex-id>, shake"));
#endif
  Serial.println();
}

bool is(const char *line, const char *command) { return strcmp_P(line, command) == 0; }

// "add 1234" with prefix "add " -> pointer to "1234", otherwise nullptr.
const char *after(const char *line, const char *prefix) {
  size_t n = strlen_P(prefix);
  return strncmp_P(line, prefix, n) == 0 ? line + n : nullptr;
}

void runCommand(const char *line) {
  const char *arg;
  if (is(line, PSTR("status"))) {
    printStatus();
  } else if (is(line, PSTR("enroll"))) {
    startCardMode(CardMode::Enroll);
  } else if (is(line, PSTR("unenroll"))) {
    startCardMode(CardMode::Unenroll);
  } else if (is(line, PSTR("list"))) {
    listCards();
  } else if ((arg = after(line, PSTR("add ")))) {
    addCardRef(arg);
  } else if ((arg = after(line, PSTR("remove ")))) {
    removeCard(arg);
  } else if (is(line, PSTR("wipe-cards"))) {
    Serial.println(F("This deletes EVERY enrolled card. Type `wipe-cards yes` to confirm."));
  } else if (is(line, PSTR("wipe-cards yes"))) {
    cardStore().clear();
    Serial.println(F("ok: all cards removed"));
  } else if (is(line, PSTR("i2c-scan"))) {
    scanI2c();
  } else if (is(line, PSTR("accel"))) {
    printAccel();
  } else if (is(line, PSTR("reboot"))) {
    Serial.println(F("rebooting..."));
    Serial.flush();
    wdt_enable(WDTO_15MS);  // let the watchdog reset the chip
    for (;;) {
    }
#if HBR_ENABLE_SERIAL_SIM
  } else if ((arg = after(line, PSTR("tap ")))) {
    simulateTap(arg);
  } else if (is(line, PSTR("shake"))) {
    simShakeActive = true;
    simShakeUntilMs = millis() + 400;
    Serial.println(F("ok: simulating a 0.4 s shake"));
#endif
  } else if (line[0]) {
    printHelp();
  }
}

// Tiny serial console. Type a command in the PlatformIO serial monitor + Enter.
void handleSerial() {
  static char line[80];  // `add` + a 64-character reference fits
  static uint8_t length = 0;
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;
    if (c != '\n') {
      if (length < sizeof(line) - 1) line[length++] = c;
      continue;
    }
    while (length && line[length - 1] == ' ') length--;  // trailing spaces
    line[length] = '\0';
    const char *start = line;
    while (*start == ' ') start++;  // leading spaces
    runCommand(start);
    length = 0;
  }
}

void expireCardMode() {
  if (cardMode == CardMode::Check) return;
  if (static_cast<int32_t>(millis() - cardModeUntilMs) < 0) return;
  cardMode = CardMode::Check;
  Serial.println(F("[cards] no card tapped in time; back to normal"));
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println(F("HokieBikeRack firmware " HBR_FIRMWARE_VERSION " (Arduino Uno R3) starting"));
  if (!HBR_HAS_LOCAL_CONFIG) Serial.println(F("No include/config.h found: all cards denied."));

  // Lights/buzzer and lock first, so outputs are in a known safe state early.
  feedbackSetup();
  lockSetup();

  cardStoreSetup();

  // A4 = SDA, A5 = SCL on the Uno.
  Wire.begin();
  Wire.setClock(I2C_CLOCK_HZ);
  // Without this, a loose I2C wire can freeze the Uno forever inside Wire.
  // 25 ms timeout, and reset the I2C hardware when it happens.
  // Called unconditionally: the AVR core we build with (PlatformIO atmelavr
  // 5.x) has setWireTimeout() but never defines WIRE_HAS_TIMEOUT, so an
  // #if on that macro silently skipped this on the real Uno.
  Wire.setWireTimeout(25000, true);
  readerWasOk = cardReaderSetup();
  accelWasOk = tamperSensorSetup();

  printEvent(F("DEVICE_BOOT"), F("INFO"));
  Serial.print(F(" servo="));
  Serial.print(lockServoEnabled() ? F("REAL") : F("SIMULATED"));
  Serial.print(F(" reader="));
  Serial.print(readerWasOk ? F("OK") : F("NOT_FOUND"));
  Serial.print(F(" accel="));
  Serial.println(accelWasOk ? F("OK") : F("NOT_FOUND"));

  feedbackPlay(hbr::Pattern::Boot);
#if HBR_ENABLE_WATCHDOG
  // If loop() ever stops running for 4 s, the Uno restarts and the lock
  // starts up LOCKED again.
  wdt_enable(WDTO_4S);
#endif
  Serial.println(F("Ready. Type `status` in the serial monitor for details, `enroll` to add a card."));
}

void loop() {
  wdt_reset();  // "still alive" (harmless if the watchdog is off)
  handleSerial();
  expireCardMode();

  // Card tapped -> look it up in the EEPROM list -> unlock or deny.
  CardId card;
  if (cardReaderPoll(card)) handleCard(card);

  // Shaking -> warning, then alarm. Never moves the lock.
  sampleTamperSensor();

  // The siren stops once the post has been still long enough (or a card silenced it).
  bool alarmOn = tamper.alarmActive(millis());
  if (alarmWasOn && !alarmOn) {
    feedbackStopSiren();
    Serial.println(F("[tamper] siren off: the post has been still"));
  }
  alarmWasOn = alarmOn;

  lockUpdate();
  reportSensorChanges();

  feedbackSetReady(rackReady());
  feedbackUpdate();

  // Short pause so the loop runs a few hundred times a second: fast enough
  // for smooth patterns and quick card reads.
  // Avoid long delay() calls anywhere: they freeze everything else.
  delay(2);
}
