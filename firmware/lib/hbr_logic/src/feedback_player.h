#pragma once
// Light + sound patterns (red LED, green LED, active buzzer). Owner: Person A
//
// No hardware here: update() just says which outputs should be ON right now,
// and src/feedback.cpp writes that to the pins. Tested in
// firmware/test/test_feedback_lock_util.
//
// Why not just use delay()? A pattern like "beep, wait, beep" with delay()
// would freeze the whole loop: no card reads, no tamper checks. Instead each
// pattern is a list of timed steps, and update() looks at the clock to see
// which step we're in. This is "non-blocking" code. See docs/notes/firmware.md.
//
// Active buzzer = on/off only (one fixed pitch). "Sirens" and "chirps" are
// made by switching it on and off with different timings.
//
// The steps live in a small fixed array (no std::vector): the Arduino Uno has
// no C++ standard library and only 2 KB of RAM.
#include <stdint.h>

namespace hbr {

// Higher in the list = more important. A new pattern only replaces the
// current one if it is at least as important (or the current one finished).
enum class Pattern : uint8_t {
  None = 0,
  Boot,           // red+green flash and a beep at power-on
  Granted,        // green on while unlocked + one short beep
  UnlockReminder, // still unlocked: green stays on, red flashes every 1 s, a beep every 2 s, until stop()
  Denied,         // red + two beeps
  TamperWarning,  // red blinks + 3 quick chirps
  TamperAlarm,    // flashing red + siren until stop() (the tamper detector decides when)
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

// The longest pattern (TamperWarning) has 7 steps.
constexpr uint8_t kMaxSteps = 8;

class FeedbackPlayer {
 public:
  // holdMs: for Granted, how long green stays on (= unlock time).
  // For TamperAlarm / UnlockReminder, how long to loop, or kUntilStopped.
  void play(Pattern pattern, uint32_t nowMs, uint32_t holdMs = 0);
  void stop();  // e.g. an allowed card silences the alarm

  // Idle "heartbeat" blip every 5 s when nothing else is playing:
  // green blip = ready, red blip = not ready (no cards enrolled / reader fault).
  void setReady(bool ready) { ready_ = ready; }

  // Call every loop(): which LEDs / buzzer should be on right now.
  Output update(uint32_t nowMs);
  // The pattern playing now (None when idle).
  Pattern current() const { return current_; }

  // Fills `out` with the pattern's steps and returns how many there are.
  static uint8_t stepsFor(Pattern pattern, uint32_t holdMs, Step out[kMaxSteps]);

 private:
  Pattern current_ = Pattern::None;
  Step steps_[kMaxSteps] = {};
  uint8_t stepCount_ = 0;
  uint32_t startMs_ = 0;
  uint32_t repeatForMs_ = 0;  // 0 = play steps once; otherwise loop for this long
  bool ready_ = false;
};

constexpr uint32_t kUntilStopped = 0xFFFFFFFFu;  // holdMs: loop the siren until stop()
constexpr uint32_t kIdleBlipEveryMs = 5000;
constexpr uint32_t kIdleBlipMs = 30;

}  // namespace hbr
