#pragma once
// The lock (MG90S servo). Owner: Person A
// Momentary mode: lockRequestUnlock() opens it, and it re-locks by itself
// after HBR_UNLOCK_DURATION_MS (timing logic: lib/hbr_logic/src/lock_controller.h).
//
// HBR_ENABLE_SERVO 0 (default): SIMULATED, only prints messages.
// HBR_ENABLE_SERVO 1: really moves the servo (Servo library, pin 9). Only after the bench test in
// docs/notes/hardware-test-checklist.md.
#include <stdint.h>

// Call once from setup(). With the servo enabled, this moves it to LOCKED.
void lockSetup();

// Unlocks, then re-locks automatically (see lockUpdate). A second call while
// open restarts the timer.
void lockRequestUnlock();
void lockRequestLock();

// Call every loop(). Re-locks once the unlock time has run out.
// Returns true on the call where the timer ran out and it re-locked.
bool lockUpdate();

// What the lock was last told to do. This is NOT proof the lock actually
// moved: the servo has no position feedback.
bool lockIsCommandedUnlocked();

// True while unlocked or for `graceMs` after re-locking. Used to ignore
// tamper jolts while a rider pulls their bike out.
bool lockRecentlyUnlocked(uint32_t graceMs);

bool lockServoEnabled();

// Bench calibration: move the servo straight to `degrees` (0-180), bypassing
// the lock logic. False if out of range. The next lock/unlock moves it normally.
bool lockTestAngle(int degrees);
