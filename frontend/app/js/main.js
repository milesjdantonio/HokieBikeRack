// HokieBikeRack customer app: sign-in, the shell (top bar + tabs), routing, live refresh,
// the connection banner and the guided tours.
// Rider app: /app (Racks, My Card, Alerts, Settings). Staff app: /app?mode=staff
// (Health, Alerts, Cards, Settings). Screens live in rider.js and staff.js.
import { api, clearCredentials, hasCredentials, setCredentials, setUnauthorizedHandler } from "../../js/api.js";
import { clear, h } from "../../js/dom.js";
import { riveIcon } from "../../js/rive.js";
import * as rider from "./rider.js";
import * as staff from "./staff.js";
import { TOURS, resetTours, runTour } from "./tour.js";
import { button, icon, sound, switchControl, toast } from "./ui.js";

const params = new URLSearchParams(location.search);
const MODE = params.get("mode") === "staff" ? "staff" : "rider";
const EMBED = Boolean(params.get("embed"));
const root = document.querySelector("#app");
if (EMBED) document.documentElement.classList.add("embed");

const TABS = MODE === "staff"
  ? [["health", "Health", "health"], ["alerts", "Alerts", "alerts"], ["cards", "Cards", "card"], ["settings", "Settings", "settings"]]
  : [["racks", "Racks", "racks"], ["card", "My Card", "card"], ["alerts", "Alerts", "alerts"], ["settings", "Settings", "settings"]];
const HOME = `#${TABS[0][0]}`;

let current = null;     // { refresh?, destroy? } of the visible screen
let screenEl = null;
let banner = null;
let timer = null;
let routes = 0;         // screens shown this visit (so Back knows if there's somewhere to go)

const ctx = {
  mode: MODE,
  me: null,
  canEdit: false,
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  /** Back to where you came from, or home if you arrived straight here (never out of the app). */
  back() { if (routes > 1) history.back(); else ctx.go(HOME); },
  toast,
  setCount(n) { const el = document.querySelector('.tab[data-tab="alerts"] .count'); if (el) { el.textContent = String(n); el.hidden = !n; } },
  /** Shows or hides the "can't reach the server" banner. */
  connection(ok) { if (banner) banner.hidden = ok; },
};

/** Builds an address to this app (or the other mode), keeping the phone-frame flag. */
function appHref(mode, hash = "") {
  const q = new URLSearchParams();
  if (mode === "staff") q.set("mode", "staff");
  if (EMBED) q.set("embed", "1");
  const s = q.toString();
  return `./${s ? `?${s}` : ""}${hash}`;
}

// ---------- sign in ----------

function signIn(message = "") {
  stopTimer();
  clear(root);
  const mark = riveIcon("logo", { size: 112, label: "HokieBikeRack" });
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true });
  const show = h("button", { type: "button", class: "password-toggle", "aria-pressed": "false", onClick: () => {
    const visible = pass.type === "password";
    pass.type = visible ? "text" : "password";
    show.textContent = visible ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(visible));
    pass.focus();
  } }, "Show");
  const err = h("p", { class: "form-error", role: "alert" }, message);
  const submit = button("Sign In", null, { kind: "primary", type: "submit" });
  root.append(h("main", { class: "signin" }, h("form", { class: "signin-inner", onSubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.lastChild.textContent = "Signing In";
    err.textContent = "";
    setCredentials(user.value.trim(), pass.value);
    const result = await start();
    submit.disabled = false;
    submit.lastChild.textContent = "Sign In";
    if (result === "wrong") { err.textContent = "That username or password didn't work."; pass.select(); }
    else if (result === "offline") err.textContent = "Can't reach HokieBikeRack. Check that the server is running, then try again.";
  } },
  h("div", { class: "signin-mark" }, mark.el),
  h("h1", { class: "display" }, "HokieBikeRack"),
  h("p", { class: "muted" }, MODE === "staff"
    ? "Sign in with your staff account."
    : "Rider accounts are on the way. For now, sign in with a staff account."),
  h("label", { class: "field" }, h("span", {}, "Username"), user),
  h("label", { class: "field" }, h("span", {}, "Password"), h("span", { class: "password" }, pass, show)),
  err, submit)));
  user.focus();
}

/** Returns "ok", "wrong" (bad login) or "offline" (server unreachable). */
async function start() {
  try {
    ctx.me = await api("/me");
  } catch (e) {
    if (e.status !== 0) clearCredentials();
    return e.status === 0 ? "offline" : "wrong";
  }
  ctx.canEdit = Boolean(ctx.me.canEdit);
  shell();
  route();
  return "ok";
}

setUnauthorizedHandler(() => { clearCredentials(); ctx.me = null; signIn("You were signed out. Sign in again."); });

// ---------- shell ----------

