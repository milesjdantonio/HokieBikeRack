# PostgreSQL database

Migrations: `backend/src/main/resources/db/migration/` (Flyway runs them at startup).
- `V1__initial_schema.sql`: racks, devices, credentials, rack permissions, security events
- `V2__full_demo_schema.sql`: device token hashes + heartbeat, credential `all_racks`,
  event credential reference / time source / acknowledgement, authorization revision, admin audit log

Never edit a migration that already ran; add `V3__…`.

Browser and ESP32 never connect to PostgreSQL directly; only the backend does.
Credentials are stored as HMAC references (never raw NFC IDs); device tokens as SHA-256.

Dev/demo: the backend's `embedded` profile runs PostgreSQL 17 for you, data in
`~/.hokiebikerack/pgdata` (outside OneDrive on purpose). Use synthetic data only.

Later: event retention/cleanup, backups, indexes reviewed as data grows.
