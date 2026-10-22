# HokieBikeRack implementation plan

Status: planning scaffold for a supervised local demo; not a deployed or security-reviewed system.

## Confirmed project decisions
- Board family: standard ESP32 development board; exact variant remains to be confirmed.
- NFC: PN532 reader and cards supplied as a kit; exact card technology remains to be identified by testing the actual cards.
- Actuator: MG90S 9 g metal-gear hobby servo; power and mechanical integration require review.
- Tamper sensing: 3-axis accelerometer; exact sensor/module remains to be identified.
- Initial deployment: local development/demo.
- Team: multiple contributors working on separate components.

## Three-week schedule (15 working days)

The target is a reliable end-to-end demonstration, not a production-ready security system. Each day should end with a tested, reviewable increment. Start with a simulated actuator if the physical mechanism is not safe and reliable yet.

### Week 1 — prove the hardware and interfaces
| Day | Focus | End-of-day deliverable |
|---|---|---|
| 1 | Team setup; confirm exact ESP32 board, card kit and sensor markings; agree on API/event fields and local setup | Reproducible development setup, hardware inventory, agreed contract |
| 2 | PN532 read-only bring-up; identify what the supplied cards actually report; start backend and PostgreSQL locally | Card detection test with recorded technology/protocol findings; backend health check |
| 3 | Read accelerometer raw values; test MG90S separately on suitable external power with linkage disconnected | Sensor sample log and servo bench-test notes; no live lock |
| 4 | Implement and unit-test access-policy rules independently of hardware; define database entities and migrations | Policy tests and initial schema/migration |
| 5 | Demonstrate card read → policy decision → simulated or supervised bench actuator response | End-to-end local proof; list of known limitations and blockers |

### Week 2 — connect the full stack
| Day | Focus | End-of-day deliverable |
|---|---|---|
| 6 | Implement backend device-event and authorization-snapshot endpoints, validation and authentication boundaries | Documented API behavior with tests |
| 7 | Persist racks, credentials/permissions and events; add migration and idempotency tests | Repeat event uploads do not create duplicate records |
| 8 | Connect ESP32 to Wi-Fi and send device events; keep lock actuation gated behind reviewed policy | Device-to-backend event flow, with network failures handled safely |
| 9 | Connect admin UI to real API data; label mock/demo data clearly | Dashboard can show persisted events and basic rack/credential state |
| 10 | Complete one end-to-end path: card → policy → event → backend/database → dashboard | Integrated demo on local network, with a documented fallback if hardware is unreliable |

### Week 3 — test failures, stabilize and present
| Day | Focus | End-of-day deliverable |
|---|---|---|
| 11 | Calibrate accelerometer and distinguish ordinary handling from candidate tamper events | Recorded test results and adjustable, documented thresholds |
| 12 | Exercise Wi-Fi/backend outages, cache freshness, queued events and reconnection | Tested offline policy and event replay; no implicit unlock on failure |
| 13 | Test unknown cards, repeated reads, invalid requests, reboot, sensor faults and power loss | Failure-case checklist with observed behavior and fixes prioritized |
| 14 | Feature freeze; fix demo blockers; improve setup instructions and dashboard states | Repeatable demo script and clean setup from README |
| 15 | Full rehearsal, backup video/screenshots if appropriate, final limitations and handoff | Stable demonstration, known-issues list, contributor handoff |

## Suggested workstream ownership
- **Firmware/embedded:** PN532 read-only driver, accelerometer sampling/filtering, Wi-Fi events, local policy/cache/queue, servo interface gated until safety review.
- **Backend/API:** Java 21 / Spring Boot, request validation, device/admin authentication, authorization snapshots, rack/credential/event services.
- **Database:** PostgreSQL + Flyway migrations, test fixtures, idempotency and query support.
- **Frontend/integration:** HTML/CSS/JavaScript admin UI, API integration, clear loading/error/empty/demo states.
- **Shared decisions:** API contract, exact hardware identification, offline/revocation policy, tests, security and physical-safety review. Contributors should decide the branch layout together when work begins; do not require pre-created component branches.

## Scope: must-have versus cut line

**Must-have for the demo**
- PN532 can read and identify the supplied cards; exact technology and limitations are documented.
- Access-policy logic has automated tests and is separate from raw card reading.
- At least one end-to-end path works through a simulated lock or safely bench-tested actuator.
- Backend persists events and the dashboard displays them.
- Unknown cards and network/backend failures follow explicit, tested behavior.
- Setup steps, demo steps, and known limitations are written down.

**Cut first if behind schedule**
1. Fancy dashboard styling and advanced filtering.
2. Sophisticated tamper classification; use a conservative, clearly labeled threshold demo.
3. Full offline permission administration; preserve a simple documented freshness policy.
4. Physical lock actuation; fall back to a simulated actuator if electrical/mechanical safety or reliability is not proven.

Do not cut input validation, basic tests, clear demo labeling, or safe servo power/mechanical checks.

## Hardware and safety gates
1. Identify the exact ESP32 variant, PN532 breakout, card technology, and accelerometer module before finalizing pins, voltage assumptions, or drivers.
2. Treat card UID matching as a prototype convenience, not strong authentication. Do not assume the supplied cards are compatible with a specific security protocol until tested.
3. Bench-test the MG90S with suitable external power and disconnected linkage. Never power it from an ESP32 GPIO. Review startup movement, travel limits, reset behavior, and power loss before attaching it to a real mechanism.
4. A typical hobby servo does not report actual lock position; commanded angle is not proof of engagement.
5. Accelerometer events must not directly actuate the servo.

## Demo acceptance criteria
- Admin and device endpoints reject unauthenticated privileged operations.
- Firmware never unlocks merely because the network failed or a card UID was read.
- Offline and stale-cache policy is documented and tested.
- Repeated event uploads do not duplicate server records.
- Servo supply and mechanical limits are reviewed before live actuation.
- Accelerometer false-positive behavior is measured against ordinary handling.
- Wi-Fi loss, backend outage, sensor faults, reboot, and power loss have documented outcomes.
- UI clearly distinguishes demo data from live events.

## Not in scope yet
Production deployment, campus-card compatibility assumptions, final rack mechanism, and any claim of production security.