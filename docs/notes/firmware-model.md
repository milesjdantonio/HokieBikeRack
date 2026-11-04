# The rack model (the firmware running in a browser)

`http://localhost:8080/model/` shows the rack in 3D, built after the Lockpost concept model, with
our parts inside: ESP32 DevKit, PN532, MPU-6050, MG90S servo, LEDs, buzzer, capacitor, the
separate 5 V supply. What it does is not animated by hand. **The page runs our real firmware**
(`firmware/src` and `firmware/lib/hbr_logic`, unchanged) compiled to WebAssembly, on emulated
hardware. When the green LED lights in the model, it's because `feedback.cpp` called
`digitalWrite(GREEN, HIGH)`. When the latch opens, `lock.cpp` sent the servo a 1450 µs pulse.

It's a learning and rehearsal tool. It never talks to the real backend or a real rack, and it
isn't linked from the rider, staff, police or admin sites.

## What's real, what's emulated, what's a guess

| | Where it comes from |
|---|---|
| Everything the rack *decides*: allow/deny, re-lock time, tamper threshold, warning vs alarm, light patterns, when to sync, retries, the card HMAC | The real firmware, compiled from `firmware/src` and `firmware/lib/hbr_logic` |
| Pin numbers, I2C speed, servo pulse range, MPU-6050 range | Read back from what the firmware did in `setup()` (the "Pins" table on the Values tab) |
| The card list's lifetime (72 h) | `backend/src/main/resources/application.yml`, read at build time |
| The chips: MPU-6050 registers, PN532, servo library, flash, Wi-Fi, clock | Emulated in `firmware/model/hw.cpp`, following the datasheet or the real library |
| How fast things are: Wi-Fi join 2.5 s, NTP 1.2 s, servo 60° per 0.1 s, post sway 3.5 Hz | **Guesses.** Listed under "Model Assumptions" on the Values tab. The bench test measures the real ones |

## How it works

### 1. Same C++, different compiler
`node tools/model/build.mjs` compiles the firmware with **Emscripten** (a C++ compiler that
outputs WebAssembly instead of ESP32 machine code). The files that touch hardware call libraries
that only exist on the ESP32 (`Wire.h`, `Adafruit_PN532.h`, `ESP32Servo.h`, `WiFi.h`, FreeRTOS,
mbedtls...). `firmware/model/shim/` has fake versions of those headers with the same functions,
and `firmware/model/hw.cpp` makes them behave like the real parts:

- **MPU-6050**: a register map. The firmware writes `PWR_MGMT_1` to wake it and `ACCEL_CONFIG`
  to pick ±4 g, then reads six bytes from `0x3B`. The fake chip scales the post's motion by the
  range the firmware actually picked, adds a little noise, and ignores reads while asleep.
  Write the wrong register and the model breaks the same way the real chip would.
- **PN532**: answers like the Adafruit library does, including the 20 ms a real reader needs
  to notice a card. Unplug it (Try It tab) and every call fails, so `card_reader.cpp`'s
  retry and fault reporting run for real.
- **I2C takes time**: each transfer costs `(bytes + 1) × 9 bits ÷ bus speed`, so the clock
  moves while the firmware talks to the chips.
- **Servo**: the pulse math is copied from the ESP32Servo library (degrees are mapped onto the
  `attach()` range, clamped to 500 to 2500 µs).

