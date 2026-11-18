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
// Servo angles. Plate DOWN = locked: the servo holds it down against the
// spring. Unlocking lets the spring lift the plate UP (horn back on the ledge).
// Loss of power = spring lifts the plate = UNLOCKED (fail-open).
// Stay off the end stops (0 and 180). Tune with `servo <deg>`.
#define HBR_SERVO_LOCKED_DEG 60
#define HBR_SERVO_UNLOCKED_DEG 10
// 1 = servo mounted UPSIDE DOWN: it turns the other way, so every angle is
// sent as 180 - angle. Keep the angles above as they are; `servo <deg>` is
// flipped too, so calibration numbers mean the same plate position.
// 1 = the card button on A0 adds/removes cards: short press = add, hold 2 s =
// remove, then tap the card within 15 s. Anyone who can reach it can add a
// card, so keep it inside the post.
#define HBR_ENABLE_CARD_BUTTONS 0

#define HBR_SERVO_REVERSED 0

// 1 = serial monitor test commands like `tap 04a1b2c3` and `shake`
// (handy without a card or while testing). Set 0 for a real deployment.
#define HBR_ENABLE_SERIAL_SIM 1

// 1 = PN532 reader on UART (pins 2/3, reader switches both OFF) instead of I2C.
// Use it if your reader locks up the I2C bus when it looks for a card (ours did).
#define HBR_READER_UART 0

// 1 = the buzzer is PASSIVE (needs a tone; one click on plain 5V).
// 0 = ACTIVE buzzer (beeps by itself on plain 5V). Tone pitch in Hz below.
#define HBR_BUZZER_PASSIVE 0
#define HBR_BUZZER_TONE_HZ 2700

// 1 = restart the Uno automatically if the code ever freezes for 4 s
// (the lock then starts up LOCKED). Leave on. Only turn it off if your board
// is a clone with an old bootloader that gets stuck restarting over and over.
#define HBR_ENABLE_WATCHDOG 1
