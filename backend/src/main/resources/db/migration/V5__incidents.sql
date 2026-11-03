-- V5: police incidents. Created when an admin or staff member presses "Alert Authorities" on a
-- tamper alarm; the police version moves it along: ALERTED -> EN_ROUTE -> ON_SCENE -> RESOLVED.
-- Nothing is sent to the real police yet; this records who alerted whom, when, and what happened.
CREATE TABLE incidents (
  id UUID PRIMARY KEY,
  rack_id UUID NOT NULL REFERENCES racks(id),
  status VARCHAR(16) NOT NULL CHECK (status IN ('ALERTED', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED')),
  agency VARCHAR(60) NOT NULL,
  alerted_by VARCHAR(120) NOT NULL,
  alerted_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
-- At most one open incident per rack (a second "Alert Authorities" while one is open is a 409).
CREATE UNIQUE INDEX incidents_one_open_per_rack ON incidents(rack_id) WHERE status <> 'RESOLVED';
CREATE INDEX incidents_open ON incidents(status, alerted_at DESC);

-- Every step, for the incident's timeline.
CREATE TABLE incident_updates (
  id BIGSERIAL PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  status VARCHAR(16) NOT NULL,
  note TEXT,
  actor VARCHAR(120) NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX incident_updates_by_incident ON incident_updates(incident_id, at);