function shell() {
  clear(root);
  const mark = riveIcon("logo", { size: 30 });
  mark.el.classList.add("brand-mark");
  const bar = h("header", { class: "bar" },
    h("a", { class: "brand", href: HOME, "aria-label": "HokieBikeRack home" },
      mark.el, "HokieBikeRack", MODE === "staff" ? h("span", { class: "bar-mode" }, "Staff") : null));
  banner = h("div", { class: "offline-banner", role: "status", hidden: true },
    "Can't reach HokieBikeRack. Showing the last data. ",
    h("button", { type: "button", class: "text-button", onClick: () => refreshNow() }, "Try Again"));
  screenEl = h("main", { class: "screen", id: "screen", tabindex: "-1" });
  const tabs = h("nav", { class: "tabs", "aria-label": "Sections" }, TABS.map(([key, label, ic]) =>
    h("button", { type: "button", class: "tab", dataset: { tab: key }, onClick: () => ctx.go(`#${key}`) },
      icon(ic), h("span", {}, label), key === "alerts" ? h("span", { class: "count", hidden: true }) : null)));
  root.append(bar, banner, screenEl, tabs);
}

// ---------- routing ----------

function route() {
  if (!ctx.me) return;
  routes++;
  const [name, arg, arg2] = (location.hash.slice(1) || TABS[0][0]).split("/");
  const tabKey = name === "rack" ? TABS[0][0] : name;
  for (const t of document.querySelectorAll(".tab")) {
    if (t.dataset.tab === tabKey) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  }
  if (current && current.destroy) current.destroy();
  clear(screenEl);
  screenEl.classList.remove("screen-enter");
  void screenEl.offsetWidth;  // restart the entrance
  screenEl.classList.add("screen-enter");
  window.scrollTo(0, 0);

  const screens = MODE === "staff"
    ? { health: staff.health, alerts: staff.alerts, cards: staff.cards, rack: rider.rack, settings }
    : { racks: rider.racks, rack: rider.rack, card: rider.card, alerts: rider.alerts, settings };
  const screen = screens[name] || screens[TABS[0][0]];
  try {
    current = screen(screenEl, ctx, arg, arg2) || null;
  } catch (err) {
    screenEl.append(h("p", { class: "empty" }, `Something went wrong: ${err.message}`));
    current = null;
  }
  screenEl.focus({ preventScroll: true });
  startTimer();
  maybeTour(name);
}

/** First visit to a screen with a tour: wait for its content, then run it once. */
function maybeTour(name) {
  const tourName = MODE === "staff" ? (name === "health" || !name ? "staff" : null)
    : (name === "racks" || !name ? "rider" : name === "rack" ? "rack" : null);
  if (!tourName || EMBED && tourName !== "rider" && tourName !== "staff") return;
  const at = location.hash;
  setTimeout(() => { if (location.hash === at && document.querySelector(".list .row, .stage")) runTour(tourName, TOURS[tourName]); }, 1400);
}

function refreshNow() {
  if (!current || !current.refresh) return Promise.resolve();
  return current.refresh().then(() => ctx.connection(true)).catch((e) => ctx.connection(!(e.status === 0 || e.status >= 500)));
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    // Don't refresh under someone's fingers.
    if (screenEl.querySelector(".form, .confirm") || document.querySelector(".tour")) return;
    refreshNow();
  }, 12000);
}
function stopTimer() { clearInterval(timer); }

addEventListener("hashchange", route);
// Coming back to the tab: refresh straight away instead of waiting up to 12 s.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ctx.me) refreshNow(); });

// ---------- settings (both apps) ----------

function settings(el) {
  const otherMode = MODE === "staff" ? "rider" : "staff";
  el.append(
    h("h1", { class: "display" }, "Settings"),
    h("div", { class: "list" },
      switchControl("Sound", sound.enabled, (on) => { sound.enabled = on; if (on) sound.granted(); }),
      h("div", { class: "row" }, h("span", { class: "row-icon" }, icon("person")),
        h("span", { class: "row-main" }, h("span", { class: "title" }, ctx.me.username), h("span", { class: "small muted" }, "Signed in")),
        h("span", { class: "row-side muted" }, ctx.canEdit ? "Admin" : "View Only"))),
    h("div", { class: "block btn-row" },
      button("Show the Tour Again", () => {
        resetTours();
        if (location.hash === HOME) route(); else ctx.go(HOME);
      }),
      h("a", { class: "btn", href: appHref(otherMode) }, otherMode === "staff" ? "Open Staff App" : "Open Rider App"),
      MODE === "staff" ? h("a", { class: "btn", href: "/", target: EMBED ? "_top" : null }, "Admin Console") : null),
    ctx.me?.loginRequired === false ? null
      : h("div", { class: "block" }, button("Sign Out", () => { clearCredentials(); ctx.me = null; signIn(); }, { kind: "quiet" })),
    h("p", { class: "block small faint" }, "Map data © OpenStreetMap contributors, OpenFreeMap. Imagery © Esri, Maxar, Earthstar Geographics. Place search by Photon (komoot). Fonts: Fraunces and Hanken Grotesk (SIL Open Font License)."));
  return null;
}

// ---------- go ----------

// Always try first: in demo mode (no website login) the server answers without a password, so
// nobody sees a sign-in screen. If it needs a login, this fails and the sign-in screen shows.
start().then((result) => {
  if (result === "offline") signIn("Can't reach HokieBikeRack. Check that the server is running, then sign in again.");
  else if (result !== "ok") signIn();
});
