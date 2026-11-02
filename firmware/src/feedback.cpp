#include "feedback.h"

#include <Arduino.h>

#include "pins.h"

namespace {
hbr::FeedbackPlayer player;
hbr::Output lastOutput;
bool firstWrite = true;

void writePins(const hbr::Output &out) {
  // Only touch the pins when something changes.
  if (!firstWrite && out.red == lastOutput.red && out.green == lastOutput.green &&
      out.buzzer == lastOutput.buzzer) {
    return;
  }
  digitalWrite(LED_RED_PIN, out.red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, out.green ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, out.buzzer ? HIGH : LOW);  // HIGH turns the NPN transistor on
  lastOutput = out;
  firstWrite = false;
}
}  // namespace

void feedbackSetup() {
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  writePins(hbr::Output());  // everything off
}

void feedbackPlay(hbr::Pattern pattern, uint32_t holdMs) { player.play(pattern, millis(), holdMs); }

void feedbackStop() { player.stop(); }

void feedbackSetReady(bool ready) { player.setReady(ready); }

void feedbackUpdate() { writePins(player.update(millis())); }
