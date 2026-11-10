#include "lock.h"

#include <Arduino.h>

#include "device_config.h"
#include "lock_controller.h"
#include "pins.h"

#if HBR_ENABLE_SERVO
#include <Servo.h>
#endif

namespace {
hbr::LockController controller(HBR_UNLOCK_DURATION_MS);

#if HBR_ENABLE_SERVO
Servo servo;
// MG90S pulse range. 50 Hz signal; 500 us = one end, 2400 us = other end.
// If the servo buzzes/strains at 0 or 180 degrees, narrow this range.
constexpr int kServoMinUs = 500;
constexpr int kServoMaxUs = 2400;
#endif

void moveTo(bool unlocked) {
#if HBR_ENABLE_SERVO
  int angle = unlocked ? HBR_SERVO_UNLOCKED_DEG : HBR_SERVO_LOCKED_DEG;
  servo.write(angle);
  Serial.print(F("[lock] servo -> "));
  Serial.print(unlocked ? F("UNLOCKED (") : F("LOCKED ("));
  Serial.print(angle);
  Serial.println(F(" deg)"));
#else
  Serial.println(unlocked ? F("[lock] SIMULATED unlock") : F("[lock] SIMULATED lock"));
#endif
}
}  // namespace

void lockSetup() {
#if HBR_ENABLE_SERVO
  // Warning: the servo may jump to the LOCKED angle right here at power-on.
  // Keep fingers and the linkage clear during bench tests.
  // (The Uno's Servo library always runs at 50 Hz.)
  servo.attach(SERVO_SIGNAL_PIN, kServoMinUs, kServoMaxUs);
  Serial.println(F("[lock] REAL servo enabled"));
#else
  Serial.println(F("[lock] SIMULATED lock ready (no servo output). Set HBR_ENABLE_SERVO 1 to drive it."));
#endif
  controller.lock();
  moveTo(false);
}

void lockRequestUnlock() {
  bool wasUnlocked = controller.isUnlocked();
  controller.unlock(millis());  // starts/restarts the re-lock timer
  if (!wasUnlocked) moveTo(true);
}

void lockRequestLock() {
  controller.lock();
  moveTo(false);
}

void lockUpdate() {
  if (controller.update(millis())) moveTo(false);  // timer ran out
}

bool lockIsCommandedUnlocked() { return controller.isUnlocked(); }

bool lockRecentlyUnlocked(uint32_t graceMs) {
  return controller.recentlyUnlocked(millis(), graceMs);
}

bool lockServoEnabled() { return HBR_ENABLE_SERVO != 0; }
