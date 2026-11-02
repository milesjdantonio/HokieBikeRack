#include "lock.h"

#include <Arduino.h>

#include "device_config.h"
#include "lock_controller.h"
#include "pins.h"

#if HBR_ENABLE_SERVO
#include <ESP32Servo.h>
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
  servo.write(unlocked ? HBR_SERVO_UNLOCKED_DEG : HBR_SERVO_LOCKED_DEG);
  Serial.printf("[lock] servo -> %s (%d deg)\n", unlocked ? "UNLOCKED" : "LOCKED",
                unlocked ? HBR_SERVO_UNLOCKED_DEG : HBR_SERVO_LOCKED_DEG);
#else
  Serial.printf("[lock] SIMULATED %s\n", unlocked ? "unlock" : "lock");
#endif
}
}  // namespace

void lockSetup() {
#if HBR_ENABLE_SERVO
  // Warning: the servo may jump to the LOCKED angle right here at power-on.
  // Keep fingers and the linkage clear during bench tests.
  servo.setPeriodHertz(50);
  servo.attach(SERVO_SIGNAL_PIN, kServoMinUs, kServoMaxUs);
  Serial.println("[lock] REAL servo enabled");
#else
  Serial.println("[lock] SIMULATED lock ready (no servo output). Set HBR_ENABLE_SERVO 1 to drive it.");
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
