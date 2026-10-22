/* Initial scaffold only; no hardware or lock actions are enabled.
 * Confirm exact ESP32, PN532 breakout/card technology, accelerometer module,
 * servo supply, and mechanical linkage before implementing hardware drivers.
 */
#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("HokieBikeRack firmware scaffold; hardware is not initialized.");
  Serial.println("Planned: PN532 read-only bring-up, accelerometer sampling, offline policy.");
  Serial.println("MG90S output remains disabled pending power/mechanical safety review.");
}

void loop() {
  // TODO: initialize PN532 only after the bus, pins, card technology, and library are confirmed.
  // TODO: sample/calibrate the 3-axis accelerometer and queue candidate tamper events.
  // TODO: check local authorization before any future bounded servo command.
  // TODO: never depend on network availability for the local authorization decision.
  // TODO: add durable event queue and authenticated, idempotent backend sync.
  delay(1000);
}
