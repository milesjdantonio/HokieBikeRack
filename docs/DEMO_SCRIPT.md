# Demo script (light demo, Tuesday 2026-11-10)

About 8 minutes. Works with real hardware, and has a **no-hardware fallback**
using the simulator. Rehearse once the day before.

## Before the demo (15 min)
1. Phone hotspot on (2.4 GHz). Laptop joined.
2. Backend:
   ```powershell
   cd backend
   mvn spring-boot:run "-Dspring-boot.run.profiles=embedded"
   ```
   No usernames or passwords in the demo (login is off; `HBR_LOGIN_REQUIRED=true` turns it back on).
3. Browser tab 1: http://localhost:8080 (admin terminal), no sign-in.
   Tab 2: http://localhost:8080/app (rider app). The rack should have map coordinates
   (terminal → `$ racks` → `[details]` → `[edit]` → `map lat, lng`).
4. Rack powered, terminal shows it **online**, idle blip green.
5. Have: one registered card ("Demo rider"), one unregistered card.
6. Fallback ready in a terminal: `python tools/device_simulator.py setup` (once).

## The story
1. **The problem (30 s)**: bikes get stolen from racks; campus has no visibility.
2. **Rider app (1 min)**: the campus map with every rack, tap one → the rack scene. Press
   **Try a Tap**: the card slides to the reader, green light, beep, the bolt pulls back.
3. **Unknown card (1 min)**: tap the unregistered card → red light + two beeps.
   Staff app (`/app?mode=staff` → Cards) or terminal (`$ cards --unknown`) → **Register** → name it, pick the rack.
   Point out: the server never sees the raw card ID, only a keyed hash.
4. **Allowed (1 min)**: type `sync` in the serial monitor (or wait ≤ 60 s), tap again →
   green + beep, lock opens for 5 s (servo or simulated), re-locks itself.
5. **Tamper (1 min)**: shake the rack once → warning chirps; again → siren 10 s.
   Rider app: the rack's scene shows the alarm; staff app Alerts lists it. Tap the allowed card → siren stops.
   **Handled** in the staff app (or `[ack]` in the terminal) → rack back to Ready.
6. **Offline (1 min)**: turn off the hotspot → tap the allowed card → still works.
   Turn it back on → events appear (no duplicates).
7. **My Card (30 s)**: pick Demo rider: the card, where it works, its recent taps.
8. **Under the hood (1 min)**: the admin terminal: `$ report`, `$ audit`. Mention tests: 37 firmware
   logic tests, 15 backend integration tests on a real database.
9. **Honest limits (30 s)**: cloned cards, no battery clock, HTTP on the hotspot,
   servo has no position feedback (KNOWNBUGS.txt).

## No-hardware fallback
```bash
python tools/device_simulator.py demo --pause 4
```
Narrate each printed step while the app and terminal update. Simulated events are marked `sim`.
Single actions: `tap 04a1b2c3d4e5f6`, `shake`, `shake --alarm`, `online` (keeps it ONLINE).

## If something goes wrong
| Symptom | Fix |
|---|---|
| Rack OFFLINE | Same hotspot? `status` on serial. Laptop IP changed? Firewall allowed Java? |
| Card denied `NO_SNAPSHOT` / `CLOCK_NOT_SET` | Rack hasn't synced yet: wait, or `sync`. Hotspot needs internet for the clock. |
| Card denied `NOT_LISTED` after registering | Registered for the wrong rack? `sync`. |
| ESP32 resets when servo moves | Brownout: servo on separate 5 V supply, shared GND, capacitor. Or set `HBR_ENABLE_SERVO 0`. |
| A sign-in screen appears | Login was turned on (`HBR_LOGIN_REQUIRED=true`). Unset it and restart, or use the password from the backend log. |
| Rack shows "Back, Not Confirmed" | It was offline and reconnected. Check it, then Confirm Online. |
