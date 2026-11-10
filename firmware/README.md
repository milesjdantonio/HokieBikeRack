# Arduino Uno R3 firmware

C++ / PlatformIO for an **Arduino Uno R3** with a PN532 (I2C), MPU-6050 (I2C), MG90S servo,
red/green LEDs and an active buzzer. Concepts explained in [../docs/notes/firmware.md](../docs/notes/firmware.md).

The Uno has no Wi-Fi, so this rack works **on its own**: allowed cards are enrolled
at the rack and saved in EEPROM (up to 63), and events are printed to the serial
monitor. The previous ESP32 version (Wi-Fi + backend sync) is the git tag `esp32-final`:
`git checkout esp32-final -- firmware` brings it back.

## Commands (from this folder)
```bash
pio test -e native      # logic tests on your PC (needs g++; MSYS2 on Windows)
pio run                 # build for the Uno
pio run -t upload       # flash over USB
pio device monitor      # serial console, 115200 baud
```
On this laptop Windows blocks `pio.exe`; use `~/.platformio/penv/Scripts/python.exe -m platformio`
instead (e.g. `... -m platformio run -t upload`). Windows also blocks the test
programs, so run `pio test` on another machine.

## Setup
1. Copy `include/config.example.h` to `include/config.h` (git-ignored).
2. Fill in `HBR_CARD_KEY` (16+ characters, the same on every rack).
3. Leave `HBR_ENABLE_SERVO 0` until the servo bench test passes.
4. Flash, open the serial monitor, type `enroll`, tap a card. It now opens the rack.
Without `config.h` it still builds and runs, denying every card.

## Layout
- `lib/hbr_logic/`: hardware-free logic (card list, SHA-256/HMAC, tamper detector, LED/buzzer patterns, lock timer, helpers)
- `src/`: hardware glue + `main.cpp`
- `include/`: headers, `pins.h`, `config.example.h`, `device_config.h`
- `test/`: Unity tests for `lib/hbr_logic`
- `KNOWNBUGS.txt`: known limitations

## Serial console
`status`, `enroll`, `unenroll`, `list`, `add <reference>`, `remove <n>`, `wipe-cards`,
`i2c-scan`, `accel`, `reboot`, and (with `HBR_ENABLE_SERIAL_SIM 1`) `tap <hex-id>`, `shake`.
What each does: [firmware.md → Serial console](../docs/notes/firmware.md#serial-console-115200-baud).

## What the lights mean
| Pattern | Meaning |
|---|---|
| Red+green flash + beep at power-on | booting |
| Short green blip every 5 s | ready (cards enrolled, card key set, reader OK) |
| Short red blip every 5 s | not ready (no cards enrolled, no card key, or reader fault) |
| Green + short beep, green stays 5 s | access granted, unlocked |
| Green + short beep, 1 s (after `enroll`) | card enrolled |
| Red + two beeps | access denied (or card removed after `unenroll`) |
| Red blinks + 3 quick chirps | tamper warning |
| Flashing red + siren for 10 s | tamper alarm (an allowed card stops it) |

## Memory
846 bytes of 2048 RAM, 21.3 KB of 32 KB flash (servo + test commands on: 891 bytes, 22.8 KB).

## Safety
Servo power from a separate 5 V supply, never the Uno's 5V pin. Test with the linkage
disconnected first. Commanded position is not proof the latch moved. A 4 s watchdog
restarts the Uno (and re-locks) if the code ever freezes.
