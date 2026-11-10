# The rack model (the firmware running in a browser)

`http://localhost:8080/model/` shows the rack in 3D, built after the Lockpost concept model, with
our parts inside: Arduino Uno R3, PN532, MPU-6050, MG90S servo, LEDs, buzzer, capacitor, the
separate 5 V supply. What it does is not animated by hand. **The page runs our real firmware**
(`firmware/src` and `firmware/lib/hbr_logic`) compiled to WebAssembly, on an emulated Uno. When
the green LED lights in the model, it's because `feedback.cpp` called `digitalWrite(5, HIGH)`.
When the latch opens, `lock.cpp` sent the servo a 1450 µs pulse.

It's a learning and rehearsal tool. It never talks to the real backend or a real rack, and it
isn't linked from the rider, staff, police or admin sites.

> Until 2026-11-10 the model ran the ESP32 firmware, with Wi-Fi, a fake laptop server and a
> Server tab. The rack is an offline Uno now, so the model is too: cards are enrolled on the
> **Cards** tab (which types the same serial commands you'd type at the rack), and events show
> up in the serial log. The ESP32 version of the model is still in git: commit `d9668ff`
> (the tip of the `feature/alarm-quiet-time` branch).

## What's real, what's emulated, what's a guess

| | Where it comes from |
|---|---|
| Everything the rack *decides*: allow/deny, enrol/remove, re-lock time, tamper threshold, warning vs alarm, when the siren stops, light patterns, the card HMAC, the EEPROM layout | The real firmware, compiled from `firmware/src` and `firmware/lib/hbr_logic` |
| Pin numbers, I2C speed and timeout, servo pulse range, MPU-6050 range, watchdog time | Read back from what the firmware did in `setup()` (the "Pins" table on the Values tab) |
| The chips: ATmega328P (clock, pins, EEPROM, watchdog), MPU-6050 registers, PN532, Servo library | Emulated in `firmware/model/hw.cpp`, following the datasheet or the real library |
| How fast things are: PN532 noticing a card 20 ms, servo 60° per 0.1 s, post sway 3.5 Hz | **Guesses.** Listed under "Model Assumptions" on the Values tab. The bench test measures the real ones |

## How it works

### 1. Same C++, different compiler
`node tools/model/build.mjs` compiles the firmware with **Emscripten** (a C++ compiler that
outputs WebAssembly instead of AVR machine code). The files that touch hardware call libraries
that only exist for the Uno (`Wire.h`, `Adafruit_PN532.h`, `Servo.h`, `EEPROM.h`, `avr/wdt.h`,
`F()` strings in flash). `firmware/model/shim/` has stand-ins for those headers with the same
functions, and `firmware/model/hw.cpp` makes them behave like the real parts:

- **MPU-6050**: a register map. The firmware writes `PWR_MGMT_1` to wake it and `ACCEL_CONFIG`
  to pick ±4 g, then reads six bytes from `0x3B`. The fake chip scales the post's motion by the
  range the firmware actually picked, adds a little noise, and ignores reads while asleep.
  Write the wrong register and the model breaks the same way the real chip would.
- **PN532**: answers like the Adafruit library does, including the 20 ms a real reader needs
  to notice a card. Unplug it (Try It tab) and every call fails, so `card_reader.cpp`'s
  retry and fault reporting run for real. Like the real library, its constructor calls
  `pinMode()` on the IRQ and reset pins; if the firmware ever passed a pin the Uno doesn't
  have, the Values tab says so (on a real Uno that writes to random memory).
- **I2C takes time**: each transfer costs `(bytes + 1) × 9 bits ÷ bus speed`, and the AVR Wire
  library's 32-byte buffer is enforced.
- **Servo**: the pulse math is copied from the AVR Servo library (degrees are mapped onto the
  `attach()` range in 4 µs steps; pulses start at 1500 µs; 50 Hz from Timer1).
- **EEPROM**: 1024 bytes, blank = `0xFF`. Each real write costs 3.3 ms and is counted, because
  every byte of a real EEPROM survives only about 100,000 writes. `EEPROM.update()` skips bytes
  that wouldn't change, as on the chip.
- **Watchdog**: `wdt_enable(WDTO_4S)` arms a 4.1 s timer; `wdt_reset()` at the top of `loop()`
  feeds it. If the clock ever passes the deadline, the model's Uno resets on the spot. The
  `reboot` command arms a 16 ms watchdog and spins until it fires, same as on the board.

### 2. A clock the model controls
`millis()` reads a virtual clock. Each animation frame, the page asks for "the next 16 ms" and
the model runs `loop()` until the clock gets there. Every LED edge and servo pulse change is
logged with its exact time, so the timeline under the 3D view catches a 30 ms blip even at 4x
speed. `loop()` itself ends with `delay(2)`, so a pass costs at least 2 ms of model time.

### 3. One core, one loop
The Uno has one core and no operating system, so there's nothing to take turns with: `loop()`
does everything, and the model just calls it. (The ESP32 model had to juggle a second task
for the network with `setjmp`/`longjmp`. The Uno model only uses that trick for the
watchdog: a reset leaves `loop()` wherever it is, like the real reset line.)

### 4. Reading the firmware's state without changing it
The live readout shows things like the tamper baseline, the re-lock countdown and enrol mode,
which live in private variables. `firmware/model/model_api.cpp` `#include`s `main.cpp`,
`lock.cpp`, `card_store.cpp` and the other glue files directly, so its functions are in the
same compile unit and can read those variables. The only model-related line in `firmware/src`
is an `#if defined(__AVR__)` around the AVR-only start-up code in `main.cpp` (the `.init3`
section exists only on AVR chips).

### 5. Reboots lose RAM, keep EEPROM
Power Cycle throws the WebAssembly instance away and starts a new one, copying only the
EEPROM across. So enrolled cards survive, the lock starts up locked, and everything else
(tamper baseline, debounce, enrol mode) starts fresh, exactly like pulling the USB plug.
There's no clock, so unlike the ESP32 there's no "denied after a power cut" problem.

### 6. No secrets in the build
The model uses `firmware/model/config.h` (a made-up card key) instead of your
`include/config.h`. The build copies the headers into `firmware/.pio/model/include` **without**
`config.h`, so yours can't end up in the page. `--local-config` copies only the two
`HBR_SERVO_*_DEG` lines, if you want the model to use your tuned servo angles.

## Things to try (each one shows a firmware lesson)
1. **Tap the Unknown Card.** Denied `NOT_LISTED`. The Kit Card starts enrolled (as if done on
   the bench), so it opens the lock.
2. **Enrol your HokieP.** Cards tab → Enroll Next Tap, then tap Your HokieP: "enrolled". Tap
   again: allowed. Power Cycle: still allowed (EEPROM).
3. **Tick "Leave It on the Reader".** The reader reads the card every poll, but the firmware
   acts once (the debouncer in `main.cpp`).
4. **Knock, then knock again.** One knock under the threshold does nothing. Shake gives a
   warning; shake again within 30 s and the siren starts. Keep shaking now and then and it
   keeps going; stop and it ends 5 s later (at least 10 s). Tap an allowed card to stop it.
5. **Unlock, then shake.** Ignored: the grace period after an unlock (the shaded band in the
   Tamper row), so a rider pulling a bike out doesn't set off the alarm.
6. **Drag the Lean slider slowly to 25°, back to 0, then flick it.** Slow lets the baseline
   follow (a post settling). A flick past about 21° counts as a jolt: that much tilt moves
   gravity by the 0.35 g threshold. 10° never does, however fast.
7. **Turn off the servo's 5 V, then tap.** The firmware says "unlocked" and the horn doesn't
   move. It can't tell: no position feedback (KNOWNBUGS #7).
8. **Unplug the PN532.** A `SENSOR_FAULT` line in the log, the idle blip turns red, and the
   reader comes back on its own when you plug it in again.
9. **Shackle:** tap a card, Pull Shackle Out, wait for the re-lock, then Push Shackle In.
   The spring latch takes it with no card. Pull while locked: the latch holds and the yank
   shakes the post.
10. **Serial tab:** `status`, `list`, `enroll`, `i2c-scan`, `accel`, `reboot` are the same
    commands as the bench test. `reboot` restarts through the watchdog.

## Build options
The A / B / C switch above the 3D view rebuilds the rack at three sizes. The frame scales;
the parts are always drawn at their real size, so you can see whether they fit. The firmware
is the same for all three. The Values tab has a side-by-side table.

| | A Standard | B 0.75x | C 0.5x Mini |
|---|---|---|---|
| Size | 875 mm tall, 80 mm posts, 92 mm head | 656 mm tall, 60 mm posts, 69 mm head | 452 mm tall, 40 mm posts, 60 mm head |
| Board | Arduino Uno R3, standing in the post, USB down | Arduino Nano, standing in the post | Arduino Nano, standing in the post |
| Servo, buzzer, capacitor | MG90S, 12 mm, 1000 µF | Same as A | Sub-micro servo, 9 mm, 470 µF |
| Build the firmware with | `pio run -e uno` | `pio run -e nano` | `pio run -e nano` |
| Use | A real rack | A real rack, a little low | Tabletop demo model only |

What sets the limits: the Uno is 69 × 53 mm, and with its USB-B plug it needs about 105 mm,
so it can't lie in the 92 mm head next to the reader; it stands in option A's post (70 mm
inside). Option B's post is 52.5 mm inside, too narrow for the Uno's 53 mm, so B and C use an
**Arduino Nano**: the same ATmega328P chip and pin numbers on an 18 × 45 mm board, so the code
doesn't change at all. Get a Nano with the **new (Optiboot) bootloader**: the old one gets stuck
restarting after a watchdog reset (or set `HBR_ENABLE_WATCHDOG 0`). The servo, its arm's swing
and the latch need about 50 mm inside the post. The PN532 never shrinks (cards are 86 × 54 mm,
and a smaller antenna reads much less far), so the head can't go below about 60 mm, and it must
be plastic with the board 10–15 mm from any metal. Option C's sub-micro servo is much weaker:
use a light latch spring. Measure your boards with calipers: clone sizes vary.

Open a chosen option directly: `/model/?option=b` or `?option=c`.

## When the firmware changes
```bash
node tools/model/build.mjs           # about 10 s; writes frontend/model/firmware.js + firmware.json
node tools/model/check.mjs           # 53 checks: boot, cards, enrol, HMAC, tamper, siren, power cut, watchdog
node tools/model/build.mjs --check   # exit 1 if firmware.js is older than the firmware
```
The built files are committed, so teammates who only open the page need nothing installed.
Building needs Emscripten: emsdk on any OS, or on Windows
`pacman -S mingw-w64-ucrt-x86_64-emscripten` in MSYS2 (the build script works around that
package's broken `.exe` launchers; see `tools/model/emscripten_msys2.py`).

On this laptop, Windows Smart App Control blocks MSYS2's `wasm-opt.exe`. Run `npm install`
once in `tools/model/`: it fetches `binaryen`, the same tool compiled to WebAssembly, and the
build then runs it in Node instead (the build log says "+ Binaryen in Node"). Emscripten's
cache lives in your temp folder, not the project: OneDrive locks files while it syncs them.

## What the model can't tell you
- Real timings: how far the PN532 reads through the window, how fast the real servo is
  under load.
- Electrical problems: brownouts when the servo starts, a loose jumper, a swapped SDA/SCL,
  5 V vs 3.3 V trouble on the I2C lines.
- Whether the latch mechanism holds. A commanded angle is not a locked bike.
- Memory: "free RAM" in `status` means nothing in the model. The real figure (863 bytes of
  2048 used) comes from `pio run`.
- Real tamper numbers: the post's sway frequency and damping are guesses until section 5 of
  the [bench test](hardware-test-checklist.md) measures them.

So the model is for understanding and rehearsing the logic. The bench test is still the test.

## Review questions
- Why can the model run `tamper_sensor.cpp` unchanged but not the Adafruit PN532 library?
- Why does Power Cycle make a new WebAssembly instance instead of calling `setup()` again?
- What would happen on a real Uno if `PN532_IRQ_PIN` were `-1`? How does the model show it?
- Why does `reboot` arm a 16 ms watchdog and spin, instead of jumping to address 0?
