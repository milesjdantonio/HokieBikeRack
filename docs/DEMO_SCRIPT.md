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
3. Tabs (no sign-in): http://localhost:8080/admin/ , /rider/ , /police/ (and /staff/ if time).
   The rack must be on the map: admin → click it → Move on Map (or `move <rack>`).
4. Rack powered, admin shows it **online**, idle blip green. If it says "Back, Not Confirmed",
   check it and press Confirm Online.
5. Have: one registered card ("Demo rider"), one unregistered card.
6. Fallback ready in a terminal: `python tools/device_simulator.py setup` (once).

## The story
1. **The problem (30 s)**: bikes get stolen from racks; campus has no visibility.
2. **Rider (1 min)**: every rack shows **open spots** and its **alarm** (active now / last alarm).
   Find Nearest, open a rack: the live scene and How It Works.
3. **Unknown card (1 min)**: tap the unregistered card → red light + two beeps. Admin: Needs You →
   Cards to Register → name it → **Register** (or `register <rack> <name>`).
   Point out: the server never sees the raw card ID, only a keyed hash.
4. **Allowed (1 min)**: type `sync` in the serial monitor (or wait ≤ 60 s), tap again →
   green + beep, lock opens for 5 s (servo or simulated), re-locks itself.
5. **Tamper (1.5 min)**: shake the rack once → warning chirps, the amber **Shake Detected** panel drops
   in on the admin map; shake again → siren, the panel turns red. **Alert Authorities** → Alert Now:
   the pin flashes red and blue. Police tab: the incident with its timeline → **On My Way** → On Scene →
   Resolved. Rider: "Alarm now". Admin: **Mark Handled** → rack back to Ready.
6. **Offline (1 min)**: turn off the hotspot → tap the allowed card → still works.
   Turn it back on → events appear (no duplicates).
7. **Spots (30 s)**: tap in and the rack's open spots go down; tap out and they come back.
8. **Under the hood (1 min)**: admin Reports and Audit Log; the terminal (`help`, Commands page).
   Mention tests: 37 firmware logic tests, 19 backend tests on a real database.
9. **Honest limits (30 s)**: cloned cards, no battery clock, HTTP on the hotspot,
   servo has no position feedback (KNOWNBUGS.txt).

## No-hardware fallback
```bash
python tools/device_simulator.py demo --pause 4
```
Narrate each printed step while the admin, rider and police pages update. Simulated events are marked `simulated`.
Single actions: `tap 04a1b2c3d4e5f6`, `shake`, `shake --alarm`, `online` (keeps it ONLINE).

## If something goes wrong
| Symptom | Fix |
|---|---|
| Rack OFFLINE | Same hotspot? `status` on serial. Laptop IP changed? Firewall allowed Java? |
| Card denied `NO_SNAPSHOT` / `CLOCK_NOT_SET` | Rack hasn't synced yet: wait, or `sync`. Hotspot needs internet for the clock. |
| Card denied `NOT_LISTED` after registering | Registered for the wrong rack? `sync`. |
| Uno restarts when servo moves | Brownout: servo on separate 5 V supply, shared GND, capacitor. Or set `HBR_ENABLE_SERVO 0`. |
| A sign-in screen appears | Login was turned on (`HBR_LOGIN_REQUIRED=true`). Unset it and restart, or use the password from the backend log. |
| Rack shows "Back, Not Confirmed" | It was offline and reconnected. Check it, then Confirm Online. |
