-- V8: riders request access online (Miles: "someone could register themselves online through StarRez,
-- which we don't have access to, through a form ... it connects to their HokieP to let them in").
-- The rider app's Request Access form makes a PENDING rider; an admin approves or denies it. An
-- approved rider then links their Hokie Passport: they press "Link My HokieP" (link_until = 2 min)
-- and tap the card on any rack; that unknown tap becomes their card. With a real StarRez / Hokie
-- Passport feed the card would come from there instead and the tap step would go away.
ALTER TABLE riders ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'APPROVED'
  CHECK (status IN ('PENDING', 'APPROVED', 'DENIED'));
ALTER TABLE riders ADD COLUMN email VARCHAR(160);
ALTER TABLE riders ADD COLUMN hokie_passport_id VARCHAR(20);
ALTER TABLE riders ADD COLUMN note VARCHAR(500);
ALTER TABLE riders ADD COLUMN decided_at TIMESTAMPTZ;
ALTER TABLE riders ADD COLUMN decided_by VARCHAR(120);
ALTER TABLE riders ADD COLUMN link_until TIMESTAMPTZ;
CREATE INDEX idx_riders_status ON riders(status, created_at);
