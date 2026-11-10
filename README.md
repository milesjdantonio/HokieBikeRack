# HokieBikeRack

Smart bike-rack access and tamper monitoring: an Arduino Uno R3 rack that reads NFC
cards, unlocks a servo latch for allowed riders and sounds an alarm when shaken,
plus a Spring Boot backend with a live admin dashboard.

**Hardware change (2026-11-10):** the rack moved from an ESP32 to an **Arduino Uno R3**.
The Uno has no Wi-Fi, so the rack now works **on its own**: cards are enrolled at
the rack (saved in EEPROM) and events go to the serial monitor. The backend,
dashboard and simulator still work together as before, but the real rack no
longer reports to them. The last ESP32 firmware is the git tag `esp32-final`.

**Status (Nov 2026):** full end-to-end prototype for a supervised local demo.
Software is complete and tested (43 firmware logic tests, 53 firmware-model checks, 22 backend
integration tests, browser-checked dashboard). The hardware has **not** been bench-tested yet;
see [docs/notes/hardware-test-checklist.md](docs/notes/hardware-test-checklist.md).
The servo output is **off by default** until that test. Not a security-certified lock.

## Quick start (no hardware needed)
```bash
# 1. Backend + database + dashboard (needs JDK 21+ and Maven; Postgres is downloaded for you)
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=embedded
# 2. Open http://localhost:8080 and pick a version: Rider, Staff, Police or Admin (each has an App layout).
#    No login in the demo. For admin/viewer logins: HBR_LOGIN_REQUIRED=true ADMIN_PASSWORD=... VIEWER_PASSWORD=...
# 3. In another terminal, pretend to be a rack:
python tools/device_simulator.py setup
python tools/device_simulator.py demo
```

## With the real rack
1. Wire it: [docs/notes/wiring-guide.md](docs/notes/wiring-guide.md)
2. `firmware/include/config.example.h` → `config.h` (card key, servo switch)
3. `cd firmware && pio run -t upload && pio device monitor`
   (on this laptop: `~/.platformio/penv/Scripts/python.exe -m platformio ...`, because Windows blocks `pio.exe`)
4. In the serial monitor, type `enroll` and tap a card to allow it
5. Follow [docs/notes/hardware-test-checklist.md](docs/notes/hardware-test-checklist.md)

## Stack
| Part | Tech |
|---|---|
| Rack | Arduino Uno R3 (ATmega328P) / PlatformIO, PN532 NFC (I2C), MPU-6050 accelerometer (I2C), MG90S servo, red/green LEDs, active buzzer |
| Backend | Java 21, Spring Boot 3.5, Spring Security, JdbcClient (plain SQL), Flyway |
| Database | PostgreSQL 17 (embedded for dev/demo, or your own) |
| Web | Four versions at `/rider/`, `/staff/`, `/police/`, `/admin/` (browser + app layouts), HTML/CSS/JS modules, no build step; Rive animations, MapLibre 3D campus map (OpenFreeMap + Esri imagery) |
| Simulator | Python 3 standard library |

## Repository map
- `firmware/`: Arduino Uno code. `lib/hbr_logic` = PC-tested logic, `src/` = hardware glue. [README](firmware/README.md)
- `backend/`: REST API, security, migrations, tests. [README](backend/README.md)
- `frontend/`: the four versions + `/` chooser, Rive lab (`/lab`). [README](frontend/README.md)
- `tools/device_simulator.py`: fake rack for demos/tests
- `docs/notes/`: **learning notes**: start with [overview.md](docs/notes/overview.md); design rules in [design.md](docs/notes/design.md)
- `docs/BUILD_PLAN.md`: what was built, in order, with the progress log
- `docs/API.md`: the REST contract · `docs/ARCHITECTURE.md` · `docs/SECURITY.md`
- `docs/HARDWARE_DECISIONS.md` · `docs/PROJECT_STATUS.md` · `docs/DEMO_SCRIPT.md`
- `firmware/KNOWNBUGS.txt`: known limitations
- `CONTRIBUTING.md`: team workflow

## Key safety and security points
- The rack decides locally from the card list in its EEPROM. No card key or no enrolled cards → it **denies everyone** (fail-secure). With no clock, the list doesn't expire: remove cards by hand.
- Raw card IDs are never stored or printed; only the first half of an HMAC "credential reference" is saved. Cloned cards are **not** stopped (UID-based cards).
- Tamper events never move the lock.
- Never power the servo from the Uno's 5V pin; use a separate 5 V supply with a shared ground.
- Never commit `firmware/include/config.h`, `.env` files, or device tokens.
