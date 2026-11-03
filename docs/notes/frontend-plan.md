# Frontend plan (agreed with Miles, 2026-11-02)

Why: Miles found the Phase 8/9 pages "very hard to navigate, doesn't make sense, and the design just
isn't good" (terminal page, sign-in/tours, finding how to do things). We talked through every page
before rebuilding anything. This file is the agreed target; build to it.

Audience for Tuesday: a rough demo for the professor only. Both apps matter equally.

## Two front ends (was four)
| Site | For | Replaces |
|---|---|---|
| **Admin site** | Miles / staff on a laptop | the black terminal page **and** the staff app |
| **Rider app** | students | the current rider app (cleaned up) |
The Rive lab stays as a developer tool only (not linked from either site).

## Admin site
- **Home = live campus map** (racks as pins) with a **terminal panel down the right side** and a
  **"Needs you" strip** along the bottom (open alerts, unknown cards to register).
- **Click a rack** → a panel **slides in over the left of the map** with everything about it:
  status, alerts (Handled), its lock module and health, cards that work there, register a waiting
  card, Move on Map, add a lock module (token shown once). The map stays visible behind it.
- **Top bar:** Map (home), **Reports**, **Audit log**. No separate Cards or Activity pages: cards
  are handled in the rack panel, the Needs-you strip and the terminal; history is in the terminal.
- **Terminal panel:** a live feed of every tap, alarm and check-in, plus a **prompt for typed
  commands**. Everything a command does also has a button somewhere. Includes **demo commands** that
  fake a tap or a shake at a rack (marked simulated), so the demo works even if the hardware doesn't.
  Draft command list: `help`, `racks`, `tap <rack> [card]`, `shake <rack>`, `register <card> <name> [rack]`,
  `ack <rack|all>`, `revoke <name>`, `place <rack>`, `clear`.
- **Rive for warnings:** (1) the rack's pin on the map animates when it's alarming, (2) a **big pop-up
  card** slides in when a new alarm happens, (3) animated badges next to alarm lines in the terminal.
- **Sign-in:** one login screen. **No tours**; each screen says what to do next in plain words.
- **Look:** two mockups to compare first (Miles: "show me both"): A = same family as the rider app
  (maroon-black, orange actions); B = darker "control room" (near-black, cooler greys, brighter status).
- **Chosen: B1 "floating"** (2026-11-02, over A, B2 docked and B3 night map). Miles's notes: "needs
  work", "a lot of Rive animations", and a selected rack must centre in the part of the map you can
  see beside the panel, not the middle of the window. Build from `frontend/mockups/` (B1):
  - Rive: `pin.riv` on every rack (status colour, alarm shudder, check/cross on taps, selection),
    `rack.riv` scene at the top of the panel and in the alarm pop-up, `badge.riv` on every terminal
    line / Needs You item / alert / card, `signal.riv` for module Wi-Fi and the terminal header
    (flicks on each new line), `logo.riv` in the top bar. Motion only answers events; nothing idles.
  - Map: `rackMap().setInset({ left: panel + gaps, bottom: tray })` when the panel opens.
  - Needs You is a floating tray along the bottom of the map with a count; the alarm pop-up shows
    a 10 s siren countdown; the panel has demo buttons (Test Tap / Wrong Card / Shake).

## Rider app
- **No login to see racks**: anyone can open the map and rack pages (names, locations, status only;
  nothing personal). Needs a public read-only API for racks. My Card stays a preview until rider
  accounts exist.
- **Screens kept:** Map of racks, Rack page with the animation, My Card, Alerts.
- **Home:** map on top, list below (as now), cleaner.
- No tours (same rule as admin).

## Build order
1. Two static admin mockups (A/B) → Miles picks.
2. Public read-only racks API for the rider app (+ tests).
3. Admin site: shell + map + terminal feed → rack panel → Needs-you strip → commands → Rive warnings → Reports/Audit.
4. Rider app cleanup: no login, no tours, simpler navigation.
5. Remove the old terminal page and staff app; update docs and the demo script.
