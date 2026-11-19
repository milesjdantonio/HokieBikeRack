# Overview: how the whole system fits together

> **2026-11-10: the rack is now an Arduino Uno R3, working offline.** The Uno
> has no Wi-Fi, so the real rack no longer talks to the backend. "Journey 0"
> below is how the Uno rack works today. Everything after it describes the
> networked design (ESP32, git tag `esp32-final`), which the backend, the
> dashboard and `tools/device_simulator.py` still implement.

## Journey 0: the Uno rack (offline)

```
 ┌──────────── RACK (Arduino Uno R3) ───────────┐
 │ PN532 ──I2C──┐                                │   USB serial    ┌──── LAPTOP ─────────┐
 │ MPU-6050 ─I2C┤ loop(): cards, tamper, lock,  │◀──────────────▶│ serial monitor:     │
 │ LEDs, buzzer ┤        lights                 │ (115200 baud)   │ enroll, list, logs  │
 │ MG90S servo ─┘                               │                 └─────────────────────┘
 │ EEPROM: up to 63 allowed card references     │
 └───────────────────────────────────────────────┘
```

| # | What happens | Code |
|---|---|---|
| 1 | Admin types `enroll` in the serial monitor and taps the rider's card. Its reference (HMAC, first 16 bytes) is saved in EEPROM. | `main.cpp`, `card_list.cpp` |
| 2 | Rider taps. The loop reads the ID over I2C without waiting, debounces it, and turns it into the reference. | `card_reader.cpp`, `credential_ref.cpp` |
| 3 | Reference in the EEPROM list → unlock, green + beep; the same card again locks it (or after 120 s).  Not listed → red + two beeps. | `card_store.cpp`, `lock.cpp` |
| 4 | Every event is printed as `[event] t+12s ACCESS_GRANTED (INFO) card=cb9df64f5164...`. | `main.cpp` |
| 5 | Shaking works exactly like Journey 2 below. | `tamper_detector.cpp` |
| 6 | To take access away: `unenroll` + tap, or `list` + `remove <n>`. | `main.cpp` |

---

## The networked design (ESP32 version, tag `esp32-final`)

```
 ┌──────────── RACK (ESP32) ─────────────┐          ┌──── LAPTOP ────────────────────┐
 │ PN532 ──I2C──┐                         │  Wi-Fi   │ Spring Boot API  ── PostgreSQL │
 │ MPU-6050 ─I2C┤ loop() on core 1        │ (phone   │   /api/v1/devices/...  (token) │
 │ LEDs, buzzer ┤   cards, tamper, lock,  │ hotspot) │   /api/v1/racks ...  (login)   │
 │ MG90S servo ─┘   lights               │◀────────▶│ serves the dashboard at  /     │
 │               network task on core 0   │  HTTP(S) │                                │
 │ LittleFS: events.jsonl, snapshot.json  │          │ Browser: dashboard + app preview│
 └────────────────────────────────────────┘          └────────────────────────────────┘
```

Three rules shape everything:
1. **The rack decides locally.** It never asks the server "may this card in?"
   at tap time, so a slow or dead network can't stop riders (for up to 72 h).
2. **When unsure, stay locked (fail-secure).** No card list, list expired, clock
   unknown, missing key: deny.
3. **Never move raw card IDs around.** The rack turns them into an HMAC
   "credential reference" immediately; only that leaves the ESP32.

---

## Journey 1: a rider taps a card

