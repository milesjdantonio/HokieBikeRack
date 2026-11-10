#pragma once
// Settings for the firmware MODEL only (firmware/model/README.md). It takes the place of your
// git-ignored include/config.h, so nothing secret ever ends up in the built page.
// This card key is made up and only means something inside the model.
#define HBR_CARD_KEY "model-card-key-not-a-secret"

// The model always drives the servo, so you can watch it. On the real rack this stays 0 until
// the servo bench test passes (docs/notes/hardware-test-checklist.md, section 4).
#define HBR_ENABLE_SERVO 1
// Servo angles are NOT set here, so the defaults in include/device_config.h apply.
// `node tools/model/build.mjs --local-config` copies your bench-tested HBR_SERVO_* lines from
// include/config.h instead (only those lines; nothing else from that file).

// Same as config.example.h: the serial `tap` and `shake` commands work in the model's console.
#define HBR_ENABLE_SERIAL_SIM 1

// Same as config.example.h: a 4 s watchdog restarts the Uno if loop() ever freezes.
#define HBR_ENABLE_WATCHDOG 1
