# Architecture

Detailed walkthrough with diagrams: [notes/overview.md](notes/overview.md).

## Components
- **ESP32 firmware** (`firmware/`): reads NFC cards (PN532), turns IDs into HMAC
  credential references, decides access from a locally cached snapshot, drives the
  servo (gated by `HBR_ENABLE_SERVO`), LEDs and buzzer, samples the MPU-6050 for
  tamper, and queues events in flash. A separate FreeRTOS task handles Wi-Fi, NTP,
  snapshot downloads, heartbeats and uploads.
- **Backend** (`backend/`): Spring Boot REST API. Device auth (bearer token),
  admin auth (HTTP Basic, ADMIN/VIEWER). Idempotent event ingestion, authorization
  snapshots, racks/devices/credentials management, reports, audit log. Serves the dashboard.
- **PostgreSQL**: source of truth. Flyway migrations V1–V2.
- **Dashboard** (`frontend/`): talks only to the API. Includes the phone-style app preview.
- **Simulator** (`tools/`): a fake rack using the same API and rules.

## Trust rules
- The browser and device IDs in URLs are untrusted. Every privileged call is authenticated and role-checked on the server.
- Device tokens and passwords are stored only as hashes.
- Raw NFC IDs never leave the ESP32.
- Snapshots carry a monotonic revision; racks reject rollbacks and stop trusting a snapshot after 72 h.
- No network or no clock never means "unlock" (fail-secure).
- Tamper signals never actuate the lock.

## Not implemented
HTTPS setup, snapshot signing, clone-resistant cards, battery-backed clock, per-user admin accounts.
