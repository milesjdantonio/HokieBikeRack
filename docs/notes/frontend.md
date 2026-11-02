# Frontend notes

Four pages, all plain HTML/CSS/JavaScript modules (no build step), served by the backend:

| Address | What | Code |
|---|---|---|
| `/` | **Admin terminal**: sign-in prompt, then one black page with every section | `index.html`, `css/terminal.css`, `js/terminal.js` |
| `/app` | **Rider app**: Racks (campus map + list), a rack, My Card, Alerts, Settings | `app/` |
| `/app?mode=staff` | **Staff app**: Health (map + list), Alerts, Cards, Settings | `app/` (same code, `MODE`) |
| `/lab` | Rive lab: every animation and state, for checking art | `lab/` |

Shared: `js/api.js` (login header, errors), `js/dom.js` (`h()` element builder, time
formatting), `js/rive.js` (mounts a Rive animation with a fallback). Design rules:
[design.md](design.md). Read that first; the second version of these pages exists because the first
"felt very AI generated".

## Why two looks
- **Staff on a laptop** need everything at once, fast. Miles asked for a terminal: monospace,
  black, every section stacked, `[bracket]` buttons, no pop-ups. Deliberately plain.
- **Riders on a phone** get a product with its own world, built with the craft rules from
  TerraSim, SchmollCrossword and Rythm Architect.

## Admin terminal (`js/terminal.js`)
- Each section is a "command" (`$ racks`, `$ events --tail 50`). Filters are `[buttons]`; the
  active one is inverted.
- **No pop-ups.** Register, edit, revoke, new rack, add device: each opens an inline form *under
  the row it belongs to*. Confirmations too ("revoke Miles? [revoke] [cancel]").
- **Live refresh every 10 s, but never under your fingers.** `busy(section)` skips a section
  with an open form or a focused input, so typing is never wiped.
- **No flicker.** `renderIfChanged(el, signature, build)` only rebuilds a section when its data
  changed (it compares a JSON signature).
- A device token is printed once, inline, with `[copy]` and `[done]`.
- Racks get map coordinates as `lat, lng` (paste from Google Maps).
- `[open rider app]` / `[open staff app]` show `/app` in a phone frame (an `<iframe>`; the backend
  allows same-origin framing only).

## Customer app (`app/`)
- `js/main.js`: sign-in, shell (top bar + tabs), hash routing (`#racks`, `#rack/<id>`, …), refresh
  every 12 s (paused while a form is open).
- `js/rider.js`: Racks, rack, My Card, Alerts. `js/staff.js`: Health, Alerts, Cards.
- `js/ui.js`: drawn SVG icons (one stroke weight), buttons, rows, switch, toast, sounds.
- `js/map.js`: the rack map (below).
- `css/tokens.css`: every colour, font, radius and easing. `css/app.css`: everything else.

Things worth noticing:
- **Surfaces are separated by tone, not lines.** A list is one rounded surface; rows are 2 px apart
  so the darker ground shows between them.
- **One accent.** Burnt Orange marks the main action (Try a Tap, Register, Sign In) and the
  current tab. Status uses green/amber words, not badges.
- **Copy rules** (SchmollCrossword): Title Case buttons, no eyebrows, no filler, no emoji, no
  exclamation marks. Sentences only where they tell you something ("2 of 3 racks are taking cards.").
- **The authored moment** is the tap: the rack scene plays the card arriving, the LED, the bolt,
  with a beep that mirrors the real buzzer (Settings > Sound).
- **Wide screens:** map beside the list; scene beside the details; the tabs become top-bar links
  (no floating pill navigation, which the rules ban).
- **Browser surfaces are themed:** selection, focus ring, caret, scrollbars, tabular numbers.
- Reduce motion turns off entrances and pauses Rive after it settles.

## The rack map (TerraSim's stack)
- **MapLibre GL JS 6.15** (vendored in `vendor/maplibre/`, same build TerraSim uses), OpenFreeMap's
  "liberty" style for streets, labels and **3D buildings** (no API key), and **Esri World Imagery**
  under it, dimmed like a photo in a dark room (`raster-brightness-max`, less saturation).
- Layer order copied from TerraSim: land/water fills, then satellite, then roads, labels and
  buildings on top.
- Markers are **still**: the rack icon in a disc, its ring coloured by status. Nothing pulses
  (Miles: pulses read as AI-made).
- Racks need coordinates (`latitude`, `longitude`, Flyway V3). Without them they're still in the list.
- If the style can't load or WebGL is off, a sentence replaces the map and the list still works.
- Privacy/terms: map tiles come from OpenFreeMap and Esri; attribution is in the map's (i) button and
  Settings. Check Esri's terms before any real deployment (TerraSim notes the same).
