-- Initial draft schema; never store raw NFC UIDs or card secrets.
CREATE TABLE racks (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  location_description VARCHAR(255),
  status VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (status IN ('ONLINE','OFFLINE','WARNING','UNKNOWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  rack_id UUID NOT NULL REFERENCES racks(id),
  device_label VARCHAR(120) NOT NULL,
  firmware_version VARCHAR(80),
  last_seen_at TIMESTAMPTZ,
  authorization_revision BIGINT NOT NULL DEFAULT 0 CHECK (authorization_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Use a keyed pseudonymous reference, not raw NFC UID; finalize key management first.
CREATE TABLE credentials (
  id UUID PRIMARY KEY,
  credential_reference VARCHAR(128) NOT NULL UNIQUE,
  display_label VARCHAR(120),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
CREATE TABLE credential_rack_permissions (
  credential_id UUID NOT NULL REFERENCES credentials(id),
  rack_id UUID NOT NULL REFERENCES racks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (credential_id, rack_id)
);
CREATE TABLE security_events (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES devices(id),
  rack_id UUID REFERENCES racks(id),
  event_type VARCHAR(48) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_devices_rack_id ON devices(rack_id);
CREATE INDEX idx_credentials_active ON credentials(active);
CREATE INDEX idx_events_rack_time ON security_events(rack_id, occurred_at DESC);
