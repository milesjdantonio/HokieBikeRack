/* HokieBikeRack firmware. Shared file: keep it short and talk before changing it.
 * Each part lives in its own .h/.cpp pair; main.cpp just connects them.
 * No hardware is used yet: the lock is simulated and the card reader and
 * accelerometer are placeholders. Confirm exact ESP32, PN532 breakout/card
 * technology, accelerometer module, servo supply, and mechanical linkage
 * before implementing hardware drivers.
 */
#include <Arduino.h>

#include "access_policy.h"
#include "backend_sync.h"
#include "card_reader.h"
#include "event_queue.h"
#include "lock.h"
#include "tamper_sensor.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("HokieBikeRack firmware starting; hardware is not initialized.");

  if (!eventQueueSetup()) {
    Serial.println("Event queue storage unavailable; event enqueue is disabled.");
  }
  lockSetup();
  cardReaderSetup();
  tamperSensorSetup();
  backendSyncSetup();
}

void loop() {
  // Card tapped -> decide locally (never depends on Wi-Fi) -> simulated unlock.
  CardId card;
  if (cardReaderReadCard(card)) {
    if (accessPolicyCheck(card) == AccessDecision::Allow) {
      lockRequestUnlock();
      // TODO: eventQueuePush(...) once event type names and timestamps are agreed with backend.
    } else {
      // TODO: eventQueuePush(...) for a denied card.
    }
  }

  // Shaking -> record a tamper event. Never moves the lock.
  AccelReading reading;
  if (tamperSensorRead(reading) && tamperSensorIsTamper(reading)) {
    // TODO: eventQueuePush(...) for a tamper event.
  }

  lockUpdate();
  backendSyncUpdate();

  // Short pause so the loop runs ~100 times a second: fast enough to catch a
  // card tap or a shake, while giving the ESP32's background Wi-Fi work time to run.
  // Avoid long delay() calls anywhere: they freeze everything else.
  delay(10);
}
