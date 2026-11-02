// HokieBikeRack customer app: sign-in, the shell (top bar + tabs), routing and live refresh.
// Rider app: /app (Racks, My Card, Alerts, Settings). Staff app: /app?mode=staff
// (Health, Alerts, Cards, Settings). Screens live in rider.js and staff.js.
import { api, clearCredentials, hasCredentials, setCredentials, setUnauthorizedHandler } from "../../js/api.js";
import { clear, h } from "../../js/dom.js";
import { riveIcon } from "../../js/rive.js";
import * as rider from "./rider.js";
import * as staff from "./staff.js";
import { button, icon, sound, switchControl, toast } from "./ui.js";

const params = new URLSearchParams(location.search);
const MODE = params.get("mode") === "staff" ? "staff" : "rider";
const root = document.querySelector("#app");
if (params.get("embed")) document.documentElement.classList.add("embed");

const TABS = MODE === "staff"
  ? [["health", "Health", "health"], ["alerts", "Alerts", "alerts"], ["cards", "Cards", "card"], ["settings", "Settings", "settings"]]
  : [["racks", "Racks", "racks"], ["card", "My Card", "card"], ["alerts", "Alerts", "alerts"], ["settings", "Settings", "settings"]];

const ctx = {
  mode: MODE,
  me: null,
  canEdit: false,
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  toast,
  setCount(n) { const el = document.querySelector('.tab[data-tab="alerts"] .count'); if (el) { el.textContent = String(n); el.hidden = !n; } },
};

let current = null;     // { refresh?, destroy? } of the visible screen
let screenEl = null;
let timer = null;

// ---------- sign in ----------

function signIn(message = "") {
  stopTimer();
  clear(root);
  const mark = riveIcon("logo", { size: 112, label: "HokieBikeRack" });
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, value: "admin" });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true });
  const err = h("p", { class: "form-error", role: "alert" }, message);
  const submit = button("Sign In", null, { kind: "primary", type: "submit" });
  root.append(h("main", { class: "signin" }, h("form", { class: "signin-inner", onSubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    setCredentials(user.value.trim(), pass.value);
    const ok = await start();
    submit.disabled = false;
    if (!ok) { err.textContent = "That username or password didn't work."; pass.select(); }
  } },
  h("div", { class: "signin-mark" }, mark.el),
  h("h1", { class: "display" }, "HokieBikeRack"),
  h("p", { class: "muted" }, MODE === "staff"
    ? "Staff sign-in."
    : "Rider accounts are on the way. For now, sign in with a staff account."),
  h("label", { class: "field" }, h("span", {}, "Username"), user),
  h("label", { class: "field" }, h("span", {}, "Password"), pass),
  err, submit)));
  pass.focus();
}

async function start() {
  try {
    ctx.me = await api("/me");
  } catch {
    clearCredentials();
    return false;
  }
  ctx.canEdit = Boolean(ctx.me.canEdit);
  shell();
  route();
  return true;
}

setUnauthorizedHandler(() => { clearCredentials(); signIn("You were signed out. Sign in again."); });

// ---------- shell ----------

function shell() {
  clear(root);
  const mark = riveIcon("logo", { size: 30 });
  mark.el.classList.add("brand-mark");
  const bar = h("header", { class: "bar" },
    h("a", { class: "brand", href: "#", onClick: (e) => { e.preventDefault(); ctx.go(`#${TABS[0][0]}`); } },
      mark.el, "HokieBikeRack", MODE === "staff" ? h("span", { class: "bar-mode" }, "Staff") : null));
  screenEl = h("main", { class: "screen", id: "screen", tabindex: "-1" });
  const tabs = h("nav", { class: "tabs", "aria-label": "Sections" }, TABS.map(([key, label, ic]) =>
    h("button", { type: "button", class: "tab", dataset: { tab: key }, onClick: () => ctx.go(`#${key}`) },
      icon(ic), h("span", {}, label), key === "alerts" ? h("span", { class: "count", hidden: true }) : null)));
  root.append(bar, screenEl, tabs);
}

// ---------- routing ----------

function route() {
  if (!ctx.me) return;
  const [name, arg] = (location.hash.slice(1) || TABS[0][0]).split("/");
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
    current = screen(screenEl, ctx, arg) || null;
  } catch (err) {
    screenEl.append(h("p", { class: "empty" }, `Something went wrong: ${err.message}`));
    current = null;
  }
  screenEl.focus({ preventScroll: true });
  startTimer();
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (document.visibilityState !== "visible" || !current || !current.refresh) return;
    // Don't refresh under someone's fingers.
    if (screenEl.querySelector(".form, .confirm")) return;
    current.refresh().catch(() => {});
  }, 12000);
}
function stopTimer() { clearInterval(timer); }

addEventListener("hashchange", route);

// ---------- settings (both apps) ----------

function settings(el) {
  const other = MODE === "staff" ? ["Open Rider App", "./"] : ["Open Staff App", "./?mode=staff"];
  const embed = params.get("embed") ? (MODE === "staff" ? "&embed=1" : "?embed=1") : "";
  el.append(
    h("h1", { class: "display" }, "Settings"),
    h("div", { class: "list" },
      switchControl("Sound", sound.enabled, (on) => { sound.enabled = on; if (on) sound.granted(); }),
      h("div", { class: "row" }, h("span", { class: "row-icon" }, icon("person")),
        h("span", { class: "row-main" }, h("span", { class: "title" }, ctx.me.username), h("span", { class: "small muted" }, "Signed in")),
        h("span", { class: "row-side muted" }, ctx.canEdit ? "Admin" : "Viewer"))),
    h("div", { class: "block btn-row" },
      h("a", { class: "btn", href: other[1] + (other[1].includes("?") ? embed : embed.replace("&", "?")) }, other[0]),
      MODE === "staff" ? h("a", { class: "btn", href: "/", target: params.get("embed") ? "_top" : null }, "Admin Console") : null,
      button("Sign Out", () => { clearCredentials(); ctx.me = null; signIn(); }, { kind: "quiet" })),
    h("p", { class: "block small faint" }, "Map data © OpenStreetMap contributors, OpenFreeMap. Imagery © Esri, Maxar, Earthstar Geographics. Fonts: Fraunces and Hanken Grotesk (SIL Open Font License)."));
  return null;
}

// ---------- go ----------

if (hasCredentials()) start().then((ok) => { if (!ok) signIn(); });
else signIn();
