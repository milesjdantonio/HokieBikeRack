#pragma once
// Tamper detection logic. Owner: Person B
// Turns a stream of accelerometer readings into WARNING / ALARM signals.
// No hardware here (see src/tamper_sensor.cpp for the MPU-6050 driver), so it
// can be tested on a PC: firmware/test/test_tamper_detector.
//
// How it works (details in docs/notes/firmware.md, "Tamper detection"):
//  1. Learn a "baseline": the normal reading when the rack is still. Gravity
//     makes this about 1 g pointing down, in whatever direction the sensor is
//     mounted. The baseline follows slowly so a slight lean doesn't count.
//  2. Every sample, measure how far the reading is from the baseline
//     ("deviation", in g).
//  3. A "jolt" = deviation above the threshold for a few samples in a row.
//     One-sample spikes (electrical noise) are ignored.
//  4. First jolt -> WARNING. Another jolt soon after -> ALARM (10 s siren).
//     Calm for a while -> back to the WARNING level.
//
// Tamper signals must NEVER move the lock. They only make noise and log events.
#include <stdint.h>

namespace hbr {

struct TamperConfig {
  float thresholdG = 0.35f;          // deviation that counts as a jolt (tune on real rack!)
  uint8_t samplesToTrigger = 3;      // jolt must last this many samples in a row (3 x 20 ms)
  float baselineFollow = 0.02f;      // how fast the baseline follows when calm (0..1)
  float baselineFollowShaking = 0.002f;  // much slower while shaking, so a shake can't
                                         // "teach" itself as normal; still lets a
                                         // permanent tilt be learned eventually
  uint32_t warmupMs = 2000;          // learn the baseline for this long after start
  uint32_t cooldownMs = 3000;        // after a signal, ignore jolts for this long
                                     // (so one shake = one event, not 50)
  uint32_t escalationWindowMs = 30000;  // a jolt within this time of the last signal -> ALARM
  uint32_t alarmDurationMs = 10000;  // siren length
};

enum class TamperSignal { None, Warning, Alarm };

class TamperDetector {
 public:
  explicit TamperDetector(const TamperConfig &config = TamperConfig());

  // Feed one reading (in g). `armed` = false while a rider is legitimately
  // using the rack (just unlocked), so pulling a bike out isn't "tampering".
  // The baseline still updates while disarmed.
  // Returns a signal only on the sample where it starts.
  TamperSignal update(float x, float y, float z, uint32_t nowMs, bool armed = true);

  bool alarmActive(uint32_t nowMs) const;
  // An allowed card was tapped: stop the alarm and forget the escalation.
  void silence();
  void reset();

  float lastDeviationG() const { return lastDeviation_; }
  const TamperConfig &config() const { return config_; }

 private:
  TamperSignal trigger(uint32_t nowMs);

  TamperConfig config_;
  bool started_ = false;
  uint32_t startMs_ = 0;
  float baseX_ = 0, baseY_ = 0, baseZ_ = 0;
  uint8_t overCount_ = 0;
  float lastDeviation_ = 0;
  bool hasSignaled_ = false;  // have we sent any signal yet (for the windows below)
  uint32_t lastSignalMs_ = 0;
  bool alarmOn_ = false;
  uint32_t alarmStartMs_ = 0;
};

}  // namespace hbr
