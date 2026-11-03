# Four versions: Admin, Staff, Police, Rider (Phase 11)

Miles, 2026-11-02: "make this [the B1 mockup] the actual admin version and let's make a new rider
version, police, and staff version, all with app and browser version. The app for the admin needs to
be more intuitive." Also: the map pin changes when police were notified, "like a flashing red and blue".

Miles asked me not to block on questions, so the role split below is **my default**. Change anything
here and the build follows it. Open questions are at the bottom.

## Who each version is for
| Version | URL | Who | Can do |
|---|---|---|---|
| **Admin** | `/admin/` | Miles / whoever runs the system | Everything: racks, lock modules (tokens), cards, move racks, confirm online, alerts, Alert Authorities, terminal + Commands, Reports, Audit Log |
| **Staff** | `/staff/` | Campus parking / transportation staff on patrol | Respond: see the map and Needs You, mark alerts handled, register a waiting card, confirm a rack back online (they're there in person), Alert Authorities. No tokens, no moving racks, no audit log, no terminal |
| **Police** | `/police/` | VT Police | Incidents only: racks where the authorities were alerted (and live tamper alarms), where they are, what happened (timeline), and their own status: On My Way, On Scene, Resolved. No card or rider data |
| **Rider** | `/rider/` | Students | No login. Map of racks, rack page (live scene, status), My Card (preview), Alerts. Nothing personal about other people |

`/` is a short "Who are you?" page with the four. Login is off for the demo (anyone can open any
version); with `HBR_LOGIN_REQUIRED=true` the backend still enforces admin vs read-only.

## App and browser
Every version has both. The **browser** version uses the wide layout; the **app** version is a phone
layout with a bottom tab bar. It switches automatically on a narrow screen, and `?view=app` forces it
on a laptop (each version has an "App View" / "Desktop" switch).

## Admin app: more intuitive (Miles said the long single page was hard to use)
Bottom tabs, one job each:
- **Now**: what needs you, biggest first. An alarm shows as numbered next steps with big buttons.
  When nothing needs you it says so, plainly.
- **Racks**: one card per rack with its data; tap for details and actions.
- **Terminal**: the feed and the prompt (with a Commands button).
- **More**: Commands, Reports, Audit Log, switch version.

## Police notified
- Map pin: new pin.riv status 4, the ring and badge **flash red and blue** (police lights).
- Backend: an **incident** per Alert Authorities (`incidents` table): ALERTED → EN_ROUTE → ON_SCENE →
  RESOLVED, with who/when and a note. Admin/staff create it; police move it along. Nothing is sent to
  the real VT Police; that would be a later integration (dispatch system, phone, or email).

## Build order (also in BUILD_PLAN.md Phase 11)
1. Plan (this file). Pin police state (flashing red/blue) in the mockup.
2. Backend: incidents + rack `openAlarms` / `incident` fields + tests.
3. Shared front-end pieces (theme, map, Rive, live polling, phone tab bar).
4. Admin, real data (browser + app with tabs).
5. Staff (browser + app). 6. Police (browser + app). 7. Rider, new design (browser + app).
8. `/` chooser, remove the old pages, docs, demo script, checks, push.

## Also asked for while building (2026-11-02)
- Every rack shows **open spots** and **alarm (active now / last alarm)**, above all for riders.
  Spots are counted from taps (park / leave alternate); admins set the number and can reset it.
- A **rename** option (racks, cards, lock modules; `rename <rack> <new name>`).
- An **Add Rack** button and an `add <name>` command.
- Every admin function works, including Reports and the Audit Log.

## Riders and sign-up (Miles, 2026-11-02)
- "It should give a warning if the user's bike is stored there": riders now exist (V7). The rider app
  shows where your bike is parked (tap in / tap out) and a red warning + toast when that rack has an
  alarm or a police report.
- "Someone could register themselves online through StarRez, which we don't have access to, through a
  form ... it connects to their HokieP": the rider app's **Request Access** form stands in for StarRez
  (name, VT email, Hokie Passport ID). Admin approves in Needs You (or `approve <name>`). The rider then
  presses **Link My HokieP** and taps it on any rack within 2 minutes; that tap becomes their card for
  all racks. The server never sees raw card IDs (only keyed fingerprints), so without a StarRez / Hokie
  Passport feed this one tap is how the card gets connected. With such a feed the tap step goes away.
- No passwords: the rider's private code (e.g. K7P2-QM4X) is kept on their phone and is the key.
  Cards registered by staff can get a code too (Rider Code button on the card).
- Real-life test steps: hardware-test-checklist.md section 7.

## Open questions (defaults in use)
- Staff vs admin: is the split above right? (Default: staff respond, admin configures.)
- Police: should they see every tamper alarm, or only ones an admin/staff alerted them about?
  (Default: alerted incidents first, live alarms below as "not reported yet".)
- Should riders see that police were alerted at a rack? (Default: no, just "Alarm, staff alerted".)
- Hokie Passport: does the PN532 read it with a steady ID? (Checklist 7. If not: kit cards for the demo.)
- ~~Linking gives the HokieP all racks, or specific racks?~~ Decided: **every rack** (Miles).
- Spots: one per lock module unless an admin sets a number. Is tap-in / tap-out the right way to count
  until the rack has a bike sensor?
