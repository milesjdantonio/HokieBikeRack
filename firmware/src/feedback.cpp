#include "feedback.h"

#include <Arduino.h>

#include "device_config.h"
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
  if (out.buzzer != lastOutput.buzzer || firstWrite) {
#if HBR_BUZZER_PASSIVE
    // A passive buzzer only sounds while it gets a square wave.
    if (out.buzzer) {
      tone(BUZZER_PIN, HBR_BUZZER_TONE_HZ);
    } else {
      noTone(BUZZER_PIN);
      digitalWrite(BUZZER_PIN, LOW);
    }
#else
    digitalWrite(BUZZER_PIN, out.buzzer ? HIGH : LOW);  // HIGH turns the NPN transistor on
#endif
  }
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
void feedbackStopSiren() {
  if (player.current() == hbr::Pattern::TamperAlarm) player.stop();
}

void feedbackSetReady(bool ready) { player.setReady(ready); }

void feedbackUpdate() { writePins(player.update(millis())); }
