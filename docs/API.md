# API contract (proposed, not implemented)

Base path: `/api/v1`. This contract is a starting point; agree on payload fields with firmware/backend contributors before implementation.

## Device endpoints
- `POST /devices/{deviceId}/events` — upload queued events. Each event has a stable unique ID; repeated uploads must be idempotent.
- `GET /devices/{deviceId}/authorization-snapshot` — retrieve a versioned authorization snapshot with revision and freshness metadata.
- `POST /devices/{deviceId}/heartbeat` — report firmware version, uptime, and health.

Every device endpoint requires device authentication; the URL device ID is not authentication.

## Admin endpoints
- `GET /racks`, `GET /racks/{rackId}`, `POST /racks`, `PATCH /racks/{rackId}`
- `GET /credentials`, `POST /credentials`, `PATCH /credentials/{credentialId}`
- `GET /events` with rack, severity, and time filters
- `GET /reports`

Admin endpoints require authenticated users, role checks, validation, and audit records.

## Payload design TODOs
- Define event envelope: event UUID, device/rack identifiers, event type, severity, device timestamp, optional bounded metadata, firmware version.
- Define snapshot schema: revision, issue/expiry time, allowed credential references and rack scope, integrity/authenticity protection, rollback handling.
- Define cache freshness and revocation policy during Wi-Fi/backend outages.
- Define pagination, rate/batch limits, server error handling, timestamp trust, and device provisioning/rotation.
- Do not send raw card secrets or expose PostgreSQL to the browser.
- For PN532, confirm card technology and authentication method before defining credential references; a card UID alone can be cloneable.
- Use HTTPS and authenticated devices outside isolated local development.
