-- V4: a rack that went offline doesn't count as online again until an admin confirms it.
-- Miles tested a rack that showed offline; a card tap reached the server and it silently became
-- "Online" again. Now, when a device checks in after being offline, needs_confirm is set and the
-- rack shows UNCONFIRMED ("Back online, not confirmed") until someone presses Confirm Online.
-- A brand-new device's first check-in doesn't need confirming (someone is installing it).
ALTER TABLE devices ADD COLUMN needs_confirm BOOLEAN NOT NULL DEFAULT FALSE;
