# Firmware notes (Arduino Uno R3, C++, PlatformIO)

> The rack moved from an ESP32 to an **Arduino Uno R3** on 2026-11-10. The Uno
> has no Wi-Fi, so the rack now works **on its own**: cards are enrolled at the
> rack and saved in EEPROM, and events are printed to the serial monitor
> instead of being sent to the backend. The last ESP32 version (Wi-Fi, backend
> sync, snapshots, event queue) is the git tag **`esp32-final`**.

## Layout: logic vs. hardware
```
firmware/
  lib/hbr_logic/src/      ← plain C++ "brains", NO Arduino calls → unit-tested on your PC
     card_list            the allowed-card list in EEPROM + card reference math
     hmac_sha256          SHA-256 + HMAC (the Uno has no crypto library built in)
     tamper_detector      baseline, threshold, warning → alarm
     feedback_player      LED/buzzer patterns as timed steps
     lock_controller      momentary unlock timer
     hbr_util             hex text, card debounce
  src/                    ← thin hardware "glue" that calls the brains
     card_reader.cpp      PN532 over I2C
     tamper_sensor.cpp    MPU-6050 registers
     credential_ref.cpp   card ID → reference (uses HBR_CARD_KEY)
     card_store.cpp       connects card_list to the real EEPROM
     lock.cpp             Servo library (only if HBR_ENABLE_SERVO 1)
     feedback.cpp         digitalWrite to LEDs/buzzer
     main.cpp             wires it together + serial console
  test/                   ← Unity tests: pio test -e native  (43 tests)
```
**Lesson:** if logic doesn't touch hardware, you can test it in seconds on a
laptop, including weird cases like `millis()` wrapping around after 49 days.
That's why the "brains" live in `lib/`.

## ESP32 → Uno: what changed and why
| | ESP32 | Uno R3 | What we did |
|---|---|---|---|
| RAM | ~320 KB | **2 KB** | No `std::string`/`std::vector`/`String`; fixed arrays; every message in `F("...")` |
| Program flash | 3 MB | **32 KB** | Dropped Wi-Fi, HTTP, JSON. We use ~22 KB (68%) |
| Storage | ~900 KB file system | **1 KB EEPROM** | Card list only; 63 cards max |
| Wi-Fi | yes | no | Rack works alone; enrol cards at the rack |
| Clock | NTP over Wi-Fi | none | Card list doesn't expire; remove cards by hand |
| Crypto | mbedtls | none | Own SHA-256/HMAC, checked against official test vectors |
| CPU | 2 cores + FreeRTOS | 1 core, no OS | One `loop()`; no mutexes needed |
| Logic level | 3.3 V | 5 V | Modules powered from 5V (wiring-guide.md) |

## Non-blocking code (why there's no `delay(1000)`)
`loop()` runs hundreds of times a second. Each time, every part gets a quick
turn: "card ready?", "time for a tamper sample?", "lock timer up?", "which LED
step are we on?". Nothing waits. A pattern like *beep, pause, beep* is a list
of `{ms, red, green, buzzer}` steps, and `FeedbackPlayer::update(now)` just
asks "how long since we started? which step is that?".

If any part used `delay()`, *everything* would freeze: a card tap during a
2-second siren `delay` would be missed. On the Uno this matters even more,
because there is only one core and nothing else can run in the meantime.

**Time comparisons:** always `now - start >= duration`, never `now >= start + duration`.
With unsigned math, the first still works when `millis()` wraps to 0. (Tested.)

## Living in 2 KB of RAM
- **`F("text")`** keeps a fixed message in flash instead of copying it into RAM
  at start-up. Without it, the serial messages alone would fill the RAM.
- **No `String`**: each one grabs heap memory, and many small grabs and frees
  leave the heap full of holes ("fragmentation") until an allocation fails.
  The serial console uses one fixed 80-character buffer.
- **`PROGMEM`**: the SHA-256 constant table (256 bytes) lives in flash, read
  with `pgm_read_dword`.
