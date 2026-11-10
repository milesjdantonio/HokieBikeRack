# Architecture

Detailed walkthrough with diagrams: [notes/overview.md](notes/overview.md).

## Components
- **Arduino Uno R3 firmware** (`firmware/`): reads NFC cards (PN532), turns IDs into HMAC
  credential references, decides access from the card list in EEPROM (cards enrolled
  at the rack over the serial monitor), drives the servo (gated by `HBR_ENABLE_SERVO`),
  LEDs and buzzer, samples the MPU-6050 for tamper, and prints events to serial.
  The Uno has no Wi-Fi, so it doesn't talk to the backend. (The ESP32 version that did,
  with snapshots, NTP and an event queue, is the git tag `esp32-final`.)
- **Backend** (`backend/`): Spring Boot REST API. Device auth (bearer token),
  admin auth (HTTP Basic, ADMIN/VIEWER). Idempotent event ingestion, authorization
  snapshots, racks/devices/credentials management, reports, audit log. Serves the dashboard.
- **PostgreSQL**: source of truth. Flyway migrations V1–V2.
- **Dashboard** (`frontend/`): talks only to the API. Includes the phone-style app preview.
- **Simulator** (`tools/`): a fake networked rack using the API (stands in for the ESP32 version).

## Trust rules
- The browser and device IDs in URLs are untrusted. Every privileged call is authenticated and role-checked on the server.
- Device tokens and passwords are stored only as hashes.
- Raw NFC IDs are never stored, printed or sent.
- Snapshots carry a monotonic revision; networked racks reject rollbacks and stop trusting a snapshot after 72 h. (The offline Uno rack has no snapshot or clock; its EEPROM list doesn't expire.)
- No network or no clock never means "unlock" (fail-secure).
- Tamper signals never actuate the lock.

## Not implemented
HTTPS setup, snapshot signing, clone-resistant cards, battery-backed clock, per-user admin accounts.
