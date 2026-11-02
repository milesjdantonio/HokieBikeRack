#include "lock.h"
#include <Arduino.h>

static bool commandedUnlocked = false;

void lockSetup() {
  commandedUnlocked = false;
  Serial.println("[lock] SIMULATED lock ready (no servo output).");
}

void lockRequestUnlock() {
  commandedUnlocked = true;
  Serial.println("[lock] SIMULATED unlock");
  // TODO: time limit, then re-lock automatically.
}

void lockRequestLock() {
  commandedUnlocked = false;
  Serial.println("[lock] SIMULATED lock");
}

bool lockIsCommandedUnlocked() {
  return commandedUnlocked;
}
