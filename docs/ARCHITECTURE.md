# Architecture (draft)

ESP32 C++ firmware reads NFC, checks locally cached authorization, controls the lock actuator, samples a vibration/tamper sensor, and queues events. Java/Spring Boot manages racks, credentials, reports, administrators, and event ingestion. PostgreSQL persists rack/device records, credential references and permissions, and security events. The HTML/CSS/JS admin UI communicates only with the API.

Access flow: read credential → validate against cache/freshness policy → bounded unlock action → queue event → authenticated upload when online. Use versioned, integrity-protected authorization snapshots and define stale-cache/revocation behavior. The browser is untrusted; enforce permissions server-side. Device IDs alone are not authentication. Do not store raw NFC secrets or treat cloneable UIDs as strong authentication.

Not implemented: hardware reads, lock control, authentication, snapshot signing, synchronization, or calibrated tamper detection.