| # | Where | What happens | Code |
|---|---|---|---|
| 1 | PN532 | We asked it earlier to "wait for a card". When one arrives, it sets its I2C status byte to `0x01`. | `card_reader.cpp` |
| 2 | ESP32 loop | Every 50 ms we read that one byte. Ready → read the card's ID (4 or 7 bytes). No waiting, no freezing. | `cardReaderPoll()` |
| 3 | ESP32 | ID → `HMAC-SHA256(card key, "hbr-card-v1:" + hex ID)` = 64-char reference. Raw ID is forgotten. | `credential_ref.cpp` |
| 4 | ESP32 | Same card still on the reader? Ignore it (debounce, 2 s). | `CardDebouncer` |
| 5 | ESP32 | Decide using the saved card list ("snapshot"): have one? clock set? not expired? reference listed? | `access_rules.cpp` `decideAccess()` |
| 6a | Allowed | Servo to unlocked angle (or a serial message if simulated), green LED + short beep, start 5 s timer. Also silences a tamper alarm. | `lock.cpp`, `feedback_player.cpp` |
| 6b | Denied | Red LED + two beeps. Reason recorded: `NOT_LISTED`, `SNAPSHOT_EXPIRED`, … | |
| 7 | ESP32 | Event saved to flash (`/events.jsonl`) with a fresh UUID, then the network task is nudged. | `event_queue.cpp` |
| 8 | Network task | `POST /api/v1/devices/{id}/events` with `Authorization: Bearer <device token>`. Success → delete from flash. Failure → keep, retry later (2, 4, 8 … 60 s). | `backend_sync.cpp` |
| 9 | Backend | `DeviceTokenFilter` checks the token belongs to the device in the URL. | `DeviceTokenFilter.java` |
| 10 | Backend | `INSERT … ON CONFLICT (id) DO NOTHING`, so a retry can never create a duplicate. | `EventService.ingest()` |
| 11 | Dashboard | Refreshes every 10 s. A denied *unknown* card shows a **Register** button. | `overview.js`, `events.js` |
| 12 | Admin clicks Register | `POST /api/v1/credentials` → stored, **authorization revision bumped**, audit log row written. | `CredentialService.create()` |
| 13 | Network task (≤ 60 s later) | `GET …/authorization-snapshot` → new list with higher revision → saved to RAM + flash. | `fetchSnapshot()` |
| 14 | Next tap | Allowed. | |
| 15 | 5 s later | Lock timer runs out → back to locked. | `LockController::update()` |

## Journey 2: someone shakes the rack

1. Every 20 ms the loop reads the MPU-6050 (x, y, z in g).
2. `TamperDetector` keeps a slowly-moving **baseline** (normal reading, roughly gravity).
3. Distance from baseline above **0.30 g** for **3 samples in a row** = a jolt.
4. First jolt → **WARNING**: red blinks + 3 quick chirps, `TAMPER_WARNING` (MEDIUM) event.
5. Another jolt within **30 s** (after a 3 s cooldown) → **ALARM**: flashing red + siren for **at least 10 s, until the rack has been still for 5 s**, `TAMPER_ALARM` (HIGH) event.
6. Dashboard: rack turns **WARNING** (amber) until an admin clicks *Acknowledge*.
7. Riders using the rack legitimately don't trigger it: tamper is ignored while unlocked and for 10 s after.
8. **The lock never moves because of tamper.** An allowed card tap silences the alarm.

## Journey 3: Wi-Fi dies

- Cards keep working from the saved list, which is good for 72 h after it was last downloaded.
- Events pile up in flash (up to ~400 KB; above 256 KB only MEDIUM+ are kept).
- When Wi-Fi returns, the network task reconnects, re-downloads the list, uploads the backlog.
- If the rack is **power-cycled while offline**, its clock is unknown (no battery clock),
  so it can't check expiry → denies everyone until Wi-Fi + NTP are back. (KNOWNBUGS #3)

## Glossary
- **Snapshot / card list**: what the backend sends a rack: revision, issue time, expiry, list of references.
- **Revision**: a number that only goes up when access changes. Racks reject lower ones (rollback protection).
- **Credential reference**: HMAC of a card ID. 64 hex chars. What the database stores.
- **Device token**: random secret per ESP32, like a password for the device. Server stores only its SHA-256.
- **Idempotent**: doing it twice has the same effect as once.
- **Fail-secure**: on failure, stay locked (vs. fail-safe/fail-open: on failure, unlock).
- **Heartbeat**: "I'm alive" message every 60 s with health numbers.
- **SIM badge**: events from `tools/device_simulator.py`, not real hardware.
