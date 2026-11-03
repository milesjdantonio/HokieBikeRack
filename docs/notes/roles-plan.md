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

## Open questions (defaults in use)
- Staff vs admin: is the split above right? (Default: staff respond, admin configures.)
- Police: should they see every tamper alarm, or only ones an admin/staff alerted them about?
  (Default: alerted incidents first, live alarms below as "not reported yet".)
- Should riders see that police were alerted at a rack? (Default: no, just "Alarm, staff alerted".)
