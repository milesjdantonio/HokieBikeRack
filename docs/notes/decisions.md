# Decision log

Each entry: **what**, **why**, and **what we didn't pick**. Newest last.
"Confirmed" = Miles decided on 2026-11-02. "Default" = chosen while building; change freely.

| # | Decision | Why | Alternative not picked |
|---|---|---|---|
| 1 | MPU-6050 (GY-521), PN532 on **I2C**, shared bus. *Confirmed.* | Parts in hand; I2C = 2 shared wires for both chips. | SPI for PN532 (more pins). |
| 2 | **Same card locks and unlocks** (2026-11-18, the prototype): tap to unlock, tap the same card again to lock. After 10 s the red LED flashes and it beeps every 2 s; re-locks itself after 120 s. Another card while open is refused (`IN_USE`). | The rider needs time to get the bike in or out; the reminder and the timeout stop it being left open. | Momentary unlock, 5 s, auto re-lock (the earlier choice). |
| 3 | Servo code real but **off by default** (`HBR_ENABLE_SERVO 0`). *Confirmed: "simulate it, test tomorrow".* | Team rule: no live actuator until wiring/fail-safe reviewed. | Simulated-only (no PWM code) or on by default. |
| 4 | Red + green LEDs, **active buzzer** via NPN transistor. *Confirmed.* | Parts in hand; transistor protects the GPIO. | Buzzer straight on GPIO (too much current for many buzzers). |
| 5 | Tamper: **warning first, then the siren** if it continues. The siren runs at least 10 s and stops only after 5 s of stillness, so a thief who keeps at it keeps it going; a jolt within 30 s of it stopping restarts it. *Confirmed (team, 2026-11-04).* | Fewer false alarms from bumps, still a deterrent, and the siren can't be waited out mid-attempt. | Siren immediately / lights only / fixed 10 s siren (the earlier choice). |
| 6 | Offline card list valid **72 h**. *Confirmed.* | Rides out a long weekend outage. Trade-off: a revoked card can work up to 72 h at an offline rack. | 1 h / 24 h / 7 days. |
| 7 | **Phone hotspot**, plain HTTP behind an explicit flag. *Confirmed hotspot; HTTP flag is default.* | eduroam needs WPA2-Enterprise; VT Open needs registration. HTTPS needs certificates on a laptop. | eduroam support; HTTPS-only. |
| 8 | **Embedded Postgres** for dev/demo. *Confirmed.* | No install, no Docker on this PC. Real Postgres still works. | Install Postgres / Docker / H2 (H2 lacks JSONB, ON CONFLICT differences). |
| 9 | **Admin + read-only viewer** via env vars. *Confirmed.* | Shows role checks without a user database. | Per-person accounts in DB. |
| 10 | **Tap, then Register** enrollment, HMAC references. *Confirmed.* | Raw IDs never leave the ESP32; no typing 64-char hashes. | Typing IDs from the serial monitor. |
| 11 | **App preview** with Rider + Admin tabs, live data, no fake occupancy. *Confirmed.* | Shows the product vision honestly. | Pure mockup with fake data. |
| 12 | Logic in `lib/hbr_logic`, tested on PC with `pio test -e native`. *Default.* | Fast tests without hardware; catches wrap-around/timing bugs. | Testing only on the board. |
| 13 | Network in its own **FreeRTOS task** + mutexes. *Default.* | Fixes the 8 s freeze (KNOWNBUGS #1) properly. | Just shorten the HTTP timeout. |
| 14 | Non-blocking PN532 via the I2C **ready byte**. *Default.* | Library's read waits for a card → would freeze the loop. | Wiring the IRQ pin (extra wire). |
| 15 | Own MPU-6050 register driver (no library). *Default.* | 5 registers; good learning; one less dependency. | Adafruit MPU6050 library. |
| 16 | Revision = `max(old+1, now in ms)`. *Default.* | Monotonic even across a DB wipe → rollback protection never bricks a rack. | Simple counter from 1. |
| 17 | Plain SQL with **JdbcClient**, dropped JPA. *Default.* | `ON CONFLICT`, JSONB, and learning visibility. | Spring Data JPA. |
| 18 | Device tokens: random 256-bit, **SHA-256** stored, shown once. *Default.* | Can't be guessed; DB leak doesn't leak tokens. | bcrypt (needlessly slow per request), plaintext. |
| 19 | Frontend: **vanilla JS modules**, served by the backend, CSP on. *Default.* | Zero tooling; same origin → no CORS. | React + build step. |
| 20 | `huge_app.csv` partition. *Default.* | App was at 92% of 1.25 MB before adding NFC/servo. | `min_spiffs` (keeps OTA, smaller app). |
| 21 | Tamper ignored while unlocked and 10 s after. *Default.* | Pulling a bike out shakes the rack. | Always armed (false alarms). |
| 22 | An allowed card **silences** the alarm. *Default.* | Owner returning shouldn't stand next to a siren. | Alarm always runs until the rack is still. |
| 23 | Events tagged `simulated: true` from the simulator → **SIM** badge. *Default.* | Plan says UI must distinguish demo data from live. | Separate demo database. |
| 24 | No Claude co-author line on commits after the first three. *Confirmed by Miles.* | Miles's preference. | — |
| 25 | Staff **Mark Handled** also resolves the rack's open police incident. *Asked for by Miles, 2026-11-02.* | Before, the pin kept flashing and riders kept seeing "alarm" until someone pressed Resolved in the police view; staff had no way to end it. Lesson: the alarm on screen came from two places (unhandled TAMPER_ALARM events **and** an open incident), and only one of them was being cleared. | Only police can end it (old behavior); a separate "Resolve" button for staff. |
| 26 | Rack board is an **Arduino Uno R3**, working **offline**. *Confirmed by Miles 2026-11-10.* | Board choice. The Uno has no Wi-Fi and 2 KB RAM, so: cards enrolled at the rack into EEPROM (63 max), events to serial, no clock → no 72 h expiry. Last ESP32 code = tag `esp32-final`. | Uno R4 WiFi (keeps backend sync); staying on the ESP32. |
| 27 | Own **SHA-256/HMAC** in `hbr_logic`, checked against RFC test vectors. *Default.* | The Uno has no mbedtls; keeps card references identical to the backend's. | rweather/Crypto library; storing raw UIDs. |
| 28 | Store the **first 16 bytes** of each reference. *Default.* | 128 bits is unguessable and fits 63 cards in 1 KB EEPROM (vs 31 at 32 bytes). | Full 32-byte references. |
| 29 | **Watchdog** (4 s) on the Uno. *Default.* | The servo holds its last position if the code freezes; a reset re-locks. | No watchdog. |
| 30 | The **Rack Model** emulates the Uno; options B and C use an **Arduino Nano**. *Default, 2026-11-10.* | The model must run the firmware we actually ship. The Uno is 53 mm wide and option B's post is 52 mm inside, so the smaller builds use the Nano: same ATmega328P, same pins, same code (`pio run -e nano`). | Dropping options B and C; keeping an ESP32 model of firmware we no longer build. |
