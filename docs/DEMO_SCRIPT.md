# Demo script (light demo, Tuesday 2026-11-10)

About 8 minutes. Works with real hardware, and has a **no-hardware fallback**
using the simulator. Rehearse once the day before.

## Before the demo (15 min)
1. Phone hotspot on (2.4 GHz). Laptop joined.
2. Backend:
   ```powershell
   cd backend
   $env:ADMIN_PASSWORD="pick-one"; $env:VIEWER_PASSWORD="pick-another"
   mvn spring-boot:run "-Dspring-boot.run.profiles=embedded"
   ```
3. Browser: http://localhost:8080 → sign in as `admin`.
4. Rack powered, dashboard shows it **ONLINE**, idle blip green.
5. Have: one registered card ("Demo rider"), one unregistered card.
6. Fallback ready in a terminal: `python tools/device_simulator.py setup --admin-password <pw>` (once).

## The story
1. **The problem (30 s)**: bikes get stolen from racks; campus has no visibility.
2. **Overview page (30 s)**: racks, online devices, alerts, live refresh.
3. **Unknown card (1 min)**: tap the unregistered card → red light + two beeps.
   Dashboard: "Unknown cards tapped" → **Register** → name it, pick the rack.
   Point out: the server never sees the raw card ID, only a keyed hash.
4. **Allowed (1 min)**: type `sync` in the serial monitor (or wait ≤ 60 s), tap again →
   green + beep, lock opens for 5 s (servo or simulated), re-locks itself.
5. **Tamper (1 min)**: shake the rack once → warning chirps; again → siren 10 s.
   Dashboard: rack turns amber, events show "Tamper ALARM". Tap the allowed card → siren stops.
   **Acknowledge** on the dashboard → rack back to green.
6. **Offline (1 min)**: turn off the hotspot → tap the allowed card → still works.
   Turn it back on → events appear (no duplicates).
7. **App preview (1.5 min)**: 📱 App preview → Rider: find a rack, "My card" (pick Demo rider),
   alerts. Switch to Admin: alerts with ✓, unknown taps, revoke.
8. **Under the hood (1 min)**: Reports page, Audit log. Mention tests: 37 firmware logic
   tests, 14 backend integration tests on a real database.
9. **Honest limits (30 s)**: cloned cards, no battery clock, HTTP on the hotspot,
   servo has no position feedback (KNOWNBUGS.txt).

## No-hardware fallback
```bash
python tools/device_simulator.py demo --admin-password <pw> --pause 4
```
Narrate each printed step while the dashboard updates. Events show a **SIM** badge.
Single actions: `tap 04a1b2c3d4e5f6`, `shake`, `shake --alarm`, `online` (keeps it ONLINE).

## If something goes wrong
| Symptom | Fix |
|---|---|
| Rack OFFLINE | Same hotspot? `status` on serial. Laptop IP changed? Firewall allowed Java? |
| Card denied `NO_SNAPSHOT` / `CLOCK_NOT_SET` | Rack hasn't synced yet: wait, or `sync`. Hotspot needs internet for the clock. |
| Card denied `NOT_LISTED` after registering | Registered for the wrong rack? `sync`. |
| ESP32 resets when servo moves | Brownout: servo on separate 5 V supply, shared GND, capacitor. Or set `HBR_ENABLE_SERVO 0`. |
| Dashboard login fails | Use the password you set, or the generated one printed in the backend log. |
