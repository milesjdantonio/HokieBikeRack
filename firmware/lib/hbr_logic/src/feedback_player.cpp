#include "feedback_player.h"

namespace hbr {

namespace {
uint32_t totalMs(const std::vector<Step> &steps) {
  uint32_t total = 0;
  for (const Step &s : steps) total += s.ms;
  return total;
}
}  // namespace

// Each Step: {how long, red, green, buzzer}. Tweak timings here.
std::vector<Step> FeedbackPlayer::stepsFor(Pattern pattern, uint32_t holdMs) {
  switch (pattern) {
    case Pattern::Boot:
      return {{150, true, true, true}, {100, false, false, false}, {150, false, true, false}};
    case Pattern::Granted: {
      // One short happy beep, then green stays on until the lock re-locks.
      uint32_t hold = holdMs > 120 ? holdMs - 120 : 0;
      return {{120, false, true, true}, {hold, false, true, false}};
    }
    case Pattern::Denied:
      return {{150, true, false, true}, {100, true, false, false},
              {150, true, false, true}, {600, true, false, false}};
    case Pattern::TamperWarning:
      // "Quick little sounds": 3 short chirps with red blinks, then red briefly.
      return {{60, true, false, true}, {90, false, false, false},
              {60, true, false, true}, {90, false, false, false},
              {60, true, false, true}, {90, false, false, false},
              {500, true, false, false}};
    case Pattern::TamperAlarm:
      // One siren "cycle"; play() loops it for the full alarm time.
      // Long-short-short pulses sound more urgent than a steady tone.
      return {{300, true, false, true}, {100, false, false, false},
              {100, true, false, true}, {100, false, false, false},
              {100, true, false, true}, {100, false, false, false}};
    case Pattern::None:
      break;
  }
  return {};
}

void FeedbackPlayer::play(Pattern pattern, uint32_t nowMs, uint32_t holdMs) {
  update(nowMs);  // clears current_ if the old pattern already finished
  if (current_ != Pattern::None && pattern < current_) return;  // less important: ignore
  current_ = pattern;
  steps_ = stepsFor(pattern, holdMs);
  startMs_ = nowMs;
  repeatForMs_ = (pattern == Pattern::TamperAlarm) ? (holdMs ? holdMs : 10000) : 0;
}

void FeedbackPlayer::stop() {
  current_ = Pattern::None;
  steps_.clear();
}

Output FeedbackPlayer::update(uint32_t nowMs) {
  Output out;
  if (current_ != Pattern::None) {
    uint32_t elapsed = nowMs - startMs_;
    uint32_t cycle = totalMs(steps_);
    uint32_t playFor = repeatForMs_ ? repeatForMs_ : cycle;
    if (cycle == 0 || elapsed >= playFor) {
      stop();  // finished; fall through to the idle blip below
    } else {
      uint32_t t = elapsed % cycle;  // position inside the (possibly repeating) cycle
      for (const Step &s : steps_) {
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
