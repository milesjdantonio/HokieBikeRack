#pragma once
// The lock (MG90S servo). Owner: Person A
// SIMULATED for now: these only print messages. Real servo output stays
// disabled until power and mechanical safety are reviewed
// (see docs/HARDWARE_DECISIONS.md).

// Call once from setup().
void lockSetup();

void lockRequestUnlock();
void lockRequestLock();

// What the lock was last told to do. This is NOT proof the lock actually
// moved: the servo has no position feedback.
bool lockIsCommandedUnlocked();