- The CSP allows only those two hosts (`connect-src`, `img-src`) plus `worker-src blob:`.

## Rive
- `tools/rive/art/rack.mjs` → `rack.riv`: the lit centrepiece. Number input `state`: 0 idle,
  1 granted, 2 denied, 3 alarm, 4 offline. **Every moving part has a pose in every state**
  (`tools/rive/pose.mjs`), so switching states never leaves the card hanging mid-air.
- `logo.mjs` → `logo.riv`: the hoop draws itself, a wheel rolls in, the orange light comes on.
- `node tools/rive/build.mjs` rebuilds; open `/lab` to see every state.
- The writer (`tools/rive/riv.mjs`) is copied from TerraSim (MIT).

## Placing racks by clicking (like TerraSim)
Staff app → a rack → **Place on Map** (or **Move on Map**), or Health → **Add Rack**. The terminal's
`[place on map]` opens the same screen. `app/js/placer.js`:
- Click the satellite map to drop the pin; drag it to fine-tune. **Enter** saves, **Escape** cancels.
- A live hint line says what to do next (TerraSim's `draw-hint`), and a readout shows the coordinates.
- **Jump to a place** searches with Photon (komoot's OpenStreetMap search, TerraSim's typeahead),
  biased to Blacksburg; picking a result flies the map there.
- Starts looking straight down (pitch 0): easier to be exact than at an angle.

## Tutorial (Miles: "I was confused when doing the old UI")
- **Apps:** a short tour the first time you open each app (`app/js/tour.js`). One step lights up one
  real thing (dimmed page, cut-out around it) with one or two sentences. Next/Back/Skip, keyboard
  (Enter/arrows/Escape), focus kept in the card. A step whose target isn't there (e.g. Add Rack for a
  viewer) is skipped. Shown once per device; **Settings → Show the Tour Again**.
  Tours: rider (welcome, map, Find Nearest, racks, My Card, Alerts, Settings), rack (scene, Try a Tap,
  today), staff (welcome, health, Add Rack, Alerts, Cards, Settings).
- **Terminal:** a `$ help` section, open the first time, with the setup order (rack → device → flash →
  tap → register) and what each section is for. `[help]` in the top line toggles it.

## UX pass (Phase 9)
- **Find Nearest** (riders): uses the device's location, sorts racks by distance and shows "260 m away".
  The position never leaves the browser.
- **Get Directions** on a placed rack: opens Google Maps cycling directions.
- **Connection banner:** if the server can't be reached, a line says so and keeps the last data, with
  **Try Again**. Coming back to the tab refreshes straight away.
- **Sign-in** tells a wrong password apart from a server that's down; **Show/Hide** on the password.
- **Rack Not Found** page for bad links, with the way back. **Loading** title while a rack loads.
- Offline racks explain why **Try a Tap** is off. One accent per screen (Place on Map is no longer orange).
- **Back** goes where you came from, or home if you arrived by link (never out of the app).
- Staff: **Recent Activity** on each rack, **Mark All Handled** on Alerts, a name search on Cards once
  there are more than five, empty states that say what to do next.

## Bugs found in the sweep (fixed)
- Settings → Open Staff App inside the phone frame built `?mode=staff?embed=1` (broken link).
- A failed map-style download was cached forever: every later map failed until a reload.
- Back used `history.length`, which counts other sites: it could leave the app.
- Two orange actions on the staff rack page (Try a Tap and Place on Map).
- Staff alert titles cut off the rack name ("Tamper alarm at ...").
- The terminal's filter buttons rendered as "[object HTMLButtonElement]" (nested arrays).
- The phone frame didn't give focus back to the button that opened it.

## Lessons from building it
- `el.append(arrayOfNodes)` stringifies the array ("[object HTMLButtonElement]"). Flatten first:
  `renderIfChanged` uses `.flat(Infinity)`.
- A form control named `name` is shadowed by `form.name`; use `form.elements.name`.
- An `<input>` with the same background as its form is invisible: step the tone up inside forms.
- Icons that share a silhouette (a hoop and a bell) read as the same thing. Draw them apart.
- `X-Frame-Options: DENY` blocks your *own* iframe. Use `SAMEORIGIN` + `frame-ancestors 'self'`.
- On Windows, write multi-line edit scripts to a file; shell heredocs with quotes break.

## How it was checked
Headless Microsoft Edge driven over the DevTools protocol (scratch scripts, not committed): sign in,
visit every page at phone (390 px, 2x) and desktop (1440 px) sizes, press Try a Tap mid-animation,
open the inline forms, step every Rive state in `/lab`, collect console errors.
