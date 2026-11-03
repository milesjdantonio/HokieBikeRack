// Admin mockup, style B1. Sample data only: nothing here is saved or sent anywhere. Miles can click
// through the layout and see every animation before the real admin site is built on the same pieces.
// Desktop: admin.html      App (phone): admin.html?view=app
//
// Rive used on this page:
//   logo.riv    brand mark, builds itself once on load
//   pin.riv     every rack on the map: status colour, alarm shudder, check/cross on a tap, selection
//   rack.riv    the live rack scene at the top of the rack panel
//   shake.riv   the panel that drops in from the top when a rack is shaken (amber) or alarming (red)
//   police.riv  Alert Authorities: the shield sends, then a check
//   badge.riv   every terminal line, Needs You item, alert and card
//   signal.riv  terminal header (flicks on each new line) and each lock module's Wi-Fi strength
import { riveIcon } from "../js/rive.js";
import { rackMap } from "../app/js/map.js";
import { h } from "../js/dom.js";

const APP = new URLSearchParams(location.search).get("view") === "app";
document.body.classList.toggle("view-app", APP);
const switcher = document.querySelector("#view-switch");
switcher.textContent = APP ? "Desktop" : "App View";
switcher.href = APP ? "?" : "?view=app";

const BADGE = { info: 0, ok: 1, denied: 2, warning: 3, alarm: 4, offline: 5, card: 6, police: 7 };
const SCENE = { idle: 0, granted: 1, denied: 2, alarm: 3, offline: 4 };
const AUTHORITY = "VT Police";
const clock = (d = new Date()) => d.toTimeString().slice(0, 5);

const racks = [
  { id: "squires", name: "Squires North", place: "Squires Student Center, north side", status: "WARNING",
    latitude: 37.22975, longitude: -80.41835, signal: 3, rssi: -55, lastSeen: "12 s ago", unlocks: 14,
    alerts: [{ id: 1, kind: "warning", title: "Rack Bumped", detail: "Jolt of 0.62 g, 3 min ago" }],
    cards: [{ name: "Demo Rider", detail: "Used 2 min ago", on: true }] },
  { id: "newman", name: "Newman Library", place: "Newman Library, front steps", status: "ONLINE",
    latitude: 37.22868, longitude: -80.41925, signal: 4, rssi: -48, lastSeen: "8 s ago", unlocks: 22, waiting: "f02f1d68",
    alerts: [], cards: [{ name: "Miles D.", detail: "Used 1 h ago", on: true }, { name: "Old Test Card", detail: "Turned off", on: false }] },
  { id: "torgersen", name: "Torgersen Hall North", place: "Torgersen Hall, by the bridge", status: "OFFLINE",
    latitude: 37.22995, longitude: -80.41985, signal: 0, rssi: null, lastSeen: "14 min ago", unlocks: 3,
    alerts: [], cards: [{ name: "Demo Rider", detail: "Used yesterday", on: true }] },
  { id: "drillfield", name: "Drillfield South", place: "Drillfield, by Burruss Hall", status: "WARNING",
    latitude: 37.22745, longitude: -80.42245, signal: 1, rssi: -79, lastSeen: "20 s ago", unlocks: 6, waiting: "3b9e0a12",
    alerts: [{ id: 2, kind: "warning", title: "Weak Wi-Fi", detail: "Signal -79 dBm for 20 min" }], cards: [] },
  { id: "goodwin", name: "Goodwin Hall", place: "Goodwin Hall, Old Turner St entrance", status: "UNCONFIRMED",
    latitude: 37.23255, longitude: -80.42535, signal: 3, rssi: -60, lastSeen: "40 s ago", unlocks: 0, back: "after 2 h offline",
    alerts: [], cards: [{ name: "Demo Rider", detail: "Used 3 h ago", on: true }] },
];
for (const r of racks) { r.alarm = false; r.police = null; }
const byId = (id) => racks.find((r) => r.id === id || r.name.toLowerCase().startsWith(String(id).toLowerCase()));
let alertSeq = 10;
const isOnline = (r) => r.status === "ONLINE" || r.status === "WARNING";

// ---------- top bar ----------
document.querySelector("#brand-mark").append(riveIcon("logo", { size: 28 }).el);
function renderSummary() {
  const alarms = racks.filter((r) => r.alarm).length;
  document.querySelector("#summary").replaceChildren(h("b", {}, `${racks.filter(isOnline).length} of ${racks.length}`), " racks online",
    alarms ? h("span", { class: "state-alarm" }, ` · ${alarms} alarm${alarms > 1 ? "s" : ""}`) : "");
}

