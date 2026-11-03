#pragma once
// Settings for the firmware MODEL only (firmware/model/README.md). It takes the place of your
// git-ignored include/config.h, so nothing secret ever ends up in the built page.
// These are made-up values that only the model server on the page knows.
#define HBR_WIFI_SSID "model-hotspot"
#define HBR_WIFI_PASSWORD "model-password"
#define HBR_API_BASE_URL "http://172.20.10.2:8080"
#define HBR_DEVICE_ID "model-rack-a"
#define HBR_DEVICE_TOKEN "model-device-token"
#define HBR_ALLOW_INSECURE_HTTP 1
#define HBR_CARD_KEY "model-card-key-not-a-secret"

// The model always drives the servo, so you can watch it. On the real rack this stays 0 until
// the servo bench test passes (docs/notes/hardware-test-checklist.md, section 4).
#define HBR_ENABLE_SERVO 1
// Servo angles are NOT set here, so the defaults in include/device_config.h apply.
// `node tools/model/build.mjs --local-config` copies your bench-tested HBR_SERVO_* lines from
// include/config.h instead (only those lines; nothing else from that file).

// Same as config.example.h: the serial `tap` and `shake` commands work in the model's console.
#define HBR_ENABLE_SERIAL_SIM 1
