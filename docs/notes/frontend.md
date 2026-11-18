# Frontend notes (Phase 11: four versions)

Plain HTML/CSS/JavaScript modules, no build step; the backend serves `frontend/`. The earlier
terminal page and the old rider/staff app (Phases 8 and 9) were replaced on 2026-11-02 and live in
git history. Who each version is for: [roles-plan.md](roles-plan.md). Look and rules: [design.md](design.md).

## Addresses
| Address | Version | Code |
|---|---|---|
| `/` | "Who are you?" chooser | `index.html`, `shared/chooser.js` |
| `/rider/` | Riders: open spots, alarms, how to park | `shared/rider.js` |
| `/staff/` | Staff on patrol: respond, register cards, confirm, alert police | `shared/console.js` (role staff) |
| `/police/` | VT Police: reported incidents, timeline, status | `shared/police.js` |
| `/admin/` | Everything, plus the terminal, Reports, Audit Log | `shared/console.js` (role admin) |
| `/lab` | Rive lab (developer tool) | `lab/` |

Each version has a **browser** layout and an **app** (phone) layout. Narrow screens get the app
automatically; `?view=app` / `?view=desktop` force one.

## How the pieces fit
- `shared/live.js` polls the API every few seconds and emits `change`, `event` (a new tap/shake/alarm),
  `rack` (status changed), `incident` (police status changed) and `connection`. Every page is built on it,
  so they all react to the rack the same way. Helpers: `findRack` (the short names you type), `spotsText`,
  `alarmText`, `pinRack`.
- `shared/console.js` is admin and staff. `CAN` decides what each role sees (staff: no rack setup,
  cards, terminal commands or audit log). Every button is a real API call; most also have a terminal command.
- **Adding a rack** (the Uno has no Wi-Fi): Add Rack (name + spot on the map), then in its panel
  **Connect by USB** with the rack plugged into this computer. The first connect makes the rack's lock module
  and its token (kept in this browser's localStorage); nothing to copy, nothing to flash. While the tab is open,
  `shared/rack-bridge.js` forwards every `[event]` line the rack prints to `/api/v1/devices/{id}/events` and
  sends a heartbeat every 30 s, so the rack shows Online, with live taps and alarms. Close the tab or unplug
  and it's Offline after 3 min (it still runs on its own card list). Registering a waiting card while the
  rack is connected also sends `add <reference>` to it. Events caused by Testing panel commands are marked
  simulated.
- `shared/rack-link.js` is the one Web Serial connection to the rack, shared by the Testing panel
  (`shared/testing.js`) and the rack connection, since only one program can hold the port.
- `shared/map.js` is the campus map (MapLibre + OpenFreeMap + Esri imagery, as in TerraSim): Rive pins,
  `setInset()` so a rack centres beside the side panel, `startMove()`, `placeMap()` for Add Rack, kept
  inside the VT area.
- `shared/theme.css` + `shared/tokens.css` (fonts in `shared/fonts`), `shared/icons.js` (the bike icon).
- `js/api.js`, `js/dom.js`, `js/rive.js` are the oldest shared modules (fetch, element builder, Rive loader).

## Rive animations (tools/rive/art, built with `node tools/rive/build.mjs`)
| File | Where | States |
|---|---|---|
| `pin.riv` | every rack on every map | online, warning, alarm (shudder), offline, police (red/blue); unlock/deny; selected |
| `rack.riv` | rack panel / sheet | idle, granted, denied, alarm, offline |
| `shake.riv` | the panel that drops in from the top | bump (amber), alarm (red) |
| `police.riv` | Alert Authorities, police version | ready, sending, sent |
| `badge.riv` | terminal lines, Needs You, alerts, cards | info, ok, denied, warning, alarm, offline, card, police |
| `signal.riv` | lock module Wi-Fi, terminal header | 0-4 bars, blip on each new event |
| `logo.riv` | top bars | builds once |
Motion only answers events; nothing idles or pulses (Miles: pulses look AI-made).

## Things worth knowing (bugs we hit)
- **Native `replaceChildren(null)` prints "null".** Pages use `fill(el, ...)`, which drops null/false and
  flattens arrays. Don't name a parameter `fill` (it shadowed the helper once and broke the app sheet).
- **Never set a MapLibre marker's `className`:** it wipes MapLibre's own classes and the pins stack
  60 px apart. Use `classList`.
- **Rive icons are cleaned up when their element leaves the page** (`rive.js` `sweep()`). Keep live
  elements (the app terminal) in the page and hide them instead of detaching; create new icons before
  moving reused rows into a detached container.
- `const history = []` shadows `window.history`; the terminal's list is `cmdHistory`.
- Open spots are counted from taps (park / leave alternate) because the rack can't see bikes; admins
  can set the spots and press "All Spots Open" if the count drifts.