// ---------- pages: Map | Commands ----------
const sheet = document.querySelector("#commands");
function showPage(page) {
  sheet.hidden = page !== "commands";
  for (const a of document.querySelectorAll(".top-nav a")) {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (page === "commands") sheet.scrollTop = 0;
}
for (const a of document.querySelectorAll("[data-page]")) {
  a.addEventListener("click", (e) => {
    const page = a.dataset.page;
    if (page === "reports" || page === "audit") { e.preventDefault(); return; }   // not in this mockup
    e.preventDefault();
    showPage(page === "commands" && !sheet.hidden ? "map" : page);
  });
}

// ---------- map (desktop only) ----------
const map = APP ? null : rackMap(document.querySelector("#map"), {
  look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" },
  onSelect: (r) => openRack(r.id),
});
const mapArea = document.querySelector(".map-area");
const refreshMap = () => map?.setRacks(racks.map((r) => ({ ...r })));

// ---------- rack panel (desktop) ----------
const panel = document.querySelector("#panel");
const panelBody = document.querySelector("#panel-body");
const scene = APP ? null : riveIcon("rack", { size: 380, height: 180, fit: "cover", align: "BottomCenter", inputs: { state: 0 }, label: "The rack, live" });
if (scene) document.querySelector("#panel-scene").append(scene.el);
let openId = null;
let sceneTimer = null;

const sceneFor = (r) => (r.alarm ? SCENE.alarm : isOnline(r) ? SCENE.idle : SCENE.offline);
function playScene(state, ms) {
  if (!scene) return;
  clearTimeout(sceneTimer);
  scene.set("state", state);
  if (ms) sceneTimer = setTimeout(() => { const r = byId(openId); if (r) scene.set("state", sceneFor(r)); }, ms);
}

function openRack(id) {
  const r = byId(id);
  if (!r) return;
  showPage("map");
  if (APP) { document.querySelector(`#card-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  stopMove(false);
  const wasOpen = !panel.hidden;
  openId = r.id;
  panel.hidden = false;
  mapArea.classList.add("panel-open");
  if (!wasOpen) { panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = ""; }
  renderPanel();
  renderNeeds();
  playScene(sceneFor(r));
  // The panel covers the left of the map: centre the rack in the part that's still visible.
  map.setInset({ left: 380 + 16 * 2 }, { duration: 0 });
  map.select(r.id);
}
function closeRack() {
  stopMove(false);
  panel.hidden = true;
  mapArea.classList.remove("panel-open");
  openId = null;
  map.select(null, { move: false });
  renderNeeds();
  map.setInset({ left: 0 });
}
document.querySelector("#panel-close").addEventListener("click", closeRack);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!sheet.hidden) showPage("map");
  else if (moving) stopMove(false);
  else if (!panel.hidden) closeRack();
});

function stateLine(r) {
  if (r.alarm) return h("div", { class: "state state-alarm" }, h("span", {}, r.police ? `Alarm. ${AUTHORITY} alerted at ${r.police}.` : "Alarm. Someone is tampering with this rack."));
  if (r.status === "UNCONFIRMED") return h("div", { class: "state state-warning" },
    h("span", {}, `Back online ${r.back}, not confirmed. Check it in person, then confirm.`));
  if (r.status === "OFFLINE") return h("div", { class: "state state-offline" }, "Offline for 14 min. It keeps working on its saved card list for 72 h.");
  if (r.alerts.length) return h("div", { class: "state state-warning" }, `Needs a look: ${r.alerts.length} open alert${r.alerts.length > 1 ? "s" : ""}.`);
  return h("div", { class: "state" }, "Working. Cards tap in normally.");
}

const btn = (label, onClick, cls = "") => h("button", { class: `btn ${cls}`, type: "button", onClick }, label);

/** Buttons for what this rack needs right now (shared by the panel and the app's rack cards). */
function rackActions(r) {
  return [
    r.alarm && !r.police ? btn("Alert Authorities", () => askAuthorities(r), "btn-police") : null,
    r.status === "UNCONFIRMED" ? btn("Confirm Online", () => confirmOnline(r), "btn-primary") : null,
    r.waiting ? btn(`Register Card ${r.waiting}`, () => register(r), r.status === "UNCONFIRMED" ? "" : "btn-primary") : null,
    r.alerts.length ? btn(`Mark ${r.alerts.length > 1 ? "All " : ""}Handled`, () => ack(r)) : null,
  ];
}

function renderPanel() {
  const r = byId(openId);
  if (!r || APP) return;
  panel.setAttribute("aria-label", r.name);
  const alerts = r.alerts.length
    ? h("div", { class: "list" }, r.alerts.map((a) => {
      const badge = riveIcon("badge", { size: 22, inputs: { kind: BADGE[a.kind] } });
      const row = h("div", { class: "item" }, badge.el,
        h("span", { class: "item-main" }, h("b", {}, a.title), h("span", {}, a.detail)),
        btn("Handled", () => handled(r, a, badge, row)));
      return row;
    }))
    : h("p", { class: "empty" }, "No open alerts.");

  const sig = riveIcon("signal", { size: 22, inputs: { level: r.signal } });
  const module = h("div", { class: "list" }, h("div", { class: "item" }, sig.el,
    h("span", { class: "item-main" }, h("b", {}, "ESP32 #1"),
      h("span", {}, r.status === "OFFLINE" ? `Last heard ${r.lastSeen}` : `All sensors working, signal ${r.rssi} dBm`)),
    r.status === "OFFLINE" ? h("span", { class: "off" }, "Offline")
      : r.status === "UNCONFIRMED" ? h("span", { class: "st-UNCONFIRMED" }, "Not Confirmed") : h("span", { class: "ok" }, "Online")));

  const waiting = r.waiting ? [h("h2", {}, "Waiting to Register"), h("div", { class: "list" }, h("div", { class: "item" },
    riveIcon("badge", { size: 22, inputs: { kind: BADGE.card } }).el,
    h("span", { class: "item-main" }, h("b", {}, `Card ${r.waiting}`), h("span", {}, "Tapped here 2 min ago")),
    btn("Register", () => register(r), "btn-primary")))] : [];

  const cards = r.cards.length
    ? h("div", { class: "list" }, r.cards.map((c) => h("div", { class: "item" },
      riveIcon("badge", { size: 22, inputs: { kind: c.on ? BADGE.ok : BADGE.denied } }).el,
      h("span", { class: "item-main" }, h("b", {}, c.name), h("span", {}, c.detail)),
      btn(c.on ? "Turn Off" : "Turn On", () => {
        c.on = !c.on; c.detail = c.on ? "Turned on just now" : "Turned off";
        log(c.on ? "ok" : "info", `<b>${r.id}</b> ${c.name} turned ${c.on ? "on" : "off"}`);
        changed(r);
      }, "btn-quiet"))))
    : h("p", { class: "empty" }, "No cards yet. Tap a new card on this rack, then register it here.");

  const top = rackActions(r).filter(Boolean);
  panelBody.replaceChildren(
    h("h1", { class: "panel-title" }, r.name),
    h("p", { class: "panel-sub" }, r.place),
    stateLine(r),
    top.length ? h("div", { class: "panel-actions panel-now" }, top) : null,
    h("h2", {}, "Alerts"), alerts,
    ...waiting,
    h("h2", {}, "Lock Module"), module,
    h("h2", {}, "Cards That Work Here"), cards,
    h("div", { class: "panel-actions" },
      btn("Move on Map", () => startMove(r)),
      btn("Add Lock Module", () => log("info", `<b>${r.id}</b> new lock module: token shown once in the real site`))),
  );
}

// ---------- actions (each one also has a terminal command) ----------
function handled(r, a, badge, row) {
  badge.set("kind", BADGE.ok);            // the warning turns into a check, then the row leaves
  row.querySelector("button").disabled = true;
  setTimeout(() => row.classList.add("leaving"), 650);
  setTimeout(() => {
    r.alerts = r.alerts.filter((x) => x !== a);
    if (a.kind === "alarm") { r.alarm = false; hideDrop(r.id); }
    if (!r.alerts.length && r.status === "WARNING") r.status = "ONLINE";
    log("ok", `<b>${r.id}</b> ${a.title.toLowerCase()} marked handled`);
    changed(r);
  }, 950);
}
function ack(r) {
  r.alerts = []; r.alarm = false; if (r.status === "WARNING") r.status = "ONLINE";
  hideDrop(r.id);
  log("ok", `<b>${r.id}</b> alerts marked handled`);
  changed(r);
}
function register(r, name = "New Rider") {
  const card = r.waiting;
  r.waiting = null;
  r.cards.unshift({ name, detail: "Registered just now", on: true });
  log("ok", `registered card ${card} as ${esc(name)} at <b>${r.id}</b>. racks sync within a minute`);
  changed(r);
}
function confirmOnline(r) {
  if (r.status !== "UNCONFIRMED") { log("info", `<b>${r.id}</b> isn't waiting to be confirmed`); return; }
  r.status = r.alerts.length ? "WARNING" : "ONLINE";
  r.back = null;
  log("ok", `<b>${r.id}</b> confirmed online by admin`);
  changed(r);
}

// Alert Authorities: always asks first. In the mockup nothing is really sent.
function askAuthorities(r) {
  if (!r.alarm || r.police) return;
  if (APP) { if (window.confirm(`Alert ${AUTHORITY} about ${r.name}?`)) alertAuthorities(r); return; }
  showDrop(r, "confirm");
}
function alertAuthorities(r) {
  if (!r.alarm || r.police) return;
  r.police = clock();
  log("police", `<b>${r.id}</b> alerting ${AUTHORITY}: tamper alarm at ${esc(r.name)}`);
  showDrop(r, "police");
  setTimeout(() => {
    log("police", `<b>${r.id}</b> ${AUTHORITY} alerted at ${r.police} by admin`);
    if (dropState.rack === r.id && dropState.level === "police") showDrop(r, "police-sent");
    changed(r);
  }, 2100);
  changed(r);
}

// ---------- Move on Map ----------
const moveBar = document.querySelector("#move-bar");
let moving = null;
function startMove(r) {
  stopMove(false);
  const text = document.querySelector("#move-text");
  text.textContent = `Click the map or drag the pin to move ${r.name}.`;
  moving = { rack: r, spot: null, handle: map.startMove(r.id, (p) => {
    moving.spot = p;
    text.textContent = `New spot ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}. Save it?`;
  }) };
  moveBar.hidden = false;
}
function stopMove(keep) {
  if (!moving) return;
  const { rack: r, spot, handle } = moving;
  moving = null;
  moveBar.hidden = true;
  handle.stop(keep && !!spot);
  if (keep && spot) {
    r.latitude = spot.latitude; r.longitude = spot.longitude;
    log("ok", `<b>${r.id}</b> moved on the map to ${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)}`);
    changed(r);
  }
}
document.querySelector("#move-save").addEventListener("click", () => stopMove(true));
document.querySelector("#move-cancel").addEventListener("click", () => stopMove(false));

/** Something about a rack changed: update the pin, the panel, Needs You, steps, cards and the summary. */
function changed(r) {
  refreshMap();
  if (openId === r.id) { renderPanel(); playScene(sceneFor(r)); }
  renderNeeds();
  renderSummary();
  renderSteps();
  renderCards();
}

// ---------- drop panel: shake (amber) / alarm (red) / authorities ----------
const drop = document.querySelector("#drop");
const dropScene = document.querySelector("#drop-scene");
const dropState = { rack: null, level: null, anim: null, timer: null };
function dropAnim(name, inputs) {
  // Re-uses the animation if it's already showing (so going amber -> red animates instead of restarting).
  if (dropState.anim?.name !== name) {
    const a = riveIcon(name, { size: 150, height: 100, inputs });
    dropScene.replaceChildren(a.el);
    dropState.anim = { name, a };
  } else for (const [k, v] of Object.entries(inputs)) dropState.anim.a.set(k, v);
}
function showDrop(r, level) {
  if (APP) return;
  clearTimeout(dropState.timer);
  const fresh = drop.hidden || drop.classList.contains("leaving");
  dropState.rack = r.id; dropState.level = level;
  drop.classList.remove("leaving", "bump", "alarm", "police");
  const title = document.querySelector("#drop-title");
  const where = document.querySelector("#drop-where");
  const extra = document.querySelector("#drop-extra");
  const actions = document.querySelector("#drop-actions");
  const open = btn("Open Rack", () => openRack(r.id));
  const dismiss = btn("Dismiss", () => hideDrop(), "btn-quiet");
  if (level === "bump") {
    drop.classList.add("bump");
    dropAnim("shake", { level: 0 });
    title.textContent = "Shake Detected";
    where.textContent = `${r.name} · jolt 0.62 g · warning chirp played`;
    extra.replaceChildren(h("span", { class: "drop-note" }, "If it keeps shaking, the rack sounds its siren."));
    actions.replaceChildren(open, dismiss);
    dropState.timer = setTimeout(() => { if (dropState.level === "bump") hideDrop(); }, 9000);
  } else if (level === "alarm") {
    drop.classList.add("alarm");
    dropAnim("shake", { level: 1 });
    title.textContent = "Tamper Alarm";
    where.textContent = `${r.name} · jolt 1.31 g · just now`;
    extra.replaceChildren(h("span", { class: "siren" }, h("span", { class: "siren-bar" })), h("span", { class: "drop-note" }, "Siren on for 10 s. The alarm stays open until handled."));
    actions.replaceChildren(btn("Alert Authorities", () => askAuthorities(r), "btn-police"), open, dismiss);
  } else if (level === "confirm") {
    drop.classList.add("alarm");
    title.textContent = `Alert ${AUTHORITY}?`;
    where.textContent = `About the tamper alarm at ${r.name}.`;
    extra.replaceChildren(h("span", { class: "drop-note" }, "Only if someone may be stealing a bike. Mockup: nothing is really sent."));
    actions.replaceChildren(btn("Alert Now", () => alertAuthorities(r), "btn-danger"), btn("Cancel", () => showDrop(r, "alarm"), "btn-quiet"));
  } else if (level === "police" || level === "police-sent") {
    drop.classList.add("police");
    dropAnim("police", { state: 1 });
    const sent = level === "police-sent";
    title.textContent = sent ? `${AUTHORITY} Alerted` : `Alerting ${AUTHORITY}…`;
    where.textContent = sent ? `${r.name} · sent at ${r.police} by admin` : r.name;
    extra.replaceChildren(h("span", { class: "drop-note" }, sent ? "Logged in the terminal and the audit log. Keep the rack open to follow it." : "Sending the rack, the time and the alarm details."));
    actions.replaceChildren(open, dismiss);
  }
  drop.hidden = false;
  if (fresh) { drop.style.animation = "none"; void drop.offsetWidth; drop.style.animation = ""; }
}
function hideDrop(rackId) {
  if (drop.hidden || (rackId && dropState.rack !== rackId)) return;
  clearTimeout(dropState.timer);
  drop.classList.add("leaving");
  setTimeout(() => { if (drop.classList.contains("leaving")) { drop.hidden = true; drop.classList.remove("leaving"); dropScene.replaceChildren(); dropState.anim = null; } }, 320);
}

// ---------- Needs You (right column) ----------
// A vertical list grouped by kind, most urgent first, so it can grow without hiding anything:
// it scrolls, every row is a button (Tab / Enter), and the header folds it away.
const needsEl = document.querySelector("#needs");
const needsBox = document.querySelector(".needs");
const needsShown = new Map();   // key -> row element (kept, so each badge animates only when it first appears)
const GROUPS = [
  { kind: "alarm", title: "Alarms" },
  { kind: "confirm", title: "Back Online: Confirm" },
  { kind: "card", title: "Cards to Register" },
  { kind: "warning", title: "Alerts" },
  { kind: "offline", title: "Offline" },
];
const NEED_BADGE = { alarm: "alarm", confirm: "ok", card: "card", warning: "warning", offline: "offline" };
function needsList() {
  const out = [];
  for (const r of racks) {
    if (r.alarm) out.push({ key: `alarm-${r.id}-${r.police ? "p" : ""}`, kind: "alarm", title: "Tamper alarm",
      sub: `${r.name} · ${r.police ? `${AUTHORITY} alerted ${r.police}` : "just now"}`, act: "Open", rack: r.id });
    if (r.status === "UNCONFIRMED") out.push({ key: `confirm-${r.id}`, kind: "confirm", title: r.name, sub: `Checked in ${r.back}`, act: "Confirm", rack: r.id });
    for (const a of r.alerts) if (a.kind !== "alarm") out.push({ key: `alert-${a.id}`, kind: "warning", title: a.title, sub: `${r.name} · ${a.detail}`, act: "Open", rack: r.id });
    if (r.waiting) out.push({ key: `card-${r.id}`, kind: "card", title: `Card ${r.waiting}`, sub: `Tapped at ${r.name}`, act: "Register", rack: r.id });
    if (r.status === "OFFLINE") out.push({ key: `off-${r.id}`, kind: "offline", title: r.name, sub: `No check-in for ${r.lastSeen.replace(" ago", "")}`, act: "Open", rack: r.id });
  }
  return out;
}
function needsRow(n) {
  let el = needsShown.get(n.key);
  if (!el) {
    el = h("button", { type: "button", class: "needs-item", onClick: () => openRack(n.rack) },
      riveIcon("badge", { size: 24, inputs: { kind: BADGE[NEED_BADGE[n.kind]] } }).el,
      h("span", { class: "needs-main" }, h("b", {}, n.title), h("span", {}, n.sub)),
      h("span", { class: "act" }, n.act));
    needsShown.set(n.key, el);
  }
  el.classList.toggle("current", n.rack === openId);   // the rack open in the panel
  return el;
}
function renderNeeds() {
  const list = needsList();
  const keys = new Set(list.map((n) => n.key));
  for (const key of [...needsShown.keys()]) if (!keys.has(key)) needsShown.delete(key);
  const groups = GROUPS.map((g) => ({ ...g, items: list.filter((n) => n.kind === g.kind) })).filter((g) => g.items.length);
  needsEl.replaceChildren(...groups.flatMap((g) => [h("h3", { class: "needs-group" }, `${g.title} (${g.items.length})`), ...g.items.map(needsRow)]));
  if (!list.length) needsEl.append(h("p", { class: "needs-clear" }, "Nothing needs you right now."));
  document.querySelector("#needs-count").textContent = list.length ? String(list.length) : "";
}
document.querySelector("#needs-toggle").addEventListener("click", (e) => {
  const folded = needsBox.classList.toggle("folded");
  e.currentTarget.setAttribute("aria-expanded", String(!folded));
  document.querySelector("#needs-fold").textContent = folded ? "Show" : "Hide";
});

// ---------- App view: alarm next steps at the top ----------
const stepsEl = document.querySelector("#steps");
let stepsSig = "";
function renderSteps() {
  if (!APP) return;
  const r = racks.find((x) => x.alarm);
  const sig = r ? `${r.id}|${r.police}` : "";
  if (sig === stepsSig) return;
  stepsSig = sig;
  stepsEl.hidden = !r;
  if (!r) { stepsEl.replaceChildren(); return; }
  stepsEl.replaceChildren(
    h("div", { class: "steps-head" }, riveIcon("shake", { size: 72, height: 48, inputs: { level: 1 } }).el,
      h("div", {}, h("b", {}, "Tamper Alarm"), h("span", {}, ` ${r.name}, just now. Siren on for 10 s.`))),
    h("ol", {},
      h("li", { class: "done" }, h("div", {}, h("b", {}, "The rack sounded its siren"), h("p", {}, "It flashed red and sounded for 10 s. Bikes stay locked."))),
      h("li", {}, h("div", {}, h("b", {}, "Go and look, or send someone"), h("p", {}, `${r.place}. Check whether a bike or the lock is being forced.`))),
      h("li", { class: r.police ? "done" : "" }, h("div", {},
        h("b", {}, r.police ? `${AUTHORITY} alerted at ${r.police}` : "If a bike is being stolen, alert the authorities"),
        r.police ? h("p", {}, "Logged in the terminal and the audit log.") : btn("Alert Authorities", () => askAuthorities(r), "btn-police"))),
      h("li", {}, h("div", {}, h("b", {}, "When it's safe, mark it handled"), h("p", {}, "Add what happened in the terminal if it helps later."),
        btn("Mark Handled", () => ack(r)))),
    ),
  );
}

// ---------- App view: every rack's data ----------
const cardsEl = document.querySelector("#rack-cards");
const cardShown = new Map();   // rack id -> { sig, el }
const STATUS_TEXT = { ONLINE: "Online", WARNING: "Needs a Look", UNCONFIRMED: "Back, Not Confirmed", OFFLINE: "Offline" };
function renderCards() {
  if (!APP) return;
  cardsEl.hidden = false;
  const out = [h("h2", {}, "Racks")];
  for (const r of racks) {
    const sig = JSON.stringify([r.status, r.alarm, r.police, r.alerts.length, r.waiting, r.cards.filter((c) => c.on).length, r.unlocks]);
    let entry = cardShown.get(r.id);
    if (!entry || entry.sig !== sig) {
      const word = r.alarm ? "ALARM" : r.status;
      const pin = riveIcon("pin", { size: 44, inputs: { status: r.alarm ? 2 : { ONLINE: 0, WARNING: 1, UNCONFIRMED: 1, OFFLINE: 3 }[r.status] } });
      const data = (label, value) => h("div", {}, h("dt", {}, label), h("dd", {}, value));
      const el = h("article", { class: "rcard", id: `card-${r.id}` },
        h("div", { class: "rcard-head" }, pin.el,
          h("span", { class: "rcard-name" }, h("b", {}, r.name), h("span", {}, r.place)),
          h("span", { class: `st-${word}` }, r.alarm ? "Alarm" : STATUS_TEXT[r.status])),
        h("dl", { class: "rcard-data" },
          data("Lock Module", [riveIcon("signal", { size: 18, inputs: { level: r.signal } }).el, r.rssi ? `${r.rssi} dBm` : "No signal"]),
          data("Last Check-In", r.lastSeen),
          data("Unlocks Today", String(r.unlocks)),
          data("Open Alerts", String(r.alerts.length)),
          data("Cards Here", String(r.cards.filter((c) => c.on).length)),
          data("Waiting Card", r.waiting || "None")),
        h("div", { class: "rcard-actions" }, rackActions(r)));
      entry = { sig, el };
      cardShown.set(r.id, entry);
    }
    out.push(entry.el);
  }
  cardsEl.replaceChildren(...out);
}

// ---------- Commands page ----------
const COMMANDS = [
  { group: "Look Around", items: [
    ["help", "List every command in the terminal.", "help"],
    ["racks", "Every rack with its status, one per line.", "racks"],
    ["open <rack>", "Open a rack's panel (on the map) or its card (in the app).", "open newman"],
  ] },
  { group: "Alarms and Alerts", items: [
    ["ack <rack>", "Mark all of a rack's alerts handled. Stops it counting as Needs a Look.", "ack squires"],
    ["alert <rack>", `Alert ${AUTHORITY} about a rack's alarm. Asks you to type it again with "confirm".`, "alert squires"],
  ] },
  { group: "Cards and Racks", items: [
    ["register <rack> [name]", "Register the card that was just tapped at a rack, under a name.", "register newman Miles D."],
    ["confirm <rack>", "Confirm a rack that came back from being offline is really working. Check it in person first.", "confirm goodwin"],
    ["move <rack>", "Move a rack's pin: click the map or drag the pin, then Save Spot.", "move drillfield"],
  ] },
  { group: "Terminal", items: [
    ["clear", "Clear the terminal. Nothing is deleted.", "clear"],
    ["↑ / ↓", "Bring back earlier commands.", ""],
  ] },
];
const PREVIEWS = [
  ["tap <rack>", "A registered card unlocks the rack.", "tap newman"],
  ["deny <rack>", "An unknown card is refused (it then waits to be registered).", "deny squires"],
  ["shake <rack>", "The rack is bumped: warning chirp, the amber panel drops in.", "shake newman"],
  ["alarm <rack>", "Shaking keeps going: siren, the red panel with Alert Authorities.", "alarm newman"],
  ["reconnect <rack>", "An offline rack checks in again and waits to be confirmed.", "reconnect torgersen"],
];
const input = document.querySelector("#cmd");
function insert(text) {
  showPage("map");
  input.value = text;
  input.focus();
  input.scrollIntoView({ block: "nearest" });
}
function cmdRow([syntax, what, example]) {
  return h("div", { class: "cmdrow" }, h("code", {}, syntax),
    h("span", { class: "cmd-what" }, what, example ? h("span", {}, "Example: ", h("code", {}, example)) : null),
    example ? btn("Insert", () => insert(example), "btn-quiet") : h("span"));
}
document.querySelector("#commands-body").append(...[
  h("h1", {}, "Commands"),
  h("p", { class: "lead" }, "Type these in the terminal. Everything here also has a button somewhere; the terminal is just faster. ",
    "A rack can be its short name (", h("code", {}, "newman"), ") or the start of its full name. Press Insert to put an example in the terminal."),
  COMMANDS.map((g) => [h("h2", {}, g.group), h("div", { class: "cmds" }, g.items.map(cmdRow))]),
  h("h2", {}, "Mockup Only: Preview Real Events"),
  h("p", { class: "lead" }, "On the real site these come from the racks, and you test them in person with a card and a shake. Here they show what each event looks like."),
  h("div", { class: "cmds preview" }, PREVIEWS.map(cmdRow)),
].flat(Infinity));

// ---------- terminal ----------
const feed = document.querySelector("#feed");
const termSignal = riveIcon("signal", { size: 20, inputs: { level: 4 } });
document.querySelector("#term-signal").append(termSignal.el);
const KIND_BADGE = { ok: "ok", warn: "warning", alarm: "alarm", deny: "denied", off: "offline", card: "card", info: "info", cmd: "info", police: "police" };
const stamp = (d = new Date()) => d.toTimeString().slice(0, 8);

/** Adds a feed line. `html` is written in this file (sample text) with user input escaped. */
function log(kind, html, { preview = false, time = stamp() } = {}) {
  const line = h("div", { class: `line ${kind}` }, h("span", { class: "t" }, time));
  line.append(kind === "help" ? h("span", { class: "badge-space" }) : riveIcon("badge", { size: 18, inputs: { kind: BADGE[KIND_BADGE[kind]] } }).el);
  const msg = h("span", { class: "msg" });
  msg.innerHTML = html;
  if (preview) msg.append(h("span", { class: "sim" }, "  preview"));
  line.append(msg);
  feed.append(line);
  while (feed.children.length > 200) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
  termSignal.fire("blip");
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const HELP = `racks                    list racks and their status
open <rack>              open a rack
ack <rack>               mark a rack's alerts handled
alert <rack>             alert ${AUTHORITY} about an alarm (asks to confirm)
register <rack> [name]   register the card waiting at a rack
confirm <rack>           confirm a rack is back online
move <rack>              move a rack's pin on the map
clear                    clear the terminal
the Commands page has examples.`;

function run(text) {
  const parts = text.trim().split(/\s+/);
  const [cmd, arg] = parts;
  if (!cmd) return;
  log("cmd", `admin $ ${esc(text.trim())}`);
  const r = arg ? byId(arg) : null;
  const needRack = () => log("deny", arg ? `no rack called "${esc(arg)}". try: racks` : `which rack? e.g. ${esc(cmd)} newman`);
  switch (cmd.toLowerCase()) {
    case "help": log("help", HELP); break;
    case "clear": feed.replaceChildren(); break;
    case "racks":
      for (const x of racks) log(x.alarm ? "alarm" : x.status === "OFFLINE" ? "off" : x.status === "ONLINE" ? "ok" : "warn",
        `<b>${x.id.padEnd(11)}</b>${x.alarm ? "ALARM" : x.status.toLowerCase()}`);
      break;
    case "open": if (!r) needRack(); else { openRack(r.id); log("info", `opened <b>${r.id}</b>`); } break;
    case "ack":
      if (!r) { needRack(); break; }
      if (!r.alerts.length && !r.alarm) { log("info", `<b>${r.id}</b> has no open alerts`); break; }
      ack(r);
      break;
    case "alert":
      if (!r) { needRack(); break; }
      if (!r.alarm) { log("info", `<b>${r.id}</b> isn't alarming. alert is only for tamper alarms`); break; }
      if (r.police) { log("police", `<b>${r.id}</b> ${AUTHORITY} already alerted at ${r.police}`); break; }
      if ((parts[2] || "").toLowerCase() !== "confirm") { log("warn", `this alerts ${AUTHORITY} about ${esc(r.name)}. to send it, type: alert ${r.id} confirm`); break; }
      alertAuthorities(r);
      break;
    case "register":
      if (!r) { needRack(); break; }
      if (!r.waiting) { log("info", `<b>${r.id}</b> has no card waiting. tap the new card on the rack first`); break; }
      register(r, parts.slice(2).join(" ") || "New Rider");
      break;
    case "confirm": if (!r) needRack(); else confirmOnline(r); break;
    case "move":
      if (!r) { needRack(); break; }
      if (APP) { log("info", "moving a pin needs the map: open the desktop view"); break; }
      openRack(r.id); startMove(r); log("info", `click the map or drag the pin, then Save Spot`);
      break;
    // ---- mockup previews of real hardware events ----
    case "tap":
      if (!r) { needRack(); break; }
      if (!isOnline(r)) { log("off", `<b>${r.id}</b> isn't confirmed online; a real tap still works from its saved list`); break; }
      map?.flash(r.id, "unlock");
      if (openId === r.id) playScene(SCENE.granted, 2900);
      r.unlocks++;
      log("ok", `<b>${r.id}</b> ${esc(r.cards.find((c) => c.on)?.name || "Demo Rider")} unlocked`, { preview: true });
      changed(r);
      break;
    case "deny":
      if (!r) { needRack(); break; }
      map?.flash(r.id, "deny");
      if (openId === r.id) playScene(SCENE.denied, 2400);
      r.waiting = r.waiting || "8474ffc1";
      log("deny", `<b>${r.id}</b> card ${r.waiting} refused: not registered here`, { preview: true });
      changed(r);
      break;
    case "shake":
      if (!r) { needRack(); break; }
      r.alerts.unshift({ id: ++alertSeq, kind: "warning", title: "Rack Bumped", detail: "Jolt of 0.62 g, just now" });
      if (r.status === "ONLINE") r.status = "WARNING";
      log("warn", `<b>${r.id}</b> shake detected, jolt 0.62 g, warning chirp`, { preview: true });
      changed(r);
      showDrop(r, "bump");
      break;
    case "alarm":
      if (!r) { needRack(); break; }
      if (!r.alarm) {
        r.alarm = true;
        if (r.status === "ONLINE") r.status = "WARNING";
        r.alerts.unshift({ id: ++alertSeq, kind: "alarm", title: "Tamper Alarm", detail: "Jolt of 1.31 g, just now" });
      }
      log("alarm", `<b>${r.id}</b> TAMPER ALARM, jolt 1.31 g, siren on`, { preview: true });
      changed(r);
      showDrop(r, "alarm");
      break;
    case "reconnect":
      if (!r) { needRack(); break; }
      if (r.status !== "OFFLINE") { log("info", `<b>${r.id}</b> isn't offline`); break; }
      r.status = "UNCONFIRMED"; r.back = "after 14 min offline"; r.lastSeen = "just now"; r.signal = 3; r.rssi = -61;
      log("warn", `<b>${r.id}</b> checked in again after 14 min offline. not confirmed: check it, then type confirm ${r.id}`, { preview: true });
      changed(r);
      break;
    default: log("deny", `unknown command "${esc(cmd)}". type help, or see the Commands page`);
  }
}
const history = [];
let hIndex = 0;
document.querySelector("#prompt").addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value.trim()) { history.push(input.value); hIndex = history.length; run(input.value); }
  input.value = "";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && hIndex > 0) { input.value = history[--hIndex]; e.preventDefault(); }
  if (e.key === "ArrowDown") { hIndex = Math.min(history.length, hIndex + 1); input.value = history[hIndex] || ""; e.preventDefault(); }
});

// ---------- opening story: a quiet feed, then a shake that turns into an alarm ----------
const t = (m) => stamp(new Date(Date.now() - m * 60000));
log("info", "<b>torgersen</b> lock module checked in", { time: t(16) });
log("deny", "<b>newman</b> card f02f1d68 refused: not registered here", { time: t(4) });
log("ok", "<b>squires</b> Demo Rider unlocked", { time: t(3) });
log("warn", "<b>squires</b> rack bumped, jolt 0.62 g", { time: t(3) });
log("off", "<b>torgersen</b> offline 14 min", { time: t(1) });
log("warn", "<b>goodwin</b> checked in again after 2 h offline. not confirmed: check it, then type confirm goodwin", { time: t(1) });
refreshMap();
renderNeeds();
renderSummary();
renderCards();
setTimeout(() => run("shake squires"), 2600);
setTimeout(() => run("alarm squires"), 6200);
if (location.hash === "#commands") showPage("commands");

window.__mock = { run, openRack, closeRack, map, showPage };
