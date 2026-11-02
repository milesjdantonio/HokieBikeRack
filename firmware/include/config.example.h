#pragma once
// HokieBikeRack local settings. Example only.
//
// SETUP: copy this file to include/config.h and fill it in.
// config.h is in .gitignore — NEVER commit it (it has your Wi-Fi password and
// the device token).
//
// Where do the values come from?
//  - Wi-Fi: your phone hotspot name/password (2.4 GHz! ESP32 can't do 5 GHz).
//  - DEVICE_ID + DEVICE_TOKEN: dashboard -> Racks -> "Add device". The token
//    is shown ONCE; the dashboard also shows a ready-made config snippet.
//  - API_BASE_URL: the laptop running the backend, e.g. "http://172.20.10.2:8080"
//    (find the laptop's IP with `ipconfig` while on the hotspot).
//  - CARD_KEY: any long random string, the SAME on every rack. Make one with:
//      python -c "import secrets; print(secrets.token_hex(32))"

#define HBR_WIFI_SSID ""
#define HBR_WIFI_PASSWORD ""

#define HBR_API_BASE_URL "http://192.168.0.10:8080"
#define HBR_DEVICE_ID ""
#define HBR_DEVICE_TOKEN ""

// Local demo only: 1 = allow plain http:// (no encryption) to the laptop on
// your hotspot. Anyone on the same network could read/alter traffic, so use
// https:// with HBR_API_ROOT_CA for anything beyond a supervised demo.
#define HBR_ALLOW_INSECURE_HTTP 1

// PEM root CA for an https:// API host. Paste one quoted line per certificate
// line, each ending in \n, for example:
//   #define HBR_API_ROOT_CA \
//     "-----BEGIN CERTIFICATE-----\n" \
//     "MIIF...\n" \
//     "-----END CERTIFICATE-----\n"
#define HBR_API_ROOT_CA ""

// Secret used to turn a card's ID into a "credential reference"
// (HMAC-SHA256). At least 16 characters. Must match on all racks.
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
