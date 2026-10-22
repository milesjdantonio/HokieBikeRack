# PostgreSQL database

Flyway migrations live under `backend/src/main/resources/db/migration/`. PostgreSQL is the persistent source of truth; browser and ESP32 clients must use the backend API rather than connecting directly to PostgreSQL.

Coordinate schema changes with API and firmware contracts. Use synthetic-only local seed data. Do not store raw NFC UIDs/card secrets in logs. Plan event retention, auditability, unique event IDs for idempotency, and appropriate indexes before demo data grows.
