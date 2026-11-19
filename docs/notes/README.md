# Learning notes

Notes written while building the full HokieBikeRack demo (Nov 2026), so the
team can look back, review, and learn from the decisions. Read in this order:

1. [overview.md](overview.md): the big picture. Follows one card tap and one
   shake from the rack all the way to the dashboard. **Start here.**
2. [firmware.md](firmware.md): Arduino Uno concepts: non-blocking code, 2 KB of RAM, the EEPROM
   card list, I2C and UART, the MPU-6050 registers, HMAC card references, servo PWM, fail-secure.
3. [backend.md](backend.md): Spring Boot: filter chains, device tokens vs
   passwords, plain SQL, idempotent uploads, Flyway, embedded Postgres, tests.
4. [frontend.md](frontend.md): no-build JavaScript modules, XSS-safe DOM
   building, CSP, the four versions, Connect by USB and the Testing panel.
   Who each version is for: [roles-plan.md](roles-plan.md). Look and rules: [design.md](design.md).
5. [decisions.md](decisions.md): every significant choice, with the reason
   and the alternative we didn't pick.
6. [open-questions.md](open-questions.md): defaults Claude chose that the
   team should confirm or change.

Hands-on guides:
- [wiring-guide.md](wiring-guide.md): what connects to which pin.
- [hardware-test-checklist.md](hardware-test-checklist.md): the bench test, in order.
- [firmware-model.md](firmware-model.md): the Rack Model page, the real firmware running in the
  browser on an emulated Uno and parts. Try the firmware before the Uno is on the bench.
- [hosting-render.md](hosting-render.md): putting the website and API online on Render.
- [../DEMO_SCRIPT.md](../DEMO_SCRIPT.md): the Tuesday demo, step by step.
- [../BUILD_PLAN.md](../BUILD_PLAN.md): what was built, in which order, and the progress log.

## Review questions (good for studying the code)
- Why does the Uno keep its card list after a power cut, but never unlock by itself? (firmware.md)
- What stops a stolen *old* card list from re-enabling a revoked card on a Wi-Fi rack? (firmware.md: rollback)
- Why can a lock module retry an upload forever without duplicating events? (backend.md: idempotency)
- Why is a device token hashed with SHA-256 but a password with bcrypt? (backend.md)
- Why is CSRF protection turned off, and why is that OK here? (backend.md)
- Why does `main.cpp` never call `delay(1000)`? (firmware.md: non-blocking)
- What would a cloned card get past, and what wouldn't it? (SECURITY.md)
