# HokieBikeRack — full build plan and progress tracker

**Read this first if you are resuming work (human or Claude).**
This file is the single source of truth for "what's done / what's next".
Every step ends with: tick the box here → commit → `git push`. If a session
runs out of usage mid-step, the next session starts at the first unticked box.

- Branch: `feature/full-stack-demo` (open a PR into `main` on GitHub when ready)
- Light demo due: **Tuesday 2026-11-10**
- Started: 2026-11-02
- Commits: do NOT add a "Co-Authored-By: Claude" line (Miles asked, 2026-11-02)

## How to resume (copy/paste for a new Claude session)
> Read `docs/BUILD_PLAN.md` and continue from the first unchecked step on branch
> `feature/full-stack-demo`. Follow the decisions listed there. After each step,
> tick it, commit, and push.

Useful commands (Windows, from repo root):
- Firmware build: `~/.platformio/penv/Scripts/pio.exe run -d firmware`
- Firmware PC tests: `~/.platformio/penv/Scripts/pio.exe test -d firmware -e native`
- Backend tests: `cd backend && mvn -q test`
- Backend run (embedded DB): `cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=embedded`

---

## Decisions (confirmed by Miles on 2026-11-02)

| Topic | Decision |
|---|---|
| Board | Generic ESP32 dev board (`esp32dev`), Arduino core 3.3 |
| NFC | PN532 over **I2C** (shares bus with accelerometer) |
| Accelerometer | **MPU-6050 (GY-521)**, I2C 0x68 |
| Servo | MG90S on a **separate 5 V supply**, grounds tied. Real driver written but **off by default** (`HBR_ENABLE_SERVO 0`) until bench test |
| Lock mode | **Momentary**: allowed card → unlock 5 s → auto re-lock |
| Lights | Separate **red + green LEDs** with 220–330 Ω resistors |
| Sound | **Active buzzer** (on/off only), switched by an NPN transistor |
| Tamper response | 1st detection → **warning** (red blinks + quick chirps). Continues within the escalation window → **alarm** (flash red + siren **10 s**). Never moves the lock. |
| Offline policy | Saved card list valid **72 h** after it was issued; after that every card is denied (fail-secure) |
| Demo Wi-Fi | **Phone hotspot** (WPA2-Personal). Plain HTTP allowed only with an explicit opt-in flag for the local demo |
| Database | PostgreSQL. Dev/demo uses **embedded Postgres** profile (no install). Real Postgres still supported |
| Admin login | **ADMIN** (can change things) + **VIEWER** (read-only), set via env vars |
| Card enrollment | Tap unknown card → dashboard shows "unknown card" → admin clicks **Register**. Raw UID never leaves the ESP32; only an HMAC-SHA256 "credential reference" |
| Dashboard | Opened on the laptop (`http://localhost:8080`), served by the backend |
| App preview | Button opens a **phone-style app view** with **Rider** and **Admin** tabs, **live data**, no fake bike occupancy |

Defaults I chose (change freely — listed in `docs/notes/open-questions.md`):
pins (SDA 21, SCL 22, servo 13, green LED 25, red LED 26, buzzer 27), servo
angles (locked 0°, unlocked 90°), unlock 5 s, tamper threshold 0.35 g.

---

## Steps

### Phase 0 — setup
- [x] 0.1 Create branch `feature/full-stack-demo` and push
- [x] 0.2 Confirm existing firmware builds (it did, flash was 92% full)
- [x] 0.3 Switch to `huge_app.csv` partition, add PN532 + ESP32Servo libs, add `native` test env
- [x] 0.4 Write this plan file and push

### Phase 1 — firmware logic (pure C++, tested on the PC) — `firmware/lib/hbr_logic/`
- [x] 1.1 `access_rules`: snapshot struct, allow/deny decision with reasons (no snapshot / expired / clock unknown / not listed), rollback protection, snapshot JSON parsing
- [x] 1.2 `tamper_detector`: baseline (slow average), deviation threshold, consecutive-sample filter, warning → alarm escalation, cooldowns
- [x] 1.3 `feedback_player`: non-blocking LED/buzzer patterns with priorities (boot, granted, denied, tamper warning, tamper alarm, not-ready blip)
- [x] 1.4 `lock_controller`: momentary unlock timer (millis wrap-safe)
- [x] 1.5 `util`: UUID v4 formatting, ISO-8601 UTC formatting, hex encoding, card debounce
- [x] 1.6 Unity tests in `firmware/test/` — all pass with `pio test -e native`

