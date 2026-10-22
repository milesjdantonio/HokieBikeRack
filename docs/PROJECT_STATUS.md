# Project status

## Confirmed decisions
- Standard ESP32 development board family; exact model/revision open.
- PN532 reader and cards came together in a kit; card technology still open.
- MG90S 9 g metal-gear servo as proposed actuator; power/mechanical design not approved.
- 3-axis accelerometer for vibration/tamper sensing; exact module/chip open.
- Local demo first; multiple contributors.

## Completed scaffold
- [x] Define firmware/backend/frontend/database boundaries.
- [x] Draft architecture, API, and security guidance.
- [x] Add shared-team contribution workflow.
- [x] Add implementation plan and hardware decision log.
- [x] Add example backend environment variables.

## Next priorities
- [ ] Record exact ESP32 board and PN532/accelerometer module model numbers.
- [ ] Confirm NFC card technology and intended authentication approach.
- [ ] Decide I2C/SPI and record verified pin map.
- [ ] Verify servo voltage/current and choose a suitable supply/driver arrangement.
- [ ] Design and review the physical servo linkage, travel limits, manual release, and power-loss behavior.
- [ ] Calibrate accelerometer and set measured tamper thresholds.
- [ ] Agree on event payload and authorization snapshot contract.
- [ ] Run local PostgreSQL and verify Flyway migration.
- [ ] Implement backend persistence and authentication tests.
- [ ] Add read-only PN532 and accelerometer diagnostic sketches.
- [ ] Implement hardware-independent authorization tests and durable event queue.

The current firmware is a serial-only placeholder. It does not read NFC, sample the accelerometer, connect to Wi-Fi, or move the servo.
