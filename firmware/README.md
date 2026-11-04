# ESP32 firmware

C++ / PlatformIO for an ESP32 DevKit with a PN532 (I2C), MPU-6050 (I2C), MG90S servo,
red/green LEDs and an active buzzer. Concepts explained in [../docs/notes/firmware.md](../docs/notes/firmware.md).

## Commands (from this folder)
```bash
pio test -e native      # 42 logic tests on your PC (needs g++; MSYS2 on Windows)
pio run                 # build
pio run -t upload       # flash
pio device monitor      # serial console, 115200 baud
```
On Windows without `pio` on PATH: `~/.platformio/penv/Scripts/pio.exe`.

No ESP32 yet? `node tools/model/build.mjs` (from the repo root) compiles this firmware to WebAssembly
for the Rack Model page: http://localhost:8080/model/. See [model/README.md](model/README.md).

## Setup
1. Copy `include/config.example.h` to `include/config.h` (git-ignored).
2. Fill in Wi-Fi, `HBR_API_BASE_URL`, device ID + token (dashboard → Racks → Add device), `HBR_CARD_KEY`.
3. Leave `HBR_ENABLE_SERVO 0` until the servo bench test passes.
Without `config.h` it still builds and runs offline, denying every card.

## Layout
- `lib/hbr_logic/`: hardware-free logic (access rules, tamper detector, LED/buzzer patterns, lock timer, helpers)
- `src/`: hardware glue + `main.cpp`
- `include/`: headers, `pins.h`, `config.example.h`, `device_config.h`
- `test/`: Unity tests for `lib/hbr_logic`
- `KNOWNBUGS.txt`: known limitations

## Serial console
`status`, `sync`, `forget-snapshot`, `clear-queue`, `reboot`, `i2c-scan`, `accel`,
and (with `HBR_ENABLE_SERIAL_SIM 1`) `tap <hex-id>`, `shake`.

## What the lights mean
| Pattern | Meaning |
|---|---|
| Red+green flash + beep at power-on | booting |
| Short green blip every 5 s | ready (has a valid card list, reader OK) |
| Short red blip every 5 s | not ready (no list yet, expired, no clock, no card key, reader fault) |
| Green + short beep, green stays 5 s | access granted, unlocked |
| Red + two beeps | access denied |
| Red blinks + 3 quick chirps | tamper warning |
| Flashing red + siren, at least 10 s, until the rack is still for 5 s | tamper alarm (an allowed card stops it) |

## Safety
Servo power from a separate 5 V supply, never an ESP32 pin. Test with the linkage
disconnected first. Commanded position is not proof the latch moved.
