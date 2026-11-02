#include "tamper_detector.h"

#include <math.h>

namespace hbr {

TamperDetector::TamperDetector(const TamperConfig &config) : config_(config) {}

void TamperDetector::reset() {
  TamperConfig keep = config_;
  *this = TamperDetector(keep);
}

void TamperDetector::silence() {
  alarmOn_ = false;
  hasSignaled_ = false;
  overCount_ = 0;
}

bool TamperDetector::alarmActive(uint32_t nowMs) const {
  // "now - start < duration" is safe even when millis() wraps around to 0.
  return alarmOn_ && (nowMs - alarmStartMs_) < config_.alarmDurationMs;
}

TamperSignal TamperDetector::update(float x, float y, float z, uint32_t nowMs, bool armed) {
  if (!started_) {
    started_ = true;
    startMs_ = nowMs;
    baseX_ = x;
    baseY_ = y;
    baseZ_ = z;
    lastDeviation_ = 0;
    return TamperSignal::None;
  }

  float dx = x - baseX_, dy = y - baseY_, dz = z - baseZ_;
  lastDeviation_ = sqrtf(dx * dx + dy * dy + dz * dz);

  bool warmingUp = (nowMs - startMs_) < config_.warmupMs;
  bool over = lastDeviation_ >= config_.thresholdG;

  // Move the baseline a small step toward this reading (an "exponential
  // moving average"). Fast during warm-up, slow when calm, very slow while shaking.
  float follow = warmingUp ? 0.2f : (over ? config_.baselineFollowShaking : config_.baselineFollow);
  baseX_ += (x - baseX_) * follow;
  baseY_ += (y - baseY_) * follow;
  baseZ_ += (z - baseZ_) * follow;

  if (alarmOn_ && !alarmActive(nowMs)) alarmOn_ = false;  // siren finished

  if (warmingUp || !armed) {
    overCount_ = 0;
    return TamperSignal::None;
  }
  if (!over) {
    overCount_ = 0;
    return TamperSignal::None;
  }
  if (overCount_ < 255) overCount_++;
  // Fire exactly once per jolt: on the sample where the count reaches the target.
  if (overCount_ != config_.samplesToTrigger) return TamperSignal::None;
  return trigger(nowMs);
}

TamperSignal TamperDetector::trigger(uint32_t nowMs) {
  if (alarmActive(nowMs)) return TamperSignal::None;  // already screaming
  uint32_t sinceLast = nowMs - lastSignalMs_;
  if (hasSignaled_ && sinceLast < config_.cooldownMs) return TamperSignal::None;

  bool escalate = hasSignaled_ && sinceLast <= config_.escalationWindowMs;
  hasSignaled_ = true;
  lastSignalMs_ = nowMs;
  if (escalate) {
    alarmOn_ = true;
    alarmStartMs_ = nowMs;
    return TamperSignal::Alarm;
  }
  return TamperSignal::Warning;
}

}  // namespace hbr
