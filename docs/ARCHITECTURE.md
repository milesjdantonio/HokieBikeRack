# Architecture

Detailed walkthrough with diagrams: [notes/overview.md](notes/overview.md).

## Components
- **Arduino Uno R3 firmware** (`firmware/`): reads NFC cards (PN532), turns IDs into HMAC
  credential references, decides access from the card list in EEPROM (cards enrolled
  at the rack over the serial monitor), drives the servo (gated by `HBR_ENABLE_SERVO`),
  LEDs and buzzer, samples the MPU-6050 for tamper, and prints events to serial.
  The Uno has no Wi-Fi: plugged into a computer by USB, the Admin page's **Connect by USB**
  (`frontend/shared/rack-bridge.js`) reads those events over Web Serial and uploads them as the
  rack's lock module, with a heartbeat every 30 s. (The ESP32 version that talked to the backend
  over Wi-Fi, with snapshots, NTP and an event queue, is the git tag `esp32-final`.)
- **Backend** (`backend/`): Spring Boot REST API. Device auth (bearer token),
  admin auth (HTTP Basic, ADMIN/VIEWER). Idempotent event ingestion, authorization
  snapshots, racks/devices/credentials management, reports, audit log. Serves the dashboard.
- **PostgreSQL**: source of truth. Flyway migrations V1–V8.
- **Website** (`frontend/`): Rider, Staff, Police and Admin versions, each with a browser and a
  phone layout; talks only to the API. A Testing panel drives the rack over USB.
- **Rack Model** (`frontend/model/`): the real firmware compiled to WebAssembly, on an emulated Uno.
- **Simulator** (`tools/`): a fake networked rack using the API (stands in for the ESP32 version).
- **Hosting:** locally the backend serves the website at http://localhost:8080. On Render the
  website is a static site and the API a separate service ([notes/hosting-render.md](notes/hosting-render.md)).

## Trust rules
- The browser and device IDs in URLs are untrusted. Every privileged call is authenticated and role-checked on the server.
- Device tokens and passwords are stored only as hashes.
- Raw NFC IDs are never stored, printed or sent.
- Snapshots carry a monotonic revision; networked racks reject rollbacks and stop trusting a snapshot after 72 h. (The offline Uno rack has no snapshot or clock; its EEPROM list doesn't expire.)
- No network or no clock never means "unlock" (fail-secure).
- Tamper signals never actuate the lock.

## Not implemented
A sign-in screen (login is off for the demo), snapshot signing, clone-resistant cards,
battery-backed clock, per-user admin accounts.
