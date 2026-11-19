// Where the backend is, and the "Starting the Server" screen while it wakes up.
//
// Locally the backend serves these pages, so it's already up and this does nothing you can see.
// Hosted on Render's free plan, the API goes to sleep after 15 min with nobody using it and takes
// about a minute to start again. Every page waits for it here (api.js and rider.js call
// backendReady() before their first request), showing the screen only if it isn't answering.
import BACKEND_URL from "./backend-url.js";

const BASE = String(BACKEND_URL || "").trim().replace(/\/+$/, "");

/** apiUrl("/racks") -> "https://api.example/api/v1/racks", or this server's /api/v1/racks. */
export const apiUrl = (path) => `${BASE || window.location.origin}/api/v1${path}`;

const SHOW_AFTER_MS = 800;   // a backend that's awake answers well before this: no flash
const TRY_EVERY_MS = 2500;
const TRY_TIMEOUT_MS = 10000;
const EXPECTED_S = 60;       // typical cold start, for the bar
const HELP_AFTER_S = 180;

let ready = null;
let overlay = null;
let wantScreen = false;
const listeners = new Set();
export let backendState = "checking";   // checking | waking | ready

/** fn(state) on checking -> waking -> ready. */
export function onBackendState(fn) { listeners.add(fn); fn(backendState); return () => listeners.delete(fn); }
function setState(s) { backendState = s; for (const fn of listeners) { try { fn(s); } catch (e) { console.error(e); } } }

async function ping() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TRY_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl("/health"), { signal: ctl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolves once the backend answers. `screen: false` wakes it without the full-screen notice
 * (the front page, so the server is starting while you pick a version).
 */
export function backendReady({ screen = true } = {}) {
  if (screen) wantScreen = true;
  if (screen && backendState === "waking") showScreen();
  if (ready) return ready;
  ready = (async () => {
    const showTimer = setTimeout(() => { setState("waking"); if (wantScreen) showScreen(); }, SHOW_AFTER_MS);
    while (!(await ping())) {
      await new Promise((r) => setTimeout(r, TRY_EVERY_MS));
    }
    clearTimeout(showTimer);
    setState("ready");
    hideScreen();
  })();
  return ready;
}

function showScreen() {
  if (overlay || typeof document === "undefined") return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  overlay = el("div", "wake");
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  const card = el("div", "wake-card");
  const title = el("h1", "wake-title", "Starting the Server");
  const lead = el("p", "wake-lead", "HokieBikeRack's server sleeps when nobody has used it for a while. Waking it takes about a minute; this page opens by itself when it's ready.");
  const bar = el("div", "wake-bar");
  const fillEl = el("div", "wake-fill");
  bar.append(fillEl);
  const time = el("p", "wake-time", "Waiting 0 s");
  const help = el("p", "wake-help", "");
  help.hidden = true;
  card.append(title, lead, bar, time, help);
  overlay.append(card);
  document.body.append(overlay);
  const t0 = Date.now();
  overlay.timer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    time.textContent = `Waiting ${s} s`;
    fillEl.style.transform = `scaleX(${Math.min(0.95, s / EXPECTED_S)})`;
    if (s >= HELP_AFTER_S && help.hidden) {
      help.hidden = false;
      help.textContent = "This is taking longer than usual. Check the API service on the Render dashboard (is it deploying, or did it fail?), and that the site's HBR_BACKEND_URL and the API's HBR_ALLOWED_ORIGINS match.";
    }
  }, 500);
}

function hideScreen() {
  if (!overlay) return;
  clearInterval(overlay.timer);
  overlay.remove();
  overlay = null;
}
