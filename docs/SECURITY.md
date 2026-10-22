# Security and physical safety checklist

- [ ] Confirm actuator voltage/current, driver circuit, safe default, and manual release.
- [ ] Test boot/reset/brownout/crash behavior with the actuator disconnected.
- [ ] Choose NFC technology; do not rely on public UID alone.
- [ ] Define offline cache expiry and revocation policy.
- [ ] Protect authorization snapshots against tampering and rollback.
- [ ] Provision unique device credentials; plan rotation and revocation.
- [ ] Use HTTPS outside isolated development; authenticate devices.
- [ ] Require administrator authentication and role-based authorization.
- [ ] Keep secrets out of Git and browser code; avoid raw NFC identifiers in logs.
- [ ] Test network loss, duplicate events, stale snapshots, sensor faults, power loss, and reboot during unlock.

Planning checklist only; not a security certification.
