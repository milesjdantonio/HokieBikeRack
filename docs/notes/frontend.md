# Frontend notes (HTML, CSS, JavaScript; no build step)

## Files
```
frontend/
  index.html        login screen + app shell (top bar, tabs)
  styles.css        everything visual, incl. the phone frame
  favicon.svg
  js/main.js        login, routing (#overview, #events…), live indicator
  js/api.js         fetch wrapper: adds the login header, turns errors into messages
  js/ui.js          h() element builder, formatting, badges, modal, toast
  js/views/*.js     one file per page (overview, events, racks, cards, reports, audit)
  js/app-preview.js the phone-style Rider/Admin app
```
The backend serves this folder at `http://localhost:8080/` (see
`spring.web.resources.static-locations` in `application.yml`). Same origin as the
API, so no CORS setup is needed.

## No build step
Browsers understand `<script type="module">` and `import` natively. No npm, no
bundler: edit a file, refresh. Trade-off: no TypeScript, no hot reload.

## Routing with the URL hash
`#events?rackId=…` → `main.js` reads `location.hash`, calls
`views/events.js render(container, ctx)`. Each view may return `{ cleanup }`
to stop its 10-second refresh timer when you leave.

## XSS safety: never `innerHTML` with data
Card labels and rack names are typed by people. If we did
`row.innerHTML = "<td>" + label + "</td>"`, a label like
`<img src=x onerror=alert(1)>` would run code. Instead `h("td", {}, label)`
creates elements and inserts text with `append()`, which is always treated as text.
CSP (`default-src 'self'`) is the second safety net.

## Login storage
After a successful `GET /api/v1/me`, the Base64 `username:password` is kept in
`sessionStorage` (cleared when the tab closes; readable only by this site).
Fine for a local demo. A real deployment would use HTTPS plus short-lived
session tokens, because Basic auth sends the password with every request.

## Viewer vs admin
`/api/v1/me` returns `canEdit`. Viewers don't see edit buttons, but **the
backend is what actually blocks them** (403). Never rely on hiding buttons.

## App preview
`📱 App preview` opens a phone frame with two modes:
- **Rider app:** racks with live lock status, rack detail with how-to-unlock and
  24 h activity, "My card" (pick which registered card is "you", since rider accounts
  don't exist yet), tamper alerts at your racks.
- **Admin app:** rack health counts, live alerts with ✓ acknowledge,
  unknown taps with Register, quick revoke.
It uses the same live API. No fake bike occupancy (there's no bike sensor);
sample-only bits are labeled "PREVIEW ONLY" / "(sample)".

## How it was checked
Headless Microsoft Edge driven through the Chrome DevTools Protocol: log in as
admin and viewer, visit every page, open the preview, take screenshots, collect
console errors. Found and fixed: the preview rendering `[object HTMLDivElement]`
(passed an array to `append`), an unreadable Sign-out button, table borders broken
by `display:flex` on a `<td>`, missing favicon.

**Lesson:** `el.append(arrayOfNodes)` converts the array to text. Use `el.append(...nodes)`.
Another one: a form control named `name` is shadowed by `form.name` (the form's
own name attribute). Use `form.elements.name`.

## Animated icons with Rive (Phase 7)
Idea and tooling borrowed from Miles's **TerraSim** project.
- **Rive** is an animation format with *state machines*: an animation reacts to inputs
  (`unlocked = true`, `status = 2`) instead of just playing.
- The `.riv` files are **generated from code**: `tools/rive/art/{lock,alarm,pulse}.mjs` describe
  shapes, keyframes and state machines; `node tools/rive/build.mjs` writes
  `frontend/assets/rive/*.riv`. Animations are reviewable in Git like any code.
- `frontend/js/rive.js` mounts one: `riveIcon("lock", { size: 26, inputs: { unlocked: true } })`.
  If Rive fails, a CSS fallback (dot / emoji) stays visible, so nothing breaks.
- Icons are cleaned up automatically when a view re-renders (`sweep()`), otherwise every
  10-second refresh would leak a canvas + animation loop.
- The runtime is WebAssembly, so the CSP needs `'wasm-unsafe-eval'` (allows compiling WASM,
  still blocks `eval()` of JavaScript strings).
- Respects *reduce motion*: animations pause after settling, and CSS motion is disabled.
- Preview them at http://localhost:8080/lab/rive.html.

| File | Input | Where it's used |
|---|---|---|
| `pulse.riv` | `status` 0 offline / 1 online / 2 warning | Live chip, rack cards, device rows, app rack lists |
| `lock.riv` | `unlocked` true/false | Login (opens on sign-in), device health (from heartbeat), rider app "Try a tap" |
| `alarm.riv` | `active` true/false | Rack cards with open alerts, device health, app alert lists |
