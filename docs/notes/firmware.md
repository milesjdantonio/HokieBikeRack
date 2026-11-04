# Firmware notes (ESP32, C++, PlatformIO)

## Layout: logic vs. hardware
```
firmware/
  lib/hbr_logic/src/      ← plain C++ "brains", NO Arduino calls → unit-tested on your PC
     access_rules         allow/deny + snapshot parsing + rollback rule
     tamper_detector      baseline, threshold, warning → alarm
     feedback_player      LED/buzzer patterns as timed steps
     lock_controller      momentary unlock timer
     hbr_util             UUID, ISO time, hex, card debounce
  src/                    ← thin hardware "glue" that calls the brains
     card_reader.cpp      PN532 over I2C
     tamper_sensor.cpp    MPU-6050 registers
     credential_ref.cpp   HMAC-SHA256 with mbedtls
     lock.cpp             ESP32Servo (only if HBR_ENABLE_SERVO 1)
     feedback.cpp         digitalWrite to LEDs/buzzer
     event_queue.cpp      LittleFS JSON-lines queue (+ mutex)
     access_policy.cpp    current snapshot in RAM + flash (+ mutex)
     backend_sync.cpp     the network task
     main.cpp             wires it together + serial console
  test/                   ← Unity tests: pio test -e native  (42 tests)
```
**Lesson:** if logic doesn't touch hardware, you can test it in seconds on a
laptop, including weird cases like `millis()` wrapping around after 49 days.
That's why the "brains" live in `lib/`.

## Non-blocking code (why there's no `delay(1000)`)
`loop()` runs hundreds of times a second. Each time, every part gets a quick
turn: "card ready?", "time for a tamper sample?", "lock timer up?", "which LED
step are we on?". Nothing waits. A pattern like *beep, pause, beep* is a list
of `{ms, red, green, buzzer}` steps, and `FeedbackPlayer::update(now)` just
asks "how long since we started? which step is that?".

If any part used `delay()`, *everything* would freeze: a card tap during a
2-second siren `delay` would be missed. That was the bug in the old firmware's
upload code (KNOWNBUGS #1).

**Time comparisons:** always `now - start >= duration`, never `now >= start + duration`.
With unsigned math, the first still works when `millis()` wraps to 0. (Tested.)

## Two tasks at once (FreeRTOS)
The ESP32 has two CPU cores and runs FreeRTOS (a small operating system).
- `loop()` runs in Arduino's task on **core 1**.
- `backend_sync.cpp` starts its own task on **core 0** with `xTaskCreatePinnedToCore`.
  HTTP calls can take seconds; now they only block that task.

Two tasks touching the same data at the same time = corrupted data. So:
- **Mutex** ("one at a time" lock) around the event queue file and the snapshot.
  `Guard g;` takes it and releases it automatically at the end of the scope (RAII).
- **`std::atomic`** for single flags/numbers shared for the heartbeat (`device_status.h`).
- Rule of thumb: only one task owns each piece of hardware. I2C (reader, accel),
  LEDs and servo are only touched by `loop()`. Wi-Fi only by the network task.

## I2C in 60 seconds
Two wires (SDA data, SCL clock) shared by many chips; each chip has an
address. PN532 = `0x24`, MPU-6050 = `0x68`. To read a register:
`beginTransmission(addr) → write(register) → endTransmission(false) → requestFrom(addr, n)`.
`endTransmission()` returning 0 means the chip answered ("ACK"). Use the
`i2c-scan` serial command to see who's on the bus.

## PN532: reading without freezing
The Adafruit library's `readPassiveTargetID()` waits for a card. Instead we:
1. `startPassiveTargetIDDetection()`: "tell me when a card shows up" (returns in ms).
2. Every 50 ms, read **one byte** over I2C: the PN532's status. `0x01` = answer ready.
3. Then `readDetectedPassiveTargetID()` to get the ID.
If the status read fails 5 times, the reader is marked faulty (`SENSOR_FAULT`
event) and we retry setup every 15 s.

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
- Same formula in `credential_ref.cpp`, `tools/device_simulator.py`, and the
  backend test `ApiIntegrationTest.credentialRef()`.
- It hides the ID; it does **not** stop cloned cards (a clone has the same ID).

## Snapshot rules (access_rules.cpp)
- Deny if: no snapshot, clock not set (or > 1 h behind the server's issue time),
  now ≥ `validUntil`, or reference not listed.
- **Rollback protection:** reject a snapshot with a *lower* revision than the
  current one. Otherwise someone could replay an old list where a revoked card
  was still allowed. Same revision with a later issue time = accepted (that's
  how the 72 h timer refreshes every minute while online).
- The backend's revision is based on the clock in milliseconds, so wiping the
  database doesn't make it go backwards. If it ever does, run `forget-snapshot`.
- Flash wear: the snapshot is only re-saved when the revision changes or the
  expiry moved ≥ 1 h (not every minute).

## Clock (NTP)
After Wi-Fi connects: `configTime(0, 0, "pool.ntp.org", …)`. Until it answers,
`time()` returns ~1970, which `isClockPlausible()` treats as "unknown" (→ deny,
events sent with `occurredAt: null`; the server fills in its receive time and
marks `timeSource = SERVER`).

## Event queue on flash (LittleFS)
- One JSON object per line in `/events.jsonl`. Appending is cheap; a power cut
  can only damage the last line, which is skipped when reading.
- Removing sent events: write the survivors to `/events.tmp`, then `rename` over
  the original. Rename is a single step, so we never end up with *no* queue file.
- Size caps: above 256 KB only MEDIUM+ events are kept; above 400 KB nothing.
- If the server says 400 for a batch, we switch to one-at-a-time so a single bad
  event gets dropped instead of blocking all the good ones forever.

## Servo (MG90S)
- 50 Hz signal; pulse width 500–2400 µs ↔ 0–180°. `ESP32Servo` handles the PWM.
- `HBR_ENABLE_SERVO 0` (default) = simulated: serial prints only.
- The servo can jump at power-on when the signal starts. Keep the linkage disconnected for the first tests.
- No position feedback: "unlocked" means "told to unlock".
- If the ESP32 resets when the servo moves, that's a **brownout** (voltage dip). The
  `DEVICE_BOOT` event reports `resetReason: BROWNOUT`. Fix: separate 5 V
  supply, shared ground, big capacitor near the servo.

## Memory / flash budget
`huge_app.csv` partition: 3 MB app (we use ~1.4 MB, 44%), ~900 KB LittleFS.
Trade-off: no over-the-air (OTA) updates; flash over USB.

## Serial console (115200 baud)
`status`, `sync`, `forget-snapshot`, `clear-queue`, `reboot`, `i2c-scan`, `accel`,
and with `HBR_ENABLE_SERIAL_SIM 1`: `tap <hex-id>`, `shake`.
`tap` goes through the exact same access check as a real card, so it can only
unlock for a registered card. Still, set `HBR_ENABLE_SERIAL_SIM 0` for a real deployment.
