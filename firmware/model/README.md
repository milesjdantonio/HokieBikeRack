# Firmware model

The real Arduino Uno firmware (`../src`, `../lib/hbr_logic`) compiled to WebAssembly with an
emulated Uno and parts, for the Rack Model page (`frontend/model/`, http://localhost:8080/model/).
How and why: [../../docs/notes/firmware-model.md](../../docs/notes/firmware-model.md).

Nothing here is used by `pio run`. PlatformIO only compiles `src/` and `lib/`.

| File | What it is |
|---|---|
| `model_api.cpp` | Entry point: includes the real `main.cpp`, `lock.cpp`, `feedback.cpp`, `card_reader.cpp`, `card_store.cpp`, steps the clock, reports state to the page |
| `hw.cpp`, `hw.h` | The emulated Uno and parts: clock, GPIO, serial, I2C with the MPU-6050 and PN532, Servo library, EEPROM, watchdog |
| `shim/` | Stand-ins for the Uno-only headers (`Arduino.h`, `Wire.h`, `Servo.h`, `EEPROM.h`, `avr/wdt.h`, `avr/pgmspace.h`, `Adafruit_PN532.h`) with the same functions |
| `config.h` | Model-only settings with a made-up card key. Replaces your `include/config.h`, which is never copied into the build |

```bash
cd tools/model && npm install && cd ../..   # once: Binaryen as WebAssembly (see firmware-model.md)
node tools/model/build.mjs           # from the repo root; writes frontend/model/firmware.js + .json
node tools/model/check.mjs           # 53 checks against the real firmware's behaviour
node tools/model/build.mjs --check   # is the committed build current?
```
Rebuild after any change in `src/`, `include/` or `lib/hbr_logic/`.