### Phase 2 — firmware hardware glue — `firmware/src/`
- [x] 2.1 `pins.h` pin map + `config.example.h` (new flags: servo enable, allow HTTP, card key, angles)
- [x] 2.2 `card_reader.cpp`: PN532 over I2C (Adafruit lib), short timeouts, detect missing reader
- [x] 2.3 `credential_ref.cpp`: HMAC-SHA256(card key, UID) via mbedtls → hex reference
- [x] 2.4 `tamper_sensor.cpp`: MPU-6050 raw register driver (wake, ±4 g, read 6 bytes)
- [x] 2.5 `lock.cpp`: ESP32Servo output behind `HBR_ENABLE_SERVO`, else simulated prints
- [x] 2.6 `feedback.cpp`: drive LEDs + buzzer from `feedback_player`
- [x] 2.7 `event_queue.cpp`: FreeRTOS mutex, UUID ids, size cap
- [x] 2.8 `auth_store.cpp`: current snapshot in RAM + `/snapshot.json` on LittleFS, mutex
- [x] 2.9 `backend_sync.cpp`: **separate FreeRTOS task** (fixes KNOWNBUGS #1), Wi-Fi, NTP, snapshot fetch, heartbeat, event upload, HTTPS or opt-in HTTP
- [x] 2.10 `main.cpp`: wire it all together; events: DEVICE_BOOT, ACCESS_GRANTED, ACCESS_DENIED, TAMPER_WARNING, TAMPER_ALARM, SENSOR_FAULT
- [x] 2.11 Build passes for servo OFF and servo ON configs; update KNOWNBUGS.txt

### Phase 3 — backend (Java 21 / Spring Boot) — `backend/`
- [x] 3.1 pom: security, embedded Postgres (zonky) for tests + `embedded` profile
- [x] 3.2 Flyway `V2`: device token hash, event credential ref/time source, authorization revision counter, audit log, unique indexes
- [x] 3.3 Domain + repositories (racks, devices, credentials, permissions, events, audit)
- [x] 3.4 Security: device bearer-token filter for `/api/v1/devices/**`; HTTP Basic ADMIN/VIEWER for admin API; JSON 401/403 (no browser popup)
- [x] 3.5 Device API: events (idempotent `ON CONFLICT DO NOTHING`), authorization-snapshot, heartbeat
- [x] 3.6 Admin API: racks, device provisioning/token rotation, credentials (+ register from unknown card, revoke, rack permissions), events (filters + paging), reports, audit log, `/me`
- [x] 3.7 Validation + error handling (ProblemDetail)
- [x] 3.8 Serve `frontend/` from the backend at `/`
- [x] 3.9 Integration tests (auth, idempotency, snapshot, roles, validation) — `mvn test` green

### Phase 4 — frontend — `frontend/`
- [x] 4.1 Login screen, API client, loading/error/empty states
- [x] 4.2 Overview (metrics, rack health, recent events, auto refresh)
- [x] 4.3 Events page with filters; unknown-card → Register flow
- [x] 4.4 Racks page: create rack, provision device (token shown once + config.h snippet)
- [x] 4.5 Credentials page: list, edit, rack permissions, revoke
- [x] 4.6 Reports + audit log
- [x] 4.7 Viewer role: hide/disable edit actions (backend still enforces)
- [x] 4.8 **App preview** (phone frame) with Rider + Admin tabs, live data

### Phase 5 — simulator + end-to-end check
- [x] 5.1 `tools/device_simulator.py`: acts like an ESP32 (heartbeat, snapshot, card taps, tamper) using the same HMAC + API
- [x] 5.2 Run backend (embedded) + simulator + browser check of the dashboard; fix bugs

### Phase 6 — notes and docs
- [x] 6.1 `docs/notes/` learning notes: overview (card tap end-to-end), firmware, backend, frontend, decisions, open questions
- [x] 6.2 `docs/notes/hardware-test-checklist.md` + wiring guide for tomorrow's bench test
- [x] 6.3 Update README, API.md (real contract), HARDWARE_DECISIONS, PROJECT_STATUS, SECURITY, component READMEs
- [x] 6.4 Demo script for Tuesday (`docs/DEMO_SCRIPT.md`)
- [x] 6.5 Final push; summarize for Miles

### Phase 7 — frontend polish (Miles suggested borrowing from SchmollCrossword + TerraSim)
Reference patterns: TerraSim `website/js/rive.js` + vendored Rive runtime + `.riv` files built by scripts in `website/tools/rive/`; SchmollCrossword `static/css/app.css` (everything driven by CSS variables), in-page dialogs, canvas FX.
- [x] 7.1 Look at TerraSim's Rive setup (runtime loading, CSP needs: wasm) and decide what fits
- [x] 7.2 Animated status icons (lock open/close, alarm pulse, online heartbeat) — Rive if practical, CSS/SVG fallback
- [x] 7.3 Polish pass: motion on state changes, empty states, app-preview feel; respect prefers-reduced-motion
- [x] 7.4 Re-run the headless Edge check (admin + viewer), commit, push

### Phase 8 — terminal admin + customer app + better Rive (Miles, 2026-11-02)
Miles's feedback: current UI "feels very AI generated where TerraSim is built to avoid all of that" → follow docs/notes/design.md anti-template rules strictly. Third reference: Rythm Architect (local, C:/Users/miles/Downloads/ProjectFrontEnd, port 5173).
Decisions: admin page = ONE black page that looks like a terminal (monospace, everything stacked, clickable [buttons], NO typed commands, "not fancy"). Customer (rider) app = its own page at `/app` AND openable from the terminal in a phone frame; follows the design principles of SchmollCrossword + TerraSim. More professional Rive animations.
- [x] 8.1 Read design principles in TerraSim (AGENT.md, .impeccable, direction) and SchmollCrossword (CLAUDE.md, css) → write them down in docs/notes/design.md
- [x] 8.2 Terminal admin: rewrite index.html + styles + views into one stacked page (status, racks, unknown cards, events, cards, reports, audit), terminal-style dialogs
- [x] 8.3 Customer app at frontend/app/ (phone-first, Rider-focused), terminal opens it in a phone frame
- [x] 8.4 Rive: rack.riv centrepiece (idle/granted/denied/alarm/offline, every property posed in every state), logo.riv, refine pulse; rebuild; lab page
- [x] 8.6 Rack map (Miles: "racks could be visualized, TerraSim APIs"): Flyway V3 lat/lng, MapLibre + OpenFreeMap 3D buildings + Esri imagery, still markers
- [x] 8.5 Headless checks (terminal as admin + viewer, /app, lab), docs, commit, push

### Phase 9: click to place, bug sweep, tutorial, UX (Miles, 2026-11-02)
Miles: "can the user click for where the bike rack is, similar to how it's done in TerraSim";
"go through again and find any bugs and add any new features you can think about";
"maybe also add a tutorial because I was confused when doing the old UI"; "focus heavily on UX".
- [x] 9.1 Click-to-place racks (staff app): click map, drag pin, Enter/Escape, live hint, Photon place search (TerraSim's), Add Rack, Move/Take Off Map; terminal [place on map]
- [x] 9.2 Tutorial: first-visit guided tour for each app (rider, staff) + the terminal; replayable from Settings / `[help]`
- [x] 9.3 UX pass: empty states that say what to do next, error recovery, loading states, keyboard, one accent per screen, phone widths
- [x] 9.4 Bug sweep: read every page's code + headless run of every flow; fix what's found (list them in the log)
- [x] 9.5 New features (UX-led): ideas listed in docs/notes/open-questions.md, build the best ones
- [x] 9.6 Checks (backend tests, headless phone/desktop/admin/viewer), docs, commit, push

## Progress log
- 2026-11-02: Phase 0 done. Questions answered (see Decisions).
- 2026-11-02: Phase 1 done. 37 PC unit tests pass (`pio test -e native`).
- 2026-11-02: Phase 2 done. Firmware builds with servo OFF and ON (`PLATFORMIO_BUILD_FLAGS=-DHBR_ENABLE_SERVO=1`). Not yet run on hardware.
- 2026-11-02: Phase 3 done. Backend uses plain SQL (JdbcClient) instead of JPA. 14 integration tests pass on embedded Postgres 17 (`mvn test`).
- 2026-11-02: Phase 4 written (vanilla JS modules, no build). Browser check happens in 5.2.
- 2026-11-02: Phase 5 done. Backend (embedded) + simulator demo + headless-Edge check of every page as admin and viewer: no console errors. Fixed: blank app preview, unreadable Sign out, table action column, favicon 404.
- 2026-11-02: Phase 9 done. Click-to-place + Add Rack + place search (TerraSim style); tours for both apps + terminal $ help; Find Nearest, directions, connection banner, clearer sign-in, rack-not-found, recent activity, mark all handled, card search. 7 bugs fixed (listed in docs/notes/frontend.md). 15 backend tests; headless flow check, no errors.
- 2026-11-02: Phase 8 done. All four pages remade: terminal admin (/), rider app (/app), staff app (/app?mode=staff), sign-in for both. Campus map. Pulses removed (Miles). 15 backend tests; headless checks at phone + desktop, admin + viewer, no console errors.
- 2026-11-02: Phase 7 done. Rive icons (lock, alarm, pulse) generated from code with TerraSim's writer; vendored runtime; CSP adds 'wasm-unsafe-eval'; login unlock animation; subtle motion with reduced-motion support. Lab page /lab/rive.html. Headless checks: no console errors.
- 2026-11-02: Phase 6 docs done (notes, wiring, checklist, demo script, updated READMEs/API/status/security). Added serial `i2c-scan` + `accel`. Phase 7 added at Miles's suggestion.
