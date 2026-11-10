# Security and physical safety checklist

Planning checklist for a supervised demo, not a security certification.

## Done in software
- [x] Offline cache expiry: 72 h, then deny all (fail-secure). Unknown clock = deny.
- [x] Rollback protection: racks reject snapshots with a lower revision; revision is time-based so DB wipes don't reset it.
- [x] Unique device tokens (256-bit random), stored as SHA-256, shown once, rotatable, device can be disabled.
- [x] Device token is bound to the device ID in the URL (token swap → 401).
- [x] Admin authentication (HTTP Basic, bcrypt) with ADMIN/VIEWER roles enforced server-side.
- [x] Audit log of every admin change.
- [x] Raw NFC IDs are never stored, sent or printed (HMAC-SHA256 references; the Uno keeps the first 16 bytes in EEPROM).
- [x] Idempotent event uploads; untrusted device timestamps replaced by server time.
- [x] Input validation and size limits on every device/admin request.
- [x] Dashboard: no `innerHTML` with data, Content-Security-Policy, no secrets in browser code.
- [x] Tamper events never move the lock; servo output disabled by default.
- [x] Secrets kept out of Git (`config.h`, `.env`, simulator state are ignored).

## Still open
- [ ] HTTPS (demo uses plain HTTP on a password-protected hotspot behind `HBR_ALLOW_INSECURE_HTTP`).
      Without it, someone on the same network could read a device token or tamper with a snapshot.
- [ ] Snapshot signing so racks can verify lists even without TLS.
- [ ] Clone-resistant cards (e.g. MIFARE DESFire EV2/EV3 with mutual authentication). UID cards can be copied.
- [ ] Login rate limiting / lockout; per-person admin accounts.
- [ ] Battery-backed clock so offline reboots don't deny everyone (a usability, not security, issue).
- [ ] Turn off `HBR_ENABLE_SERIAL_SIM` for anything beyond testing.
- [ ] Physical: confirm actuator supply, safe default position, manual release, behaviour on power loss/brownout, pinch points.
- [ ] Test network loss, duplicate events, stale snapshots, sensor faults, power loss and reboot during unlock on real hardware.
