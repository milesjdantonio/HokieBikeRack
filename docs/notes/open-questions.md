# Open questions / defaults to confirm

Defaults chosen while building. None are blocking. Change them if the team prefers otherwise.

Hardware is tested in person with [hardware-test-checklist.md](hardware-test-checklist.md). Since
2026-11-18 the circuit is built into the prototype; what that settled is under **Decided**.

## Decided
- A linked Hokie Passport works at **every rack** (Miles, 2026-11-02). That's how linking already works.
- Login is off for the demo; riders use a private rider code (no passwords).
- Hardware is tested in person. The website's **Testing** panel talks to the real rack over USB;
  its simulated taps and shakes are marked simulated on the dashboard.
- **Same card locks and unlocks** (2026-11-18). After 10 s unlocked: green stays on, red flashes,
  a beep every 2 s; it re-locks itself at **120 s**.
- **Servo** mounted upside down (`HBR_SERVO_REVERSED 1`), LOCKED 130 / UNLOCKED 65 in config.h
  (50° / 115° on the real servo). Plate down = locked.
- **Tamper threshold 0.30 g** (was 0.35).
- **Reader over UART** (`HBR_READER_UART 1`, D2/D3): over I2C the PN532 held the bus and took the
  accelerometer with it.
- **Cards are added in software only** (Testing panel or `enroll`); hardware buttons were tried and dropped.
- Phones can't be used as cards: they send a random ID each time.

## Hardware (check during the bench test)
| Default | Where to change | Question |
|---|---|---|
| Pins (Uno R3): SDA A4, SCL A5, servo 9, green 5, red 6, buzzer 7, PN532 UART D2/D3 (or IRQ 2 / reset 3 on I2C) | `firmware/include/pins.h` | Used on the prototype. (Keeps 0/1 for USB serial and 13 free.) |
| Servo angles: decided (see above) | `config.h` `HBR_SERVO_*_DEG` | The servo holds against the spring the whole time it's locked, so a power cut lets the plate up (fail-open). OK for the demo? |
| Re-locks by itself after 120 s, reminder from 10 s | `device_config.h` `HBR_UNLOCK_DURATION_MS`, `HBR_UNLOCK_REMINDER_MS` | Decided 2026-11-18. |
| Tamper threshold 0.30 g, 3 samples | `include/device_config.h` (`HBR_TAMPER_THRESHOLD_G`) | Decided 2026-11-18 in the prototype. Recheck with `accel` if it's mounted differently. |
| Escalation window 30 s, cooldown 3 s | same file | Feels right? |
| Grace period after locking 10 s | `HBR_TAMPER_GRACE_MS` | Long enough to remove a bike? (Counted from when it actually locks.) |
| Card type | — | What do the kit cards report? (4-byte = MIFARE Classic, 7-byte = NTAG/Ultralight usually.) Log shows `[card] read a N-byte card ID`. |
| Hokie Passport | — | Does the PN532 read a HokieP, with the **same** ID every tap? (Checklist 7.) If not, use kit cards for the demo. |
| PN532 power 5 V | wiring guide | The Uno is a 5 V board; the PN532 V3 and GY-521 have their own 3.3 V regulators. |

## Product / policy
- **72 h offline** confirmed. Should *expired* (`validUntil`) cards also be capped to the snapshot? Today a card whose end date passes while a rack is offline keeps working until the snapshot expires.
- Should the rack show a different light when it's running on an *old* list (offline > 1 h)? Today: idle blip is green when ready, red when not ready.
- Should acknowledging alerts require a note ("checked, it was a delivery truck")?
- Do we want per-person admin accounts before any wider demo?
- Should the dashboard hide SIM events by default once real hardware is in use?

## Feature ideas not built yet (from the Phase 9 UX pass)
- ~~Rider accounts~~ Built 2026-11-02: riders, online access requests, link your HokieP, "your bike" warnings.
- **Report a Problem** on a rack (broken, blocked, missing) that lands in the staff Alerts.
- **Favourite racks** at the top of the list; alerts only for those.
- **Push notifications** for staff when a tamper alarm fires (needs HTTPS + a service worker).
- **Busy times** per rack from unlock history ("usually busy 9-11 am").
- **Bulk card import** (CSV) for a whole class or club.
- **Rack photos** so riders recognise the spot.

## Security (before anything beyond a supervised demo)
- A **sign-in screen** before sharing a hosted link: login is off, so anyone with the link is admin
  ([hosting-render.md](hosting-render.md)).
- HTTPS (Render gives the website and API HTTPS; a Wi-Fi rack would need `HBR_API_ROOT_CA`).
- Turn off `HBR_ENABLE_SERIAL_SIM` and `HBR_ALLOW_INSECURE_HTTP`.
- Cards with real cryptography (DESFire) if clone resistance matters.
- Login rate limiting.
