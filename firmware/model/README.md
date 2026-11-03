# Firmware model

The real firmware (`../src`, `../lib/hbr_logic`) compiled to WebAssembly with emulated hardware,
for the Rack Model page (`frontend/model/`, http://localhost:8080/model/). How and why:
[../../docs/notes/firmware-model.md](../../docs/notes/firmware-model.md).

Nothing here is used by `pio run`. PlatformIO only compiles `src/` and `lib/`.

| File | What it is |
|---|---|
| `model_api.cpp` | Entry point: includes the real `main.cpp`, `lock.cpp`, `feedback.cpp`, `backend_sync.cpp`, `card_reader.cpp`, steps the clock, reports state to the page |
| `hw.cpp`, `hw.h` | The emulated ESP32 and parts: clock, GPIO, serial, I2C with the MPU-6050 and PN532, servo, flash, Wi-Fi, NTP, FreeRTOS, HMAC |
| `shim/` | Stand-ins for the ESP32-only headers (`Arduino.h`, `Wire.h`, `Adafruit_PN532.h`, `ESP32Servo.h`, ...) with the same functions |
| `config.h` | Model-only settings with fake Wi-Fi, token and card key. Replaces your `include/config.h`, which is never copied into the build |

```bash
node tools/model/build.mjs           # from the repo root; writes frontend/model/firmware.js + .json
node tools/model/check.mjs           # 34 checks against the real firmware's behaviour
node tools/model/build.mjs --check   # is the committed build current?
```
Rebuild after any change in `src/`, `include/` or `lib/hbr_logic/`.
