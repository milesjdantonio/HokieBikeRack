# Learning notes

Notes written while building the full HokieBikeRack demo (Nov 2026), so the
team can look back, review, and learn from the decisions. Read in this order:

1. [overview.md](overview.md): the big picture. Follows one card tap and one
   shake from the rack all the way to the dashboard. **Start here.**
2. [firmware.md](firmware.md): ESP32 concepts: non-blocking code, two tasks
   + mutexes, I2C, the MPU-6050 registers, HMAC card references, NTP, servo PWM,
   fail-secure.
3. [backend.md](backend.md): Spring Boot: filter chains, device tokens vs
   passwords, plain SQL, idempotent uploads, Flyway, embedded Postgres, tests.
4. [frontend.md](frontend.md): no-build JavaScript modules, XSS-safe DOM
   building, CSP, the app preview.
5. [decisions.md](decisions.md): every significant choice, with the reason
   and the alternative we didn't pick.
6. [open-questions.md](open-questions.md): defaults Claude chose that the
   team should confirm or change.

Hands-on guides:
- [wiring-guide.md](wiring-guide.md): what connects to which pin.
- [hardware-test-checklist.md](hardware-test-checklist.md): the bench test, in order.
- [firmware-model.md](firmware-model.md): the Rack Model page, the real firmware running in the
  browser on emulated parts. Try the firmware before the ESP32 is on the bench.
- [../DEMO_SCRIPT.md](../DEMO_SCRIPT.md): the Tuesday demo, step by step.
- [../BUILD_PLAN.md](../BUILD_PLAN.md): what was built, in which order, and the progress log.

## Review questions (good for studying the code)
- Why does the rack deny everyone after a power cut with no Wi-Fi? (overview.md, firmware.md)
- What stops a stolen *old* card list from re-enabling a revoked card? (firmware.md: rollback)
- Why can the ESP32 retry an upload forever without duplicating events? (backend.md: idempotency)
- Why is a device token hashed with SHA-256 but a password with bcrypt? (backend.md)
- Why is CSRF protection turned off, and why is that OK here? (backend.md)
- Why does `main.cpp` never call `delay(1000)`? (firmware.md: non-blocking)
- What would a cloned card get past, and what wouldn't it? (SECURITY.md)
