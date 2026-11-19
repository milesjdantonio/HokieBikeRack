# API contract (implemented)

Base path: `/api/v1`. JSON everywhere. Times are ISO-8601 UTC (`2026-11-02T20:33:45Z`).
Errors use Problem Details: `{"status":400,"title":"Bad Request","detail":"…","errors":{"field":"why"}}`.
Source of truth: the controllers in `backend/src/main/java/edu/vt/hokiebikerack/`, exercised by `ApiIntegrationTest`.

## Authentication
| Caller | How | Paths |
|---|---|---|
| Lock module | `Authorization: Bearer <device token>`; the token must belong to the `{deviceId}` in the URL | `/api/v1/devices/{deviceId}/…` |
| Admin | HTTP Basic, role ADMIN | everything else; required for any non-GET |
| Viewer | HTTP Basic, role VIEWER | GET only (403 on changes) |
| Rider | `X-Rider-Code: <code>` header (the code is the key) | `GET /rider/me`, `POST /rider/link` |
| Anyone | none | `GET /api/v1/health`, `POST /rider/request` |

A lock module is the Uno's USB bridge page (Admin > rack > Connect by USB, `frontend/shared/rack-bridge.js`)
or a Wi-Fi rack (the ESP32 version, git tag `esp32-final`; the simulator acts like one).

**Demo mode** (`HBR_LOGIN_REQUIRED=false`, the default): a request without a login is treated as ADMIN.
Lock modules still need their tokens.

401/403 come back as JSON **without** `WWW-Authenticate` (no browser popup).
Other websites may call the API only if their address is in `HBR_ALLOWED_ORIGINS` (CORS; see
[notes/hosting-render.md](notes/hosting-render.md)).

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

Event types the firmware sends (the Uno prints them as `[event] ...` lines; the USB bridge uploads them):
| Type | Severity | details |
|---|---|---|
| `DEVICE_BOOT` | INFO (Wi-Fi racks: MEDIUM after a brownout) | `servoEnabled`, `readerOk`, `accelOk` (Wi-Fi racks also `resetReason`) |
| `ACCESS_GRANTED` | INFO | `credentialReference` |
| `ACCESS_DENIED` | LOW | `credentialReference`, `reason`: `NOT_LISTED` / `IN_USE` (open for another card) / `NO_CARD_KEY`; Wi-Fi racks also `NO_SNAPSHOT` / `CLOCK_NOT_SET` / `SNAPSHOT_EXPIRED` |
| `RELOCKED` | INFO | `reason`: `CARD` (same card tapped again) / `TIMEOUT` (120 s) / `COMMAND`; `credentialReference` for CARD |
| `TAMPER_WARNING` | MEDIUM | `deviationG`, `thresholdG` |
| `TAMPER_ALARM` | HIGH | `deviationG`, `thresholdG` |
| `SENSOR_FAULT` | MEDIUM (INFO on recovery) | `sensor`: `PN532`/`MPU6050`, `state`: `NOT_RESPONDING`/`RECOVERED` |
Events from the simulator, or from a Testing panel `tap` / `shake`, also carry `"simulated": true`.

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
Any JSON object ≤ 4 KB. The USB bridge sends `link: "usb", firmwareVersion, queueDepth, readerOk,
accelOk, servoEnabled` every 30 s. (A Wi-Fi rack sends more: `uptimeMs, wifiRssi, freeHeap,
snapshotRevision, snapshotValidUntilEpoch, snapshotCardCount, clockSynced, lockUnlocked, alarmActive,
lastDeviationG`.) Response: `{"serverTime": "…", "currentRevision": n}`. A device is ONLINE if it
was heard from in the last 3 minutes.

