# Frontend

Plain HTML/CSS/JavaScript modules, no build step. The backend serves this folder.
Explained in [../docs/notes/frontend.md](../docs/notes/frontend.md); who each version is for in
[../docs/notes/roles-plan.md](../docs/notes/roles-plan.md); design rules in [../docs/notes/design.md](../docs/notes/design.md).

| Address | Version |
|---|---|
| http://localhost:8080/ | Pick a version |
| http://localhost:8080/rider/ | Rider: open spots and alarms per rack, how to park |
| http://localhost:8080/staff/ | Staff: respond to alarms, register cards, confirm racks |
| http://localhost:8080/police/ | Police: reported incidents and their status |
| http://localhost:8080/admin/ | Admin: everything, terminal, Reports, Audit Log |
| http://localhost:8080/lab | Rive lab (every animation state) |

Add `?view=app` for the phone layout or `?view=desktop` for the browser layout.

Vendored: `vendor/rive` (Rive runtime), `vendor/maplibre` (MapLibre GL JS). Fonts in `shared/fonts`
(Fraunces, Hanken Grotesk; SIL OFL).

Login is off for the demo; with `HBR_LOGIN_REQUIRED=true` the backend enforces admin vs read-only.
Never put secrets in these files.

Likely to generated entirely by Claude - Miles
