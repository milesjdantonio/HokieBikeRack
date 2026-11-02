#pragma once
// Loads your local config.h (Wi-Fi, API URL, device token) if it exists,
// and fills in SAFE defaults for anything missing so the code still builds.
// To set up: copy config.example.h to config.h and fill it in. Never commit config.h.
// Shared file: tell your teammate before changing it.
//
// Note: if config.h is missing, the defaults mean "no network, no card key,
// simulated servo". The rack then denies every card (fail-secure).

#if __has_include("config.h")
#include "config.h"
#define HBR_HAS_LOCAL_CONFIG 1
#else
#define HBR_HAS_LOCAL_CONFIG 0
#endif

#define HBR_FIRMWARE_VERSION "0.2.0"

#ifndef HBR_API_BASE_URL
#define HBR_API_BASE_URL ""
#endif
#ifndef HBR_DEVICE_ID
#define HBR_DEVICE_ID ""
#endif
#ifndef HBR_DEVICE_TOKEN
#define HBR_DEVICE_TOKEN ""
#endif
#ifndef HBR_API_ROOT_CA
#define HBR_API_ROOT_CA ""
#endif
#ifndef HBR_WIFI_SSID
#define HBR_WIFI_SSID ""
#endif
#ifndef HBR_WIFI_PASSWORD
#define HBR_WIFI_PASSWORD ""
#endif
#ifndef HBR_ALLOW_INSECURE_HTTP
#define HBR_ALLOW_INSECURE_HTTP 0
#endif
#ifndef HBR_CARD_KEY
#define HBR_CARD_KEY ""
#endif
#ifndef HBR_ENABLE_SERVO
#define HBR_ENABLE_SERVO 0
#endif
#ifndef HBR_SERVO_LOCKED_DEG
#define HBR_SERVO_LOCKED_DEG 0
#endif
#ifndef HBR_SERVO_UNLOCKED_DEG
#define HBR_SERVO_UNLOCKED_DEG 90
#endif
#ifndef HBR_ENABLE_SERIAL_SIM
#define HBR_ENABLE_SERIAL_SIM 0
#endif

// Behaviour timings (not secrets, so they live here instead of config.h).
constexpr uint32_t HBR_UNLOCK_DURATION_MS = 5000;     // momentary unlock length
constexpr uint32_t HBR_TAMPER_GRACE_MS = 10000;       // ignore jolts this long after re-lock
constexpr uint32_t HBR_TAMPER_SAMPLE_MS = 20;         // 50 accelerometer samples per second
constexpr uint32_t HBR_TAMPER_ALARM_MS = 10000;       // siren length
