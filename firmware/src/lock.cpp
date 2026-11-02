#include "lock.h"
#include <Arduino.h>

// How long the lock stays open before re-locking by itself.
// 5 seconds gives someone time to pull the bike/lock free. Adjust after testing.
constexpr uint32_t UNLOCK_DURATION_MS = 5000;

static bool commandedUnlocked = false;
static uint32_t unlockedAtMs = 0;  // millis() when we last unlocked

void lockSetup() {
  commandedUnlocked = false;
  Serial.println("[lock] SIMULATED lock ready (no servo output).");
}

void lockRequestUnlock() {
  commandedUnlocked = true;
  unlockedAtMs = millis();  // start the timer; lockUpdate() re-locks later
  Serial.println("[lock] SIMULATED unlock");
}

void lockRequestLock() {
  commandedUnlocked = false;
  Serial.println("[lock] SIMULATED lock");
}

void lockUpdate() {
  // "now - start >= duration" still works when millis() wraps back to 0
  // (after about 49 days), because unsigned subtraction wraps too.
  if (commandedUnlocked && millis() - unlockedAtMs >= UNLOCK_DURATION_MS) {
    lockRequestLock();
  }
}

bool lockIsCommandedUnlocked() {
  return commandedUnlocked;
}
