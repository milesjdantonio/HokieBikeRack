-- V3: where each rack is, so the customer app can show racks on a map.
-- Optional (a rack can exist before anyone has placed it), but latitude and longitude come as a pair.
ALTER TABLE racks ADD COLUMN latitude DOUBLE PRECISION
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE racks ADD COLUMN longitude DOUBLE PRECISION
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE racks ADD CONSTRAINT racks_coordinates_pair
  CHECK ((latitude IS NULL) = (longitude IS NULL));
