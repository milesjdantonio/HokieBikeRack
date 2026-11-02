#pragma once
// The lock (MG90S servo). Owner: Person A
// SIMULATED for now: these only print messages. Real servo output stays
// disabled until power and mechanical safety are reviewed
// (see docs/HARDWARE_DECISIONS.md).

// Call once from setup().
void lockSetup();

// Unlocks, then re-locks automatically after a few seconds (see lockUpdate).
void lockRequestUnlock();
void lockRequestLock();

// Call every loop(). Re-locks once the unlock time has run out.
void lockUpdate();

// What the lock was last told to do. This is NOT proof the lock actually
// moved: the servo has no position feedback.
bool lockIsCommandedUnlocked();