### 2. A clock the model controls
`millis()` reads a virtual clock. Each animation frame, the page asks for "the next 16 ms" and
the model runs `loop()` until the clock gets there. Every LED edge and servo pulse change is
logged with its exact time, so the timeline under the 3D view catches a 30 ms blip even at 4x
speed. A `loop()` pass that does no I2C costs 1 ms (a real ESP32 does many passes per ms; it
doesn't change any decision because everything in `loop()` is timer-driven).

### 3. Two tasks on one thread
On the ESP32 the network task (`backend_sync.cpp`) runs on core 0 next to `loop()` on core 1.
The browser has one thread, so the model takes turns: when the network task calls
`vTaskDelay(100)`, the model jumps back out of it (`setjmp`/`longjmp`) and runs `loop()` until
those 100 ms have passed, then lets the task continue. This works because the task keeps nothing
on its stack between turns. HTTP calls go to `frontend/model/server.js`, a small stand-in that
answers the same three device endpoints as the Spring backend and checks the Bearer token.

### 4. Reading the firmware's state without changing it
The live readout shows things like the tamper baseline and the re-lock countdown, which live in
private variables. `firmware/model/model_api.cpp` `#include`s `main.cpp`, `lock.cpp` and the
other glue files directly, so its functions are in the same compile unit and can read those
variables. **Not one line of `firmware/src` was changed for the model.**

### 5. Reboots lose RAM, keep flash
Power Cycle throws the WebAssembly instance away and starts a new one, copying only the flash
files (the saved card list and the event queue) across. That's why KNOWNBUGS #3 shows up in the
model on its own: after a power cut with the hotspot off, the card list is still there but the
clock isn't, so every card is denied with `CLOCK_NOT_SET`.

### 6. No secrets in the build
The model uses `firmware/model/config.h` (fake Wi-Fi, fake token, fake card key) instead of your
`include/config.h`. The build copies the headers into `firmware/.pio/model/include` **without**
`config.h`, so yours can't end up in the page. `--local-config` copies only the two
`HBR_SERVO_*_DEG` lines, if you want the model to use your tuned servo angles.

## Things to try (each one shows a firmware lesson)
1. **Tap a card in the first second.** Denied: `NO_SNAPSHOT`. A rack with no card list fails secure.
2. **Tap Your HokieP once Wi-Fi is up.** Denied `NOT_LISTED`; it shows up under Unknown Cards
   Tapped on the Server tab. Register it, press Sync Now, tap again: allowed.
3. **Tick "Leave It on the Reader".** The reader reads the card every poll, but the firmware
   acts once (the debouncer in `main.cpp`).
4. **Knock, then knock again.** One knock under the threshold does nothing. Shake gives a
   warning; shake again within 30 s and the siren starts. Keep shaking now and then and it
   keeps going; stop and it ends 5 s later (at least 10 s). Tap an allowed card to stop it.
11. **Shackle:** tap a card, Pull Shackle Out, wait for the re-lock, then Push Shackle In.
    The spring latch takes it with no card. Pull while locked: the latch holds and the yank
    shakes the post.
5. **Unlock, then shake.** Ignored: the grace period after an unlock (the shaded band in the
   Tamper row), so a rider pulling a bike out doesn't set off the alarm.
6. **Drag the Lean slider slowly to 25°, back to 0, then flick it.** Slow lets the baseline
   follow (a post settling). A flick past about 21° counts as a jolt: that much tilt moves
   gravity by the 0.35 g threshold. 10° never does, however fast.
7. **Turn off the servo's 5 V, then tap.** The firmware says "unlocked" and the horn doesn't
   move. It can't tell: no position feedback (KNOWNBUGS #5).
8. **Unplug the PN532.** `SENSOR_FAULT` goes to the server, the idle blip turns red, and the
   reader comes back on its own when you plug it in again.
9. **Hotspot off, then Power Cycle.** KNOWNBUGS #3, as above. Hotspot on again and it recovers.
10. **Serial tab:** `status`, `i2c-scan`, `accel` are the same commands as the bench test.

## When the firmware changes
```bash
node tools/model/build.mjs           # about 15 s; writes frontend/model/firmware.js + firmware.json
node tools/model/check.mjs           # 40 checks: boot, cards, HMAC, tamper, alarm, offline, power cut
node tools/model/build.mjs --check   # exit 1 if firmware.js is older than the firmware
```
The built files are committed, so teammates who only open the page need nothing installed.
Building needs Emscripten: emsdk on any OS, or on Windows
`pacman -S mingw-w64-ucrt-x86_64-emscripten` in MSYS2 (the build script works around that
package's broken `.exe` launchers; see `tools/model/emscripten_msys2.py`).

## What the model can't tell you
- Real timings: how long Wi-Fi really takes, how far the PN532 reads through the window, how
  fast the real servo is under load.
- Electrical problems: brownouts when the servo starts, a loose jumper, a swapped SDA/SCL.
- Whether the latch mechanism holds. A commanded angle is not a locked bike.
- Memory: "free heap" in `status` is the model's, not the ESP32's.
- Real tamper numbers: the post's sway frequency and damping are guesses until section 5 of
  the [bench test](hardware-test-checklist.md) measures them.

So the model is for understanding and rehearsing the logic. The bench test is still the test.

## Review questions
- Why can the model run `tamper_sensor.cpp` unchanged but not the Adafruit PN532 library?
- What would break if `syncTask` kept a local variable across `vTaskDelay()` calls?
- Why does Power Cycle make a new WebAssembly instance instead of calling `setup()` again?
- Where does the 72 h on the Server tab come from, and why isn't it in the firmware?
