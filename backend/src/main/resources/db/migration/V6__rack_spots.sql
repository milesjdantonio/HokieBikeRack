-- V6: open spots per rack (Miles: a rider should know "how many open spots are there").
-- The rack can't see bikes, so spots in use are counted from card taps: a card's taps at a rack
-- alternate park / leave (tap to lock your bike in, tap again to take it out). See RackService.
--   capacity           how many bikes it holds; NULL = one per active lock module (each drives one lock)
--   spots_reset_at     an admin's "all spots are open now" (fixes the count if someone forgot to tap out)
ALTER TABLE racks ADD COLUMN capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 200);
ALTER TABLE racks ADD COLUMN spots_reset_at TIMESTAMPTZ;
CREATE INDEX idx_events_grants ON security_events(rack_id, credential_reference, occurred_at)
  WHERE event_type = 'ACCESS_GRANTED';