## Admin endpoints
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/health` | public | `{status: "ok"}`; the pages ping it while a sleeping server wakes |
| GET | `/me` | any | `{username, roles, canEdit, loginRequired}` |
| GET | `/racks` | any | list with `latitude`/`longitude` (null if not placed), live `status` (ONLINE/OFFLINE/WARNING/UNCONFIRMED/UNKNOWN), device counts, `openAlerts`, `openAlarms`, `sensorFault`, `incidentStatus`, spots (`capacity`, `spotsInUse`, `openSpots`), `lastAlarmAt` |
| GET | `/racks/{id}` | any | `{rack, devices[]}`; devices include `lastHeartbeat`, `online`, `needsConfirm`, `authorizationRevision` |
| POST | `/racks` | ADMIN | `{name, locationDescription?, latitude?, longitude?, capacity?}` → 201. Coordinates come as a pair. |
| PATCH | `/racks/{id}` | ADMIN | `{name?, locationDescription?, latitude?, longitude?, clearCoordinates?, capacity?, clearCapacity?}` |
| DELETE | `/racks/{id}` | ADMIN | → 204. Removes the rack with its lock modules (tokens stop working), events, incidents and card permissions; cards stay. Audit log keeps `RACK_DELETED`. Can't be undone. |
| POST | `/racks/{id}/confirm-online` | ADMIN | clears UNCONFIRMED after a rack came back from offline (409 if nothing to confirm) |
| POST | `/racks/{id}/reset-spots` | ADMIN | "all spots are open now": restarts the tap-in / tap-out count |
| POST | `/racks/{id}/alert-authorities` | ADMIN | `{note?}` → 201 incident (ALERTED); 409 if one is already open for the rack |
| POST | `/racks/{id}/devices` | ADMIN | `{label}` → 201 `{device, deviceToken, configSnippet}`. **Token shown once.** |
| POST | `/racks/{id}/devices/{deviceId}/rotate-token` | ADMIN | new token; old one stops working |
| PATCH | `/racks/{id}/devices/{deviceId}` | ADMIN | `{label?, active?}` |
| GET | `/credentials` | any | with `status` (ACTIVE/DISABLED/REVOKED/EXPIRED/NOT_YET_VALID), `rackIds`, `lastUsedAt`, `grantedCount` |
| GET | `/credentials/unknown` | any | denied-but-unregistered references from the last 7 days |
| GET | `/credentials/revision` | any | `{revision}` |
| GET | `/credentials/{id}` | any | one card |
| POST | `/credentials` | ADMIN | `{credentialReference (64 hex), displayLabel, allRacks, rackIds[], validFrom?, validUntil?}` → 201; 409 if already registered |
| PATCH | `/credentials/{id}` | ADMIN | any of the above + `active`, `clearValidFrom`, `clearValidUntil` |
| POST | `/credentials/{id}/revoke` | ADMIN | permanent |
| GET | `/events` | any | filters `rackId, severity, type` (prefix, e.g. `TAMPER`), `credentialReference, from, to, unacknowledged`; `page, size ≤ 200` → `{items, page, size, total}` |
| POST | `/events/{id}/acknowledge` | ADMIN | marks handled; if it was the rack's last open tamper alarm, also resolves its open police incident |
| POST | `/events/acknowledge-rack/{rackId}` | ADMIN | all open alerts for a rack, and resolves its open police incident → `{acknowledged, incidentResolved}` |
| GET | `/reports/summary?days=1..90` | any | `byType, bySeverity, deniedReasons, byRack, byDay, activeCredentials` |
| GET | `/audit-log` | any | paged admin changes |
| GET | `/incidents?open=true` | any | open police incidents (`open=false`: all) |
| GET | `/incidents/{id}` | any | `{incident, updates[], rackEvents[]}`: the timeline and what the rack saw |
| POST | `/incidents/{id}/status` | ADMIN | `{status: EN_ROUTE / ON_SCENE / RESOLVED, note?}`; forward only |
| POST | `/credentials/{id}/rider-code` | ADMIN | `{name?}` → 201 `{riderId, name, code}`. **Code shown once.** |
| GET | `/access-requests?status=PENDING` | any | riders who asked for access online |
| POST | `/access-requests/{id}/approve` | ADMIN | 409 if already decided |
| POST | `/access-requests/{id}/deny` | ADMIN | 409 if already decided |

Every credential change bumps the authorization revision and writes an audit record.

## Rider endpoints
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/rider/request` | public | `{name, email, hokiePassportId? (9 digits), note?}` → 201 `{code, status: "PENDING"}` |
| GET | `/rider/me` | `X-Rider-Code` | `{name, status, cards[], parked[], linkUntil}`: where my bike is, and alarms there |
| POST | `/rider/link` | `X-Rider-Code` | approved riders: for 2 min, the next unknown card tapped on any rack becomes theirs |

## Not done yet (ideas)
Snapshot signatures (integrity over plain HTTP), per-user admin accounts, rate limits, event retention.
