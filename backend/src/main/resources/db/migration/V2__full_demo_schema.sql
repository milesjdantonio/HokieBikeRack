-- V2: everything the full demo needs on top of V1.
-- Flyway runs each V<number>__name.sql file once, in order, and remembers it
-- in the flyway_schema_history table. Never edit a migration that has already
-- run somewhere; add a V3 instead. (docs/notes/backend.md, "Migrations")

-- Devices log in with a random token. We store only its SHA-256 hash, so a
-- database leak doesn't hand out working device tokens.
ALTER TABLE devices ADD COLUMN token_hash VARCHAR(64);
ALTER TABLE devices ADD COLUMN token_rotated_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE devices ADD COLUMN last_heartbeat JSONB;

-- Credentials: "allowed at every rack" switch + edit time.
ALTER TABLE credentials ADD COLUMN all_racks BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE credentials ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE credentials ADD CONSTRAINT credentials_reference_format
  CHECK (credential_reference ~ '^[0-9a-f]{64}$');

ALTER TABLE credential_rack_permissions
  DROP CONSTRAINT credential_rack_permissions_credential_id_fkey,
  ADD CONSTRAINT credential_rack_permissions_credential_id_fkey
    FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE;

-- Events: which card (by reference, never raw ID), whose clock we trusted,
-- and whether an admin has looked at it.
ALTER TABLE security_events ADD COLUMN credential_reference VARCHAR(64);
ALTER TABLE security_events ADD COLUMN time_source VARCHAR(8) NOT NULL DEFAULT 'DEVICE'
  CHECK (time_source IN ('DEVICE', 'SERVER'));
ALTER TABLE security_events ADD COLUMN firmware_version VARCHAR(80);
ALTER TABLE security_events ADD COLUMN acknowledged_at TIMESTAMPTZ;
ALTER TABLE security_events ADD COLUMN acknowledged_by VARCHAR(120);
ALTER TABLE security_events ADD CONSTRAINT security_events_type_format
  CHECK (event_type ~ '^[A-Z][A-Z0-9_]{1,47}$');
CREATE INDEX idx_events_occurred ON security_events(occurred_at DESC);
CREATE INDEX idx_events_received ON security_events(received_at DESC);
CREATE INDEX idx_events_credential ON security_events(credential_reference);

-- One-row table holding the authorization revision. It goes up whenever an
-- admin changes who may unlock what. Racks refuse lists with a LOWER revision
-- than they already have (rollback protection). The value is based on the
-- clock (milliseconds), so it keeps going up even if the database is wiped.
CREATE TABLE authorization_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  revision BIGINT NOT NULL
);
INSERT INTO authorization_state (id, revision)
  VALUES (1, (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT);

-- Who changed what, when. Written by the API on every admin change.
CREATE TABLE admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32),
  target_id VARCHAR(64),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_created ON admin_audit_log(created_at DESC);
