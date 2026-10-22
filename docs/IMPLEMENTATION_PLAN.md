# HokieBikeRack implementation plan

Status: planning scaffold; not a deployed or security-reviewed system.

## Confirmed project decisions
- Board family: standard ESP32 development board; exact variant remains to be confirmed.
- NFC: PN532 reader and cards supplied as a kit; exact card technology remains to be identified.
- Actuator: MG90S 9 g metal-gear hobby servo; power and mechanical integration require review.
- Tamper sensing: 3-axis accelerometer; exact sensor/module remains to be identified.
- Initial deployment: local development/demo.
- Team: multiple contributors working on separate components.

## Workstreams
- Firmware: hardware-independent access policy, PN532 read-only driver bring-up, accelerometer sampling/filtering, servo interface kept disabled until reviewed, local cache and durable event queue.
- Backend: Java 21 / Spring Boot, admin/device auth, authorization snapshots, rack/credential/event services, idempotent event ingestion.
- Database: PostgreSQL + Flyway migrations, synthetic local test data.
- Frontend: HTML/CSS/JavaScript admin UI; mock data until authenticated API integration exists.
- Cross-team: API contract, hardware decisions, integration tests, threat/safety review.

## Milestones
1. **Identify hardware details:** exact ESP32 board, PN532 breakout and cards, accelerometer chip/module; check voltage levels and bus options.
2. **Freeze the contract:** event envelope, authorization snapshot schema, device identity/provisioning, cache freshness/revocation, idempotency.
3. **Backend foundation:** local PostgreSQL, Flyway schema, health endpoint, domain/repository layer, tests.
4. **Sensor bring-up:** PN532 read-only test, then accelerometer raw sample and controlled-tap logging; no lock attached.
5. **Policy logic:** unit-test authorization, cache-expiry behavior, tamper thresholds, and event queue on a host/mock interface.
6. **Servo bench test:** MG90S on suitable external power, linkage disconnected; validate range, startup movement, timeouts, and reset/power-loss behavior. No live rack until mechanical and fail-safe review.
7. **Offline synchronization:** authenticated snapshots, version/expiry checks, queued event uploads, stable event IDs, server-side idempotency.
8. **Admin workflows:** authenticated rack/credential management, event filters, audit history.
9. **Integration demo:** simulated lock first, then supervised hardware demo and documented failure cases.

## Demo acceptance criteria
- Admin and device endpoints reject unauthenticated privileged operations.
- Firmware never unlocks merely because the network failed or a card UID was read.
- Offline and stale-cache policy is documented and tested.
- Repeated event uploads do not duplicate server records.
- Servo is not powered from an ESP32 GPIO; supply and mechanical limits are reviewed.
- Accelerometer false-positive behavior is measured against ordinary handling.
- Wi-Fi loss, backend outage, sensor faults, reboot, and power loss have documented outcomes.
- UI clearly distinguishes demo data from live events.

## Not in scope yet
Production deployment, campus-card compatibility assumptions, final rack mechanism, and any claim of production security.
