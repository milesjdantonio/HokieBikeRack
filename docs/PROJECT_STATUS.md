# Project status

Last updated 2026-11-02. Detailed step-by-step log: [BUILD_PLAN.md](BUILD_PLAN.md).

## Done (software, tested without hardware)
- [x] Firmware: PN532 (I2C, non-blocking), MPU-6050 driver, HMAC card references, local
      access decisions with 72 h snapshot + rollback protection, momentary lock with servo
      driver (off by default), LEDs + active buzzer patterns, tamper warning → alarm,
      flash event queue, background network task (fixes the old 8 s freeze), serial console.
- [x] 37 firmware logic unit tests on the PC (`pio test -e native`); builds with servo on and off.
- [x] Backend: device tokens, admin/viewer roles, idempotent events, snapshots, heartbeats,
      racks/devices/credentials, reports, audit log, Flyway V2, embedded Postgres.
- [x] 14 backend integration tests against real PostgreSQL (`mvn test`).
- [x] Dashboard: live overview, events, racks/devices, cards, reports, audit, app preview
      (Rider + Admin). Checked in headless Edge as admin and viewer.
- [x] Device simulator + scripted demo.
- [x] Learning notes, wiring guide, bench-test checklist, demo script.

## Next priorities
- [ ] **Bench test the hardware** ([notes/hardware-test-checklist.md](notes/hardware-test-checklist.md)), record results in HARDWARE_DECISIONS.md.
- [ ] Choose real servo angles and tamper threshold from measurements.
- [ ] Rehearse the Tuesday 2026-11-10 demo ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)).
- [ ] Review and merge `feature/full-stack-demo` into `main` (PR on GitHub).
- [ ] Decide the open questions in [notes/open-questions.md](notes/open-questions.md).

## Later
HTTPS, snapshot signing, battery-backed RTC, clone-resistant cards, per-user admin accounts, deployment.
