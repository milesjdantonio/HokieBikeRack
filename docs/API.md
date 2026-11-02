# API contract (implemented)

Base path: `/api/v1`. JSON everywhere. Times are ISO-8601 UTC (`2026-11-02T20:33:45Z`).
Errors use Problem Details: `{"status":400,"title":"Bad Request","detail":"…","errors":{"field":"why"}}`.
Source of truth: the controllers in `backend/src/main/java/edu/vt/hokiebikerack/`, exercised by `ApiIntegrationTest`.

## Authentication
| Caller | How | Paths |
|---|---|---|
| ESP32 | `Authorization: Bearer <device token>`; the token must belong to the `{deviceId}` in the URL | `/api/v1/devices/{deviceId}/…` |
| Admin | HTTP Basic, role ADMIN | everything else; required for any non-GET |
| Viewer | HTTP Basic, role VIEWER | GET only (403 on changes) |
| Anyone | none | `GET /api/v1/health` |

401/403 come back as JSON **without** `WWW-Authenticate` (no browser popup).

## Device endpoints
### `POST /devices/{deviceId}/events`
```json
{ "events": [ {
  "id": "9b2f…-uuid",              // created once on the device; retries reuse it
  "eventType": "ACCESS_DENIED",    // UPPER_SNAKE_CASE, 2-48 chars
  "severity": "LOW",               // INFO | LOW | MEDIUM | HIGH | CRITICAL
  "occurredAt": "2026-11-02T20:33:46Z",   // or null if the device clock isn't set
  "uptimeMs": 123456,
  "details": { "credentialReference": "<64 hex>", "reason": "NOT_LISTED" },
  "firmwareVersion": "0.2.0"
} ] }
```
1–50 events per batch; `details` must be an object ≤ 4 KB. Response
`{"accepted": n, "duplicates": m}`. **Idempotent**: a repeated `id` is skipped.
Untrusted times (null, > 5 min future, > 30 days old) are replaced by the server's
receive time and stored with `timeSource: "SERVER"`.

Event types the firmware sends:
| Type | Severity | details |
|---|---|---|
| `DEVICE_BOOT` | INFO (MEDIUM after a brownout) | `resetReason`, `servoEnabled`, `readerOk`, `accelOk` |
| `ACCESS_GRANTED` | INFO | `credentialReference` |
| `ACCESS_DENIED` | LOW | `credentialReference`, `reason`: `NOT_LISTED` / `NO_SNAPSHOT` / `CLOCK_NOT_SET` / `SNAPSHOT_EXPIRED` |
| `TAMPER_WARNING` | MEDIUM | `deviationG`, `thresholdG` |
| `TAMPER_ALARM` | HIGH | `deviationG`, `thresholdG` |
| `SENSOR_FAULT` | MEDIUM (INFO on recovery) | `sensor`: `PN532`/`MPU6050`, `state` |
Simulator events also carry `"simulated": true`.

### `GET /devices/{deviceId}/authorization-snapshot`
```json
{ "deviceId": "…", "rackId": "…", "revision": 1793651627014,
  "issuedAt": "2026-11-02T20:33:47Z", "issuedAtEpoch": 1793651627,
  "validUntil": "2026-11-05T20:33:47Z", "validUntilEpoch": 1793910827,
  "credentialCount": 1, "credentialReferences": ["f02f1d68b678…"] }
```
Includes cards that are active, not revoked, inside `validFrom`/`validUntil`,
and either `allRacks` or permitted for this rack. Max 500. Validity =
`hbr.snapshot-validity` (72 h). Devices must reject a lower `revision` than they hold.

### `POST /devices/{deviceId}/heartbeat`
Any JSON object ≤ 4 KB. The firmware sends `firmwareVersion, uptimeMs, wifiRssi, freeHeap,
queueDepth, snapshotRevision, snapshotValidUntilEpoch, snapshotCardCount, clockSynced,
lockUnlocked, alarmActive, readerOk, accelOk, servoEnabled, lastDeviationG`.
Response: `{"serverTime": "…", "currentRevision": n}`.

## Admin endpoints
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/me` | any | `{username, roles, canEdit}` |
| GET | `/racks` | any | list with live `status` (ONLINE/OFFLINE/WARNING/UNKNOWN), device counts, `openAlerts`, `sensorFault` |
| GET | `/racks/{id}` | any | `{rack, devices[]}`; devices include `lastHeartbeat`, `online`, `authorizationRevision` |
| POST | `/racks` | ADMIN | `{name, locationDescription?}` → 201 |
| PATCH | `/racks/{id}` | ADMIN | `{name?, locationDescription?}` |
| POST | `/racks/{id}/devices` | ADMIN | `{label}` → 201 `{device, deviceToken, configSnippet}`. **Token shown once.** |
| POST | `/racks/{id}/devices/{deviceId}/rotate-token` | ADMIN | new token; old one stops working |
| PATCH | `/racks/{id}/devices/{deviceId}` | ADMIN | `{label?, active?}` |
| GET | `/credentials` | any | with `status` (ACTIVE/DISABLED/REVOKED/EXPIRED/NOT_YET_VALID), `rackIds`, `lastUsedAt`, `grantedCount` |
| GET | `/credentials/unknown` | any | denied-but-unregistered references from the last 7 days |
| GET | `/credentials/revision` | any | `{revision}` |
| POST | `/credentials` | ADMIN | `{credentialReference (64 hex), displayLabel, allRacks, rackIds[], validFrom?, validUntil?}` → 201; 409 if already registered |
| PATCH | `/credentials/{id}` | ADMIN | any of the above + `active`, `clearValidFrom`, `clearValidUntil` |
| POST | `/credentials/{id}/revoke` | ADMIN | permanent |
| GET | `/events` | any | filters `rackId, severity, type` (prefix, e.g. `TAMPER`), `credentialReference, from, to, unacknowledged`; `page, size ≤ 200` → `{items, page, size, total}` |
| POST | `/events/{id}/acknowledge` | ADMIN | marks handled |
| POST | `/events/acknowledge-rack/{rackId}` | ADMIN | all open alerts for a rack |
| GET | `/reports/summary?days=1..90` | any | `byType, bySeverity, deniedReasons, byRack, byDay, activeCredentials` |
| GET | `/audit-log` | any | paged admin changes |

Every credential change bumps the authorization revision and writes an audit record.

## Not done yet (ideas)
Snapshot signatures (integrity over plain HTTP), per-user admin accounts, rate limits, event retention.