- `status` shows **free RAM** (bytes between the heap and the stack). It
  should stay well above 500. If it drops, look for a big local array.

## Watchdog
`wdt_enable(WDTO_4S)` at the end of `setup()`; `wdt_reset()` at the top of `loop()`.
If the code ever freezes for 4 s, the chip restarts and the lock starts up
**locked**. That matters because the servo keeps holding its last position
even if the code stops. The `reboot` command uses the same mechanism with a
15 ms timeout. Turn it off with `HBR_ENABLE_WATCHDOG 0` only if your board is
a clone with an old bootloader that gets stuck restarting.

## I2C in 60 seconds
Two wires (SDA data, SCL clock) shared by many chips; each chip has an
address. PN532 = `0x24`, MPU-6050 = `0x68`. On the Uno, SDA = **A4** and SCL = **A5**.
To read a register:
`beginTransmission(addr) → write(register) → endTransmission(false) → requestFrom(addr, n)`.
`endTransmission()` returning 0 means the chip answered ("ACK"). Use the
`i2c-scan` serial command to see who's on the bus.
`Wire.setWireTimeout(25000, true)`: without it, a loose wire can make the
Uno's Wire library wait forever.

## PN532: reading without freezing
The Adafruit library's `readPassiveTargetID()` waits for a card. Instead we:
1. `startPassiveTargetIDDetection()`: "tell me when a card shows up" (returns in ms).
2. Every 50 ms, read **one byte** over I2C: the PN532's status. `0x01` = answer ready.
3. Then `readDetectedPassiveTargetID()` to get the ID.
If the status read fails 5 times, the reader is marked faulty (`SENSOR_FAULT`
in the log) and we retry setup every 15 s.

The library calls `pinMode()` on the IRQ and reset pins, so they must be real
pin numbers (2 and 3) even if unwired. On the Uno, a fake pin number like
`-1` would make `pinMode()` write to a random memory address.

## MPU-6050 registers we use
| Register | Value | Meaning |
|---|---|---|
| `0x75` WHO_AM_I | read | `0x68` genuine; clones may say `0x70`/`0x98` (fine) |
| `0x6B` PWR_MGMT_1 | `0x01` | wake from sleep, use gyro clock |
| `0x1C` ACCEL_CONFIG | `0x08` | ±4 g range → 8192 counts per g |
| `0x1A` CONFIG | `0x03` | ~44 Hz low-pass filter (less noise) |
| `0x3B..0x40` | read 6 bytes | X, Y, Z as signed 16-bit, high byte first |

## Tamper detection math
- Baseline = exponential moving average: `base += (reading - base) * 0.02` each sample.
  Follows slowly when calm, *very* slowly (0.002) while shaking so a shake can't
  "teach itself" as normal.
- Deviation = length of the vector `(reading - baseline)` in g.
- 3 consecutive samples over 0.35 g = jolt (filters one-sample noise spikes).
- Warning → (another jolt within 30 s) → Alarm. 3 s cooldown so one
  shake = one event, not fifty.
- The siren runs at least 10 s (`HBR_TAMPER_ALARM_MS`) and stops only once the post has
  been still for 5 s (`HBR_TAMPER_ALARM_QUIET_MS`): every jolt during it pushes the end
  back. The 30 s escalation window counts from when the siren stops, so a thief who
  waits for silence and tries again gets the siren straight away.
- **Tuning:** use `accel` in the serial monitor, bump the rack normally, shake
  it "like a thief", and pick a threshold between the two. Change `thresholdG`
  in `tamper_detector.h`.

## Card references (HMAC)
`reference = HMAC-SHA256(HBR_CARD_KEY, "hbr-card-v1:" + lowercase hex ID)`.
- HMAC = a hash mixed with a secret key. Without the key you can't compute or
  reverse it. Every rack shares the key so a card has the same reference everywhere.
- The `"hbr-card-v1:"` label lets us change the scheme later without confusion.
- Same formula in `card_list.cpp` (`makeCardRef`), `tools/device_simulator.py`,
  and the backend test `ApiIntegrationTest.credentialRef()`. A PC test checks
  the Uno gets the same answer as Python.
