# Frontend

Plain HTML/CSS/JavaScript modules, no build step. The backend serves this folder.
Explained in [../docs/notes/frontend.md](../docs/notes/frontend.md); design rules in
[../docs/notes/design.md](../docs/notes/design.md).

| Address | Page |
|---|---|
| http://localhost:8080/ | Admin terminal (everything on one black page) |
| http://localhost:8080/app | Rider app (campus map of racks, the rack scene, My Card, Alerts) |
| http://localhost:8080/app?mode=staff | Staff app (Health, Alerts, Cards) |
| http://localhost:8080/lab | Rive lab (every animation state) |

Vendored: `vendor/rive` (Rive runtime), `vendor/maplibre` (MapLibre GL JS). Fonts in `app/fonts`
(Fraunces, Hanken Grotesk; SIL OFL).

All privileged actions are enforced by the backend; the UI only hides buttons for
the read-only viewer. Never put secrets in these files.

Likely to generated entirely by Claude - Miles
