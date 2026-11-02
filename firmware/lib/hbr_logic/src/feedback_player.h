#pragma once
// Light + sound patterns (red LED, green LED, active buzzer). Owner: Person A
//
// No hardware here: update() just says which outputs should be ON right now,
// and src/feedback.cpp writes that to the pins. Tested in
// firmware/test/test_feedback_player.
//
// Why not just use delay()? A pattern like "beep, wait, beep" with delay()
// would freeze the whole loop: no card reads, no tamper checks. Instead each
// pattern is a list of timed steps, and update() looks at the clock to see
// which step we're in. This is "non-blocking" code. See docs/notes/firmware.md.
//
// Active buzzer = on/off only (one fixed pitch). "Sirens" and "chirps" are
// made by switching it on and off with different timings.
#include <stdint.h>

#include <vector>

namespace hbr {

// Higher in the list = more important. A new pattern only replaces the
// current one if it is at least as important (or the current one finished).
enum class Pattern : uint8_t {
  None = 0,
  Boot,           // red+green flash and a beep at power-on
  Granted,        // green on while unlocked + one short beep
  Denied,         // red + two beeps
  TamperWarning,  // red blinks + 3 quick chirps
  TamperAlarm,    // flashing red + siren for 10 s
};

struct Output {
  bool red = false;
  bool green = false;
  bool buzzer = false;
};

struct Step {
  uint32_t ms;
  bool red, green, buzzer;
};

class FeedbackPlayer {
 public:
  // holdMs: for Granted, how long green stays on (= unlock time).
  // For TamperAlarm, total siren length.
  void play(Pattern pattern, uint32_t nowMs, uint32_t holdMs = 0);
  void stop();  // e.g. an allowed card silences the alarm

  // Idle "heartbeat" blip every 5 s when nothing else is playing:
  // green blip = ready, red blip = not ready (no valid card list / reader fault).
  void setReady(bool ready) { ready_ = ready; }

  Output update(uint32_t nowMs);
  Pattern current() const { return current_; }

  static std::vector<Step> stepsFor(Pattern pattern, uint32_t holdMs);

 private:
  Pattern current_ = Pattern::None;
  std::vector<Step> steps_;
  uint32_t startMs_ = 0;
  uint32_t repeatForMs_ = 0;  // 0 = play steps once; otherwise loop for this long
  bool ready_ = false;
};

constexpr uint32_t kIdleBlipEveryMs = 5000;
constexpr uint32_t kIdleBlipMs = 30;

}  // namespace hbr