- The Uno saves only the **first 16 bytes** (32 hex characters). 2^128
  possibilities is still impossible to guess, and it lets 63 cards fit in 1 KB.
- It hides the ID; it does **not** stop cloned cards (a clone has the same ID).

## The card list in EEPROM (card_list.cpp)
- Layout: `'H' 'B'`, format version, card count, then 16 bytes per card.
  A blank or foreign EEPROM is detected and wiped to an empty list at boot.
- **Power-cut safe ordering:** a new card's bytes are written *before* the
  count goes up, so a cut half-way just loses that one card. Removing copies
  the last card into the hole *before* the count goes down.
- **Wear:** each EEPROM byte survives ~100,000 writes. `EEPROM.update()` skips
  bytes that already hold the right value. Taps only *read* the list, so
  normal use doesn't wear it at all.
- **No expiry:** with no clock, the ESP32's 72 h snapshot rule can't exist. A
  card stays allowed until someone removes it (`unenroll`, or `list` +
  `remove <n>`).
- Anyone with a USB cable and the serial monitor can enrol a card. Keep the
  Uno inside the locked housing.

## Servo (MG90S)
- 50 Hz signal; pulse width 500–2400 µs ↔ 0–180°. The `Servo` library handles
  it with Timer1 (this disables PWM on pins 9 and 10; we don't need it there).
- `HBR_ENABLE_SERVO 0` (default) = simulated: serial prints only.
- The servo can jump at power-on when the signal starts. Keep the linkage disconnected for the first tests.
- No position feedback: "unlocked" means "told to unlock".
- If the Uno restarts when the servo moves (you'll see the start-up messages
  again), that's a **brownout** (voltage dip). Fix: separate 5 V supply,
  shared ground, big capacitor near the servo.

## Memory / flash budget
Normal build: **863 bytes RAM (42%)**, **21.8 KB flash (68%)**.
With the servo and test commands on: 908 bytes RAM, 23.2 KB flash. The Nano (`pio run -e nano`) is the same.
There's room for small features, but not for Wi-Fi or JSON.

## Serial console (115200 baud)
| Command | What it does |
|---|---|
| `status` | Everything at a glance (cards, sensors, lock, free RAM) |
| `enroll` | The next card tapped (within 15 s) is **added** |
| `unenroll` | The next card tapped (within 15 s) is **removed** |
| `list` | Numbered list of enrolled cards (first 12 hex characters each) |
| `add <reference>` | Add a card by its reference (≥ 32 hex chars, same card key) |
| `remove <n>` | Remove card number `n` from `list` |
| `wipe-cards` | Remove every card (asks you to type `wipe-cards yes`) |
| `i2c-scan` | Who answers on the I2C bus |
| `accel` | 2 s of raw accelerometer readings |
| `reboot` | Restart the Uno |
| `tap <hex-id>`, `shake` | Test commands, only with `HBR_ENABLE_SERIAL_SIM 1` |

`tap` goes through the exact same check as a real card, so it can only
unlock for an enrolled card. Still, set `HBR_ENABLE_SERIAL_SIM 0` for a real deployment.

## Running the tests on this laptop
Windows **Smart App Control** on this laptop blocks `pio.exe` and any new
program it builds, including the test programs from `pio test -e native`.
- Building/uploading: `~/.platformio/penv/Scripts/python.exe -m platformio run` works.
- Tests: `cd firmware/tools/wasm-tests && npm install && npm test`. This
  compiles the same tests to **WebAssembly** with a clang that is itself
  WebAssembly (npm package `@yowasp/clang`) and runs them inside Node, which
  Windows trusts. No `.exe` is made and Smart App Control stays on.
  (First run downloads ~100 MB. Unity must have been downloaded once by
  PlatformIO; the script tells you how if it's missing.)
- One small difference: WebAssembly has no `setjmp`, so Unity is built with
  `UNITY_EXCLUDE_SETJMP_H`. A failed check still fails the test.
- On any other computer, `pio test -e native` is still the normal way.
