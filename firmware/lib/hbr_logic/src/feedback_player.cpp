#include "feedback_player.h"

namespace hbr {

namespace {
// Tiny helper so the pattern tables below stay readable.
class StepWriter {
 public:
  explicit StepWriter(Step *out) : out_(out) {}
  StepWriter &add(uint32_t ms, bool red, bool green, bool buzzer) {
    if (count_ < kMaxSteps) out_[count_++] = {ms, red, green, buzzer};
    return *this;
  }
  uint8_t count() const { return count_; }

 private:
  Step *out_;
  uint8_t count_ = 0;
};
}  // namespace

// Each step: (how long, red, green, buzzer). Tweak timings here.
uint8_t FeedbackPlayer::stepsFor(Pattern pattern, uint32_t holdMs, Step out[kMaxSteps]) {
  StepWriter w(out);
  switch (pattern) {
    case Pattern::Boot:
      w.add(150, true, true, true).add(100, false, false, false).add(150, false, true, false);
      break;
    case Pattern::Granted: {
      // One short happy beep, then green stays on until the lock re-locks.
      uint32_t hold = holdMs > 120 ? holdMs - 120 : 0;
      w.add(120, false, true, true).add(hold, false, true, false);
      break;
    }
    case Pattern::Denied:
      w.add(150, true, false, true).add(100, true, false, false)
          .add(150, true, false, true).add(600, true, false, false);
      break;
    case Pattern::TamperWarning:
      // "Quick little sounds": 3 short chirps with red blinks, then red briefly.
      w.add(60, true, false, true).add(90, false, false, false)
          .add(60, true, false, true).add(90, false, false, false)
          .add(60, true, false, true).add(90, false, false, false)
          .add(500, true, false, false);
      break;
    case Pattern::TamperAlarm:
      // One siren "cycle"; play() loops it for the alarm time or until stop().
      // Long-short-short pulses sound more urgent than a steady tone.
      w.add(300, true, false, true).add(100, false, false, false)
          .add(100, true, false, true).add(100, false, false, false)
          .add(100, true, false, true).add(100, false, false, false);
      break;
    case Pattern::None:
      break;
  }
  return w.count();
}

void FeedbackPlayer::play(Pattern pattern, uint32_t nowMs, uint32_t holdMs) {
  update(nowMs);  // clears current_ if the old pattern already finished
  if (current_ != Pattern::None && pattern < current_) return;  // less important: ignore
  current_ = pattern;
  stepCount_ = stepsFor(pattern, holdMs, steps_);
  startMs_ = nowMs;
  repeatForMs_ = (pattern == Pattern::TamperAlarm) ? (holdMs ? holdMs : 10000) : 0;
}

void FeedbackPlayer::stop() {
  current_ = Pattern::None;
  stepCount_ = 0;
}

Output FeedbackPlayer::update(uint32_t nowMs) {
  Output out;
  if (current_ != Pattern::None) {
    uint32_t elapsed = nowMs - startMs_;
    uint32_t cycle = 0;
    for (uint8_t i = 0; i < stepCount_; i++) cycle += steps_[i].ms;
    uint32_t playFor = repeatForMs_ ? repeatForMs_ : cycle;
    if (cycle == 0 || (repeatForMs_ != kUntilStopped && elapsed >= playFor)) {
      stop();  // finished; fall through to the idle blip below
    } else {
      uint32_t t = elapsed % cycle;  // position inside the (possibly repeating) cycle
      for (uint8_t i = 0; i < stepCount_; i++) {
        const Step &s = steps_[i];
        if (t < s.ms) {
          out.red = s.red;
          out.green = s.green;
          out.buzzer = s.buzzer;
          return out;
        }
        t -= s.ms;
      }
      return out;
    }
  }
  // Idle blip: very short, so it's obvious it is not a "granted" signal.
  if ((nowMs % kIdleBlipEveryMs) < kIdleBlipMs) {
    if (ready_) out.green = true;
    else out.red = true;
  }
  return out;
}

}  // namespace hbr
