# Backend notes (Java 21, Spring Boot 3.5, PostgreSQL)

## Run it
```bash
cd backend
mvn test                                                   # 23 integration tests on a real throwaway Postgres
mvn spring-boot:run -Dspring-boot.run.profiles=embedded    # dashboard at http://localhost:8080
```
Login is off by default (demo mode: everyone is admin). With `HBR_LOGIN_REQUIRED=true`, set
`ADMIN_PASSWORD` / `VIEWER_PASSWORD` first, or copy the generated ones from the log.
PowerShell: `$env:ADMIN_PASSWORD="..."`. Git Bash: `export ADMIN_PASSWORD=...`.

## Package map
```
edu.vt.hokiebikerack
  config/       SecurityConfig (3 filter chains + CORS), DeviceTokenFilter, DemoAdminFilter,
                EmbeddedPostgresConfig, HbrProperties, WebConfig (short page addresses)
  common/       ApiException + handler (JSON errors), Db helpers, Tokens (random + SHA-256)
  devices/      DeviceApiController (what a lock module calls), DeviceService (snapshot, heartbeat)
  events/       EventService (idempotent ingest, search, acknowledge), EventController
  credentials/  CredentialService (register/edit/revoke, unknown cards), AuthorizationRevision
  racks/        RackService (racks, devices, token rotation, live status, open spots, delete)
  incidents/    IncidentService (Alert Authorities, police status steps)
  riders/       RiderService (rider codes, access requests, "where is my bike")
  reports/      ReportService (GROUP BY counts)
  audit/        AuditService (who changed what)
```
Pattern: **Controller** (HTTP in/out, validation) → **Service** (rules + SQL) → database.

## Security: three filter chains
`SecurityConfig.java` defines three independent rule sets, checked in order:

| Order | Paths | Who | How |
|---|---|---|---|
| 1 | `/api/v1/devices/**` | lock modules (the Uno's USB bridge page, or a Wi-Fi rack) | `Authorization: Bearer <token>`, checked against the device ID **in the URL** |
| 2 | `/api/**` | people | HTTP Basic. `GET` = ADMIN or VIEWER; anything else = ADMIN |
| 3 | everything else | anyone | static dashboard files (contain no data) + CSP header |

Things worth understanding:
- **The URL's device ID is not proof.** A valid token for rack A on rack B's URL → 401. (Tested.)
- **Passwords → bcrypt** (slow on purpose; humans pick guessable passwords).
  **Device tokens → SHA-256** (fast is fine; 256 random bits can't be guessed).
  Either way the database never holds the real secret.
- **401 without `WWW-Authenticate`**: otherwise the browser pops up its own ugly
  login box. Our JS shows its own login screen instead.
- **CSRF off — why that's OK:** CSRF tricks your browser into sending a request
  *with your cookies* to another site. We use no cookies or sessions; the
  `Authorization` header is added by our own JS and a malicious site can't add it.
- **CSP** (`default-src 'self'`) means the browser only runs scripts from our
  server. Even if some text slipped into the page as HTML, inline `<script>` wouldn't run.
- Role checks in the UI (hiding buttons) are convenience only. The server enforces them.
- **Demo mode** (`HBR_LOGIN_REQUIRED=false`, the default): `DemoAdminFilter` treats a request with no
  login as the admin. Fine on a laptop or a link you don't share; anyone who can reach the server
  can change things. Lock modules still need their tokens.
- **CORS:** a page on another address (the Render static site) may call `/api/**` only if that address
  is in `HBR_ALLOWED_ORIGINS`. Empty = only pages this server served. See [hosting-render.md](hosting-render.md).

## Plain SQL (JdbcClient) instead of JPA
JPA/Hibernate maps Java objects to tables automatically. We switched to
writing SQL directly with Spring's `JdbcClient` because:
- the key trick, `INSERT … ON CONFLICT (id) DO NOTHING`, is plain SQL;
- JSONB columns (`details`, `last_heartbeat`) are easy in SQL, fiddly in JPA;
- for learning, you can see exactly what hits the database.
Trade-off: more typing for simple CRUD.

## Idempotent event upload
The ESP32 can't know if a request that timed out actually reached the server,
so it retries. To make retries harmless:
1. The device gives each event a UUID **once**, when it's created.
2. The server inserts with `ON CONFLICT (id) DO NOTHING` (primary key = that UUID).
3. Response: `{"accepted": 1, "duplicates": 0}` → on a retry `{"accepted": 0, "duplicates": 1}`.
The database enforces it, so it even works if two uploads race. (Tested.)

## Don't trust device clocks
If `occurredAt` is missing, > 5 min in the future, or > 30 days old, we store
the server's receive time and `time_source = 'SERVER'` (shown as `*` in the dashboard).

## Authorization revision
One-row table `authorization_state`. Every credential change runs
`revision = GREATEST(revision + 1, now_in_ms)`: always bigger than before, and
about "now", so a wiped database still starts above what a rack remembers.

## Live rack status (computed, not stored)
`UNKNOWN` (no device) → `OFFLINE` (no heartbeat/request in 3 min) →
`WARNING` (unacknowledged MEDIUM+ event in 24 h, or a heartbeat reporting a
sensor fault) → otherwise `ONLINE`. A rack that comes back after being OFFLINE is `UNCONFIRMED`
until someone checks it and presses Confirm Online. See `RackService.status()`.

## Deleting a rack
`DELETE /api/v1/racks/{id}` (the terminal's `delete <rack> confirm`, or Delete Rack in its panel)
removes, in one transaction: its incidents and their timelines, its events, which cards were
allowed there, its lock modules (so their tokens stop working) and the rack. The cards stay. The
audit log keeps a `RACK_DELETED` line with the name. There's no undo.

## Migrations (Flyway)
`src/main/resources/db/migration/V1__…sql` to `V8__…sql` run once each, in
order, recorded in `flyway_schema_history`. **Never edit a migration that has
run anywhere; add `V9__…`.** Flyway checksums old files and refuses to start if they changed.

## Embedded Postgres
`io.zonky.test:embedded-postgres` downloads real PostgreSQL 17 binaries via
Maven and starts them inside the app (`embedded` profile). Data lives in
`~/.hokiebikerack/pgdata`, deliberately **outside OneDrive** (syncing live DB
files can corrupt them). Delete that folder for a fresh start.
Tests use the same thing with a temporary folder and a random port.

## Tests
`ApiIntegrationTest` uses MockMvc (fake HTTP requests, real app, real DB).
It covers logins, roles, device token swap, token rotation, hashing,
idempotency, clock trust, validation, the full tap → register → revoke flow,
all-racks cards, heartbeat → status, tamper → WARNING → acknowledge, back-online confirm,
rider requests and codes, open spots, police incidents, deleting a rack, reports.
`NoLoginDemoTest` checks demo mode (no login needed, devices still need tokens).

## Hosting
`backend/Dockerfile` builds the API as a container; `render.yaml` at the repo root puts it on
Render with a PostgreSQL database (settings `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`,
`DB_PASSWORD`, `PORT`). Step by step: [hosting-render.md](hosting-render.md).

## Ideas for later
Rate limiting on login, real user accounts (DB + hashed passwords), HTTPS
(reverse proxy with a certificate), signing snapshots so racks can verify them
even over plain HTTP, event retention/cleanup, pagination on credentials.
