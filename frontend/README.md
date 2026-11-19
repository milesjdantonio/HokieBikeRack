# Frontend

Plain HTML/CSS/JavaScript modules, no build step. The backend serves this folder (or Render hosts it
as a static site: `js/backend-url.js` then holds the API's address; see
[../docs/notes/hosting-render.md](../docs/notes/hosting-render.md)).
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
| http://localhost:8080/model/ | Rack Model: the real firmware running in 3D ([../docs/notes/firmware-model.md](../docs/notes/firmware-model.md)) |

To add a rack: **Add Rack** on the map, then **Connect by USB** in its panel with the rack plugged into
this computer (Chrome or Edge). The page passes the rack's events to the backend while it's open.

Every version has a **Testing** button in the bottom-right corner (`shared/testing.js`). It connects to the
rack over USB with Web Serial (Chrome or Edge) and can add and remove cards, unlock, set off the alarm,
play sounds, move the servo and show the rack's log. The test commands need `HBR_ENABLE_SERIAL_SIM 1`.

Add `?view=app` for the phone layout or `?view=desktop` for the browser layout.

Vendored: `vendor/rive` (Rive runtime), `vendor/maplibre` (MapLibre GL JS), `vendor/three` (three.js). Fonts in `shared/fonts`
(Fraunces, Hanken Grotesk; SIL OFL).

Login is off for the demo; with `HBR_LOGIN_REQUIRED=true` the backend enforces admin vs read-only.
Never put secrets in these files.

Likely to generated entirely by Claude - Miles
