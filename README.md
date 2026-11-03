# HokieBikeRack

Smart bike-rack access and tamper monitoring: an ESP32 rack that reads NFC
cards, unlocks a servo latch for allowed riders, sounds an alarm when shaken,
and reports everything to a Spring Boot backend with a live admin dashboard.

**Status (Nov 2026):** full end-to-end prototype for a supervised local demo.
Software is complete and tested (37 firmware logic tests, 14 backend
integration tests, browser-checked dashboard). The hardware has **not** been bench-tested yet;
see [docs/notes/hardware-test-checklist.md](docs/notes/hardware-test-checklist.md).
The servo output is **off by default** until that test. Not a security-certified lock.

## Quick start (no hardware needed)
```bash
# 1. Backend + database + dashboard (needs JDK 21+ and Maven; Postgres is downloaded for you)
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=embedded
# 2. Open http://localhost:8080 (admin terminal) or http://localhost:8080/app (rider app).
#    No login in the demo. For admin/viewer logins: HBR_LOGIN_REQUIRED=true ADMIN_PASSWORD=... VIEWER_PASSWORD=...
# 3. In another terminal, pretend to be a rack:
python tools/device_simulator.py setup
python tools/device_simulator.py demo
```

## With the real rack
1. Wire it: [docs/notes/wiring-guide.md](docs/notes/wiring-guide.md)
2. `firmware/include/config.example.h` → `config.h` (Wi-Fi, device ID/token from the dashboard, card key)
3. `cd firmware && pio run -t upload && pio device monitor`
4. Follow [docs/notes/hardware-test-checklist.md](docs/notes/hardware-test-checklist.md)

## Stack
| Part | Tech |
|---|---|
| Rack | ESP32 DevKit, Arduino core 3 / PlatformIO, PN532 NFC (I2C), MPU-6050 accelerometer (I2C), MG90S servo, red/green LEDs, active buzzer |
| Backend | Java 21, Spring Boot 3.5, Spring Security, JdbcClient (plain SQL), Flyway |
| Database | PostgreSQL 17 (embedded for dev/demo, or your own) |
| Admin terminal | One black monospace page at `/`, HTML/CSS/JS modules, no build step |
| Customer app | Rider app at `/app`, staff app at `/app?mode=staff`; Rive animations, MapLibre 3D campus map (OpenFreeMap + Esri imagery) |
| Simulator | Python 3 standard library |

## Repository map
- `firmware/`: ESP32 code. `lib/hbr_logic` = PC-tested logic, `src/` = hardware glue. [README](firmware/README.md)
- `backend/`: REST API, security, migrations, tests. [README](backend/README.md)
- `frontend/`: admin terminal (`/`), customer app (`/app`), Rive lab (`/lab`). [README](frontend/README.md)
- `tools/device_simulator.py`: fake rack for demos/tests
- `docs/notes/`: **learning notes**: start with [overview.md](docs/notes/overview.md); design rules in [design.md](docs/notes/design.md)
- `docs/BUILD_PLAN.md`: what was built, in order, with the progress log
- `docs/API.md`: the REST contract · `docs/ARCHITECTURE.md` · `docs/SECURITY.md`
- `docs/HARDWARE_DECISIONS.md` · `docs/PROJECT_STATUS.md` · `docs/DEMO_SCRIPT.md`
- `firmware/KNOWNBUGS.txt`: known limitations
- `CONTRIBUTING.md`: team workflow

## Key safety and security points
- The rack decides locally from a card list that's valid for **72 h**; after that, or with an unknown clock, it **denies everyone** (fail-secure).
- Raw card IDs never leave the ESP32; only an HMAC "credential reference" does. Cloned cards are **not** stopped (UID-based cards).
- Tamper events never move the lock.
- Never power the servo from an ESP32 pin; use a separate 5 V supply with a shared ground.
- Never commit `firmware/include/config.h`, `.env` files, or device tokens.
