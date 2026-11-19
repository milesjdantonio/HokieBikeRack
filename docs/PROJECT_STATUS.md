# Project status

Last updated 2026-11-19. Detailed step-by-step log: [BUILD_PLAN.md](BUILD_PLAN.md).

## Where it stands
The rack is an **Arduino Uno R3** built into the prototype (the ESP32 version is the git tag
`esp32-final`). It works on its own, and when plugged into a computer by USB the dashboard shows it
live. The website can be hosted on Render ([notes/hosting-render.md](notes/hosting-render.md)).

## Done
- [x] **Rack firmware (Uno):** card reader (PN532 over UART; I2C also supported), HMAC card references,
      card list in EEPROM, servo lock (mounted upside down), tamper warning → alarm (MPU-6050, wakes
      the sensor again if a power dip puts it to sleep), lights and passive buzzer, 4 s watchdog,
      serial console with test commands.
- [x] **Lock behaviour (2026-11-18):** tap to unlock, the same card taps again to lock. After 10 s the
      green light stays on, the red one flashes and it beeps every 2 s; it re-locks itself at 120 s.
      Tamper threshold 0.30 g.
- [x] **Bench and prototype tests:** cards enroll and unlock, servo angles set (LOCKED 130 / UNLOCKED 65
      in config.h, 50° / 115° on the real servo), lock flow, tamper, sensor recovery. Phones don't
      work as cards (they send a random ID each time).
- [x] **Backend:** device tokens, admin/viewer roles (login off for the demo), idempotent events,
      racks / lock modules / cards, open spots, police incidents, riders and access requests,
      reports, audit log, deleting racks, CORS for hosting, Flyway V1–V8, embedded Postgres.
- [x] **Website:** Rider, Staff, Police and Admin versions (browser and phone layouts), live map,
      admin terminal (including `delete <rack> confirm`), Connect by USB for the Uno, a Testing panel
      for testers, a "Starting the Server" screen while a hosted backend wakes.
- [x] **Rack Model** page: the real firmware running in the browser on an emulated Uno.
- [x] **Tests:** 45 firmware logic tests, 53 Rack Model checks, 23 backend integration tests.
- [x] **Docs:** learning notes, wiring guide, bench-test checklist, demo script, hosting guide.

## Next
- [ ] Host it on Render ([notes/hosting-render.md](notes/hosting-render.md)) and decide whether a
      sign-in screen is needed before sharing the link (today anyone with the link is admin).
- [ ] Record the remaining bench results in [HARDWARE_DECISIONS.md](HARDWARE_DECISIONS.md) (reader firmware
      version, card types).
- [ ] Rehearse the demo ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)).
- [ ] Decide the open questions in [notes/open-questions.md](notes/open-questions.md).

## Later
HTTPS everywhere, a sign-in screen, snapshot signing, battery-backed clock, clone-resistant cards,
per-user admin accounts.
