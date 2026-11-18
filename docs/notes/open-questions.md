# Open questions / defaults to confirm

Defaults chosen while building. None are blocking. Change them if the team prefers otherwise.

**All real-life (hardware) testing is on Tuesday 2026-11-03**, in person, using
[hardware-test-checklist.md](hardware-test-checklist.md) sections 1-7 (7 = rider sign-up with a real
Hokie Passport). Questions marked "check during the bench test" get answered then.

## Decided
- A linked Hokie Passport works at **every rack** (Miles, 2026-11-02). That's how linking already works.
- Login is off for the demo; riders use a private rider code (no passwords).
- Hardware is tested in person; the website has no buttons that fake hardware.

## Hardware (check during the bench test)
| Default | Where to change | Question |
|---|---|---|
| Pins (Uno R3): SDA A4, SCL A5, servo 9, green 5, red 6, buzzer 7, PN532 IRQ 2 / reset 3 | `firmware/include/pins.h` | OK for your exact board? (Keeps 0/1 for USB serial and 13 free.) |
| Servo angles: locked 60° (plate pushed down), unlocked 10° (spring lifts the plate) | `config.h` `HBR_SERVO_*_DEG` | Find the real ones with `servo <deg>`: unlocked = plate fully up, horn just touching the ledge; locked = plate far enough down to hold the bike, no buzzing. The servo holds against the spring the whole time it's locked, and a power cut lets the plate up (fail-open). |
| Unlock time 5 s | `device_config.h` `HBR_UNLOCK_DURATION_MS` | Long enough to pull a bike/lock free? |
| Tamper threshold 0.35 g, 3 samples | `lib/hbr_logic/src/tamper_detector.h` | Too sensitive / not enough once mounted? Use `accel` to measure. |
| Escalation window 30 s, cooldown 3 s | same file | Feels right? |
| Grace period after unlock 10 s | `HBR_TAMPER_GRACE_MS` | Long enough to remove a bike? |
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
- HTTPS (needs a certificate + `HBR_API_ROOT_CA` on the racks).
- Turn off `HBR_ENABLE_SERIAL_SIM` and `HBR_ALLOW_INSECURE_HTTP`.
- Cards with real cryptography (DESFire) if clone resistance matters.
- Login rate limiting.
