# Java backend

Spring Boot 3.5 REST API + the dashboard's web server. Explained in
[../docs/notes/backend.md](../docs/notes/backend.md); endpoints in [../docs/API.md](../docs/API.md).

Requirements: JDK 21+ and Maven 3.9+. PostgreSQL is optional (embedded profile).

```bash
mvn test                                                     # 14 integration tests (real throwaway Postgres)
mvn spring-boot:run -Dspring-boot.run.profiles=embedded      # http://localhost:8080
mvn spring-boot:run                                          # use your own Postgres (DB_URL, DB_USERNAME, DB_PASSWORD)
```
PowerShell needs quotes: `mvn spring-boot:run "-Dspring-boot.run.profiles=embedded"`.

Settings via environment variables (see `.env.example`): `ADMIN_PASSWORD`,
`VIEWER_PASSWORD` (random + logged if unset), `HBR_SNAPSHOT_VALIDITY` (72h),
`SERVER_PORT`, `HBR_EMBEDDED_DB_DIR` (default `~/.hokiebikerack/pgdata`; delete it to reset).

Never commit real passwords or device tokens.
