# HokieBikeRack

Smart bike-rack access and tamper-monitoring prototype.

## Stack
- Firmware: C++ / PlatformIO on a standard ESP32 development board (exact variant TBD)
- NFC: PN532 reader and cards supplied in a kit (exact card technology TBD)
- Proposed actuator: MG90S 9 g metal-gear hobby servo
- Tamper sensing: 3-axis accelerometer (exact module/chip TBD)
- Backend: Java 21 / Spring Boot REST API
- Database: PostgreSQL with Flyway migrations
- Admin UI: HTML/CSS/JavaScript

## Status
This is a planning scaffold for a local demo, not a finished or security-reviewed lock system. The firmware remains a serial-only placeholder; it does not read NFC, sample the accelerometer, connect to Wi-Fi, or move the servo. The servo power circuit and physical linkage have not been approved.

## Repository map
- `firmware/`: ESP32 C++ placeholder and hardware bring-up notes
- `backend/`: Spring Boot starter, health endpoint, environment config, initial migration
- `frontend/`: static administrator dashboard using clearly labeled demo data
- `database/`: PostgreSQL notes
- `docs/ARCHITECTURE.md`: component boundaries and trust rules
- `docs/IMPLEMENTATION_PLAN.md`: staged milestones and demo acceptance criteria
- `docs/HARDWARE_DECISIONS.md`: confirmed parts, safety notes, and open questions
- `docs/API.md`: proposed device/admin REST contract
- `docs/SECURITY.md`: security and physical-safety checklist
- `docs/PROJECT_STATUS.md`: progress and next priorities
- `CONTRIBUTING.md`: suggested component ownership and shared-team workflow

## Architecture
The ESP32 is intended to make access decisions using a versioned local authorization cache so routine access can continue during Wi-Fi outages, subject to a defined cache-freshness policy. It should queue events locally and upload them through authenticated, idempotent requests when connectivity returns. The backend is the central source of truth for rack records, credentials/permissions, reports, and security events.

## Safety and security
- Do not treat NFC UID alone as strong authentication; identify the exact card technology first.
- Do not power the MG90S from an ESP32 GPIO. Bench-test it with a suitable supply and disconnected linkage.
- A typical three-wire hobby servo does not report actual lock position; commanded angle is not proof of engagement.
- Do not let accelerometer events directly actuate the servo.
- Do not commit Wi-Fi credentials, device keys, database passwords, or real access data.
- Device/admin authentication, snapshot integrity, offline revocation behavior, and full API persistence remain to be implemented.
