#pragma once
// Loads your local config.h (card key, servo switches) if it exists,
// and fills in SAFE defaults for anything missing so the code still builds.
// To set up: copy config.example.h to config.h and fill it in. Never commit config.h.
// Shared file: tell your teammate before changing it.
//
// Note: if config.h is missing, the defaults mean "no card key, simulated
// servo". The rack then denies every card (fail-secure).
//
// An old ESP32 config.h (with Wi-Fi settings) still works: the Uno version
// simply ignores the settings it doesn't use.
#include <stdint.h>

#if __has_include("config.h")
#include "config.h"
#define HBR_HAS_LOCAL_CONFIG 1
#else
#define HBR_HAS_LOCAL_CONFIG 0
#endif

#define HBR_FIRMWARE_VERSION "0.3.0-uno"

#ifndef HBR_CARD_KEY
#define HBR_CARD_KEY ""
#endif
#ifndef HBR_ENABLE_SERVO
#define HBR_ENABLE_SERVO 0
#endif
#ifndef HBR_SERVO_LOCKED_DEG
#define HBR_SERVO_LOCKED_DEG 60    // plate pushed down, held against the spring
#endif
#ifndef HBR_ENABLE_CARD_BUTTONS
#define HBR_ENABLE_CARD_BUTTONS 0  // card button on A0: short press = add, hold 2 s = remove
#endif
#ifndef HBR_SERVO_REVERSED
#define HBR_SERVO_REVERSED 0  // 1 = servo upside down: sends 180 - angle
#endif
#ifndef HBR_SERVO_UNLOCKED_DEG
#define HBR_SERVO_UNLOCKED_DEG 10  // plate up (spring), horn resting on the ledge
#endif
#ifndef HBR_ENABLE_SERIAL_SIM
#define HBR_ENABLE_SERIAL_SIM 0
#endif
#ifndef HBR_READER_UART
#define HBR_READER_UART 0
#endif
#ifndef HBR_BUZZER_PASSIVE
#define HBR_BUZZER_PASSIVE 0
#endif
#ifndef HBR_BUZZER_TONE_HZ
#define HBR_BUZZER_TONE_HZ 2700
#endif
#ifndef HBR_ENABLE_WATCHDOG
#define HBR_ENABLE_WATCHDOG 1
#endif

// Behaviour timings (not secrets, so they live here instead of config.h).
constexpr uint32_t HBR_UNLOCK_DURATION_MS = 5000;     // momentary unlock length
constexpr uint32_t HBR_TAMPER_GRACE_MS = 10000;       // ignore jolts this long after re-lock
constexpr uint32_t HBR_TAMPER_SAMPLE_MS = 20;         // 50 accelerometer samples per second
constexpr uint32_t HBR_TAMPER_ALARM_MS = 10000;       // the siren runs at least this long...
constexpr uint32_t HBR_TAMPER_ALARM_QUIET_MS = 5000;  // ...and until the post has been still this long
constexpr uint32_t HBR_ENROLL_WINDOW_MS = 15000;      // `enroll`: how long to wait for a tap
