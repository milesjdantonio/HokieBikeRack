-- V7: riders, so the rider app can say "your bike is parked here" and warn you when that rack has an
-- alarm (Miles). No passwords in the demo: a rider gets a private code when their card is registered
-- (e.g. K7P2-QM4X) and types it once into the rider app's My Card. Only a SHA-256 hash of the code is
-- stored, like the device tokens; a lost code is replaced with a new one.
CREATE TABLE riders (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code_hash VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  code_rotated_at TIMESTAMPTZ
);
ALTER TABLE credentials ADD COLUMN rider_id UUID REFERENCES riders(id);
CREATE INDEX idx_credentials_rider ON credentials(rider_id);
