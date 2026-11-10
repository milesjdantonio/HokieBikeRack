#pragma once
// HokieBikeRack local settings. Example only.
//
// SETUP: copy this file to include/config.h and fill it in.
// config.h is in .gitignore — NEVER commit it (it has the card key).
//
// The Arduino Uno version has no Wi-Fi, so there is no network section.
// Cards are added at the rack itself with the `enroll` serial command.

// Secret used to turn a card's ID into a "credential reference"
// (HMAC-SHA256). At least 16 characters. Must match on all racks, and must
// match the backend's key if you ever paste references from the dashboard
// with the `add` command. Make one with:
//   python -c "import secrets; print(secrets.token_hex(32))"
#define HBR_CARD_KEY ""

// ---- Hardware switches ----

// 0 = SIMULATED lock (serial messages only). 1 = really drive the MG90S.
// Only set 1 after the bench test in docs/notes/hardware-test-checklist.md.
#define HBR_ENABLE_SERVO 0
// Servo angles. Find the right values on the bench with the linkage DISCONNECTED.
#define HBR_SERVO_LOCKED_DEG 0
#define HBR_SERVO_UNLOCKED_DEG 90

// 1 = serial monitor test commands like `tap 04a1b2c3` and `shake`
// (handy without a card or while testing). Set 0 for a real deployment.
#define HBR_ENABLE_SERIAL_SIM 1

// 1 = restart the Uno automatically if the code ever freezes for 4 s
// (the lock then starts up LOCKED). Leave on. Only turn it off if your board
// is a clone with an old bootloader that gets stuck restarting over and over.
#define HBR_ENABLE_WATCHDOG 1
