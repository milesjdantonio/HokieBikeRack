// Admin mockup, style B1. Sample data only: everything here is pretend, so Miles can click through
// the layout and see every animation before the real admin site is built on the same pieces.
//
// Rive used on this page:
//   logo.riv    brand mark, builds itself once on load
//   pin.riv     every rack on the map: status colour, alarm shudder, check/cross on a tap, selection
//   rack.riv    the rack scene at the top of the panel and in the alarm pop-up
//   badge.riv   next to every terminal line, Needs You item, alert and card
//   signal.riv  terminal header (flicks on each new line) and each lock module's Wi-Fi strength
import { riveIcon } from "../js/rive.js";
import { rackMap } from "../app/js/map.js";
import { h } from "../js/dom.js";

const BADGE = { info: 0, ok: 1, denied: 2, warning: 3, alarm: 4, offline: 5, card: 6 };
const SCENE = { idle: 0, granted: 1, denied: 2, alarm: 3, offline: 4 };

const racks = [
  { id: "squires", name: "Squires North", place: "Squires Student Center, north side", status: "WARNING", alarm: false,
    latitude: 37.22975, longitude: -80.41835, signal: 3, rssi: -55,
    alerts: [{ id: 1, kind: "warning", title: "Rack Bumped", detail: "Jolt of 0.62 g, 3 min ago" }],
    cards: [{ name: "Demo Rider", detail: "Used 2 min ago", on: true }] },
  { id: "newman", name: "Newman Library", place: "Newman Library, front steps", status: "ONLINE", alarm: false,
    latitude: 37.22868, longitude: -80.41925, signal: 4, rssi: -48, waiting: "f02f1d68",
    alerts: [], cards: [{ name: "Miles D.", detail: "Used 1 h ago", on: true }, { name: "Old Test Card", detail: "Turned off", on: false }] },
  { id: "torgersen", name: "Torgersen Hall North", place: "Torgersen Hall, by the bridge", status: "OFFLINE", alarm: false,
    latitude: 37.22995, longitude: -80.41985, signal: 0, rssi: null, alerts: [], cards: [{ name: "Demo Rider", detail: "Used yesterday", on: true }] },
  { id: "drillfield", name: "Drillfield South", place: "Drillfield, by Burruss Hall", status: "ONLINE", alarm: false,
    latitude: 37.22745, longitude: -80.42245, signal: 2, rssi: -71, alerts: [], cards: [] },
];
const byId = (id) => racks.find((r) => r.id === id || r.name.toLowerCase().startsWith(String(id).toLowerCase()));
let alertSeq = 10;

// ---------- top bar ----------
const logo = riveIcon("logo", { size: 28 });
document.querySelector("#brand-mark").append(logo.el);
const summary = document.querySelector("#summary");
function renderSummary() {
  const online = racks.filter((r) => r.status !== "OFFLINE").length;
  const alarms = racks.filter((r) => r.alarm).length;
  summary.replaceChildren(h("b", {}, `${online} of ${racks.length}`), " racks online",
    alarms ? h("span", { class: "state-alarm" }, ` · ${alarms} alarm${alarms > 1 ? "s" : ""}`) : "");
}

// ---------- map ----------
const map = rackMap(document.querySelector("#map"), {
  look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" },
  onSelect: (r) => openRack(r.id),
});
const TRAY = 52 + 16 + 16;   // the Needs You tray covers the bottom of the map
map.setInset({ bottom: TRAY }, { duration: 0 });
const refreshMap = () => map.setRacks(racks.map((r) => ({ ...r })));
refreshMap();

// ---------- rack panel ----------
const panel = document.querySelector("#panel");
const panelBody = document.querySelector("#panel-body");
const scene = riveIcon("rack", { size: 380, height: 180, fit: "cover", align: "BottomCenter", inputs: { state: 0 }, label: "The rack, live" });
document.querySelector("#panel-scene").append(scene.el);
let openId = null;
let sceneTimer = null;

const sceneFor = (r) => (r.alarm ? SCENE.alarm : r.status === "OFFLINE" ? SCENE.offline : SCENE.idle);
function playScene(state, ms) {
  clearTimeout(sceneTimer);
  scene.set("state", state);
  if (ms) sceneTimer = setTimeout(() => { const r = byId(openId); if (r) scene.set("state", sceneFor(r)); }, ms);
}

function openRack(id) {
  const r = byId(id);
  if (!r) return;
  const wasOpen = !panel.hidden;
  openId = r.id;
  panel.hidden = false;
  if (!wasOpen) { panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = ""; }
  renderPanel();
  playScene(sceneFor(r));
  // The panel covers the left of the map: centre the rack in the part that's still visible.
  map.setInset({ left: 380 + 16 * 2, bottom: TRAY }, { duration: 0 });
  map.select(r.id);
}
function closeRack() {
  panel.hidden = true;
  openId = null;
  map.select(null, { move: false });
  map.setInset({ left: 0, bottom: TRAY });
}
document.querySelector("#panel-close").addEventListener("click", closeRack);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) closeRack(); });

function stateLine(r) {
  if (r.alarm) return h("p", { class: "state state-alarm" }, "Alarm. Someone is tampering with this rack.");
  if (r.status === "OFFLINE") return h("p", { class: "state state-offline" }, "Offline for 14 min. It keeps working on its saved card list for 72 h.");
  if (r.alerts.length) return h("p", { class: "state state-warning" }, `Needs a look: ${r.alerts.length} open alert${r.alerts.length > 1 ? "s" : ""}.`);
  return h("p", { class: "state" }, "Working. Cards tap in normally.");
}

function renderPanel() {
  const r = byId(openId);
  if (!r) return;
  panel.setAttribute("aria-label", r.name);
  const alerts = r.alerts.length
    ? h("div", { class: "list" }, r.alerts.map((a) => {
      const badge = riveIcon("badge", { size: 22, inputs: { kind: BADGE[a.kind] } });
      const row = h("div", { class: "item" }, badge.el,
        h("span", { class: "item-main" }, h("b", {}, a.title), h("span", {}, a.detail)),
        h("button", { class: "btn", type: "button", onClick: () => handled(r, a, badge, row) }, "Handled"));
      return row;
    }))
    : h("p", { class: "empty" }, "No open alerts.");

  const sig = riveIcon("signal", { size: 22, inputs: { level: r.signal } });
  const module = h("div", { class: "list" }, h("div", { class: "item" }, sig.el,
    h("span", { class: "item-main" }, h("b", {}, "ESP32 #1"),
      h("span", {}, r.status === "OFFLINE" ? "Last heard 14 min ago" : `All sensors working, signal ${r.rssi} dBm`)),
    r.status === "OFFLINE" ? h("span", { class: "off" }, "Offline") : h("span", { class: "ok" }, "Online")));

  const waiting = r.waiting ? [h("h2", {}, "Waiting to Register"), h("div", { class: "list" }, h("div", { class: "item" },
    riveIcon("badge", { size: 22, inputs: { kind: BADGE.card } }).el,
    h("span", { class: "item-main" }, h("b", {}, `Card ${r.waiting}`), h("span", {}, "Tapped here 2 min ago")),
    h("button", { class: "btn btn-primary", type: "button", onClick: () => register(r) }, "Register")))] : [];

  const cards = r.cards.length
    ? h("div", { class: "list" }, r.cards.map((c) => h("div", { class: "item" },
      riveIcon("badge", { size: 22, inputs: { kind: c.on ? BADGE.ok : BADGE.denied } }).el,
      h("span", { class: "item-main" }, h("b", {}, c.name), h("span", {}, c.detail)),
      h("button", { class: "btn btn-quiet", type: "button", onClick: () => { c.on = !c.on; c.detail = c.on ? "Turned on just now" : "Turned off"; log(c.on ? "ok" : "info", `<b>${r.id}</b> ${c.name} turned ${c.on ? "on" : "off"}`); renderPanel(); } },
        c.on ? "Turn Off" : "Turn On"))))
    : h("p", { class: "empty" }, "No cards yet. Tap a new card on this rack, then register it here.");

  panelBody.replaceChildren(
    h("h1", { class: "panel-title" }, r.name),
    h("p", { class: "panel-sub" }, r.place),
    stateLine(r),
    h("h2", {}, "Alerts"), alerts,
    ...waiting,
    h("h2", {}, "Lock Module"), module,
    h("h2", {}, "Cards That Work Here"), cards,
    h("div", { class: "panel-actions" },
      h("button", { class: "btn", type: "button" }, "Move on Map"),
      h("button", { class: "btn", type: "button" }, "Add Lock Module")),
    h("div", { class: "panel-demo" }, "Demo:",
      h("button", { class: "btn btn-quiet", type: "button", onClick: () => run(`tap ${r.id}`) }, "Test Tap"),
      h("button", { class: "btn btn-quiet", type: "button", onClick: () => run(`deny ${r.id}`) }, "Test Wrong Card"),
      h("button", { class: "btn btn-quiet", type: "button", onClick: () => run(`shake ${r.id}`) }, "Test Shake")),
  );
}

function handled(r, a, badge, row) {
  badge.set("kind", BADGE.ok);            // the warning turns into a check, then the row leaves
  row.querySelector("button").disabled = true;
  setTimeout(() => row.classList.add("leaving"), 650);
  setTimeout(() => {
    r.alerts = r.alerts.filter((x) => x !== a);
    if (a.kind === "alarm") r.alarm = false;
    if (!r.alerts.length && r.status === "WARNING") r.status = "ONLINE";
    log("ok", `<b>${r.id}</b> ${a.title.toLowerCase()} marked handled`);
    changed(r);
  }, 950);
}

function register(r) {
  const card = r.waiting;
  r.waiting = null;
  r.cards.unshift({ name: "New Rider", detail: "Registered just now", on: true });
  log("ok", `registered card ${card} as New Rider at <b>${r.id}</b>. racks sync within a minute`);
  changed(r);
}

/** Something about a rack changed: update the pin, the panel, the tray and the summary. */
function changed(r) {
  refreshMap();
  if (openId === r.id) { renderPanel(); playScene(sceneFor(r)); }
  renderNeeds();
  renderSummary();
}

// ---------- alarm pop-up ----------
const pop = document.querySelector("#alarm-pop");
const popScene = riveIcon("rack", { size: 150, height: 100, inputs: { state: SCENE.alarm } });
document.querySelector("#alarm-scene").append(popScene.el);
let popRack = null;
let sirenTimer = null;
function showAlarm(r) {
  popRack = r.id;
  document.querySelector("#alarm-where").textContent = `${r.name}, just now`;
  const bar = document.querySelector("#siren-bar");
  bar.classList.remove("run"); void bar.offsetWidth; bar.classList.add("run");
  document.querySelector("#siren-note").textContent = "Siren on for 10 s";
  clearTimeout(sirenTimer);
  sirenTimer = setTimeout(() => { document.querySelector("#siren-note").textContent = "Siren stopped. The alarm stays open until handled."; }, 10000);
  pop.hidden = false;
  pop.style.animation = "none"; void pop.offsetWidth; pop.style.animation = "";
  popScene.set("state", SCENE.alarm);
}
document.querySelector("#alarm-open").addEventListener("click", () => { pop.hidden = true; openRack(popRack); });
document.querySelector("#alarm-dismiss").addEventListener("click", () => { pop.hidden = true; });

// ---------- needs-you tray ----------
const needsEl = document.querySelector("#needs");
const needsShown = new Map();   // key -> element (kept, so each badge animates only when it first appears)
function needsList() {
  const out = [];
  for (const r of racks) {
    if (r.alarm) out.push({ key: `alarm-${r.id}`, kind: "alarm", text: `Tamper alarm at ${r.name}`, act: "Open", rack: r.id });
    for (const a of r.alerts) if (a.kind !== "alarm") out.push({ key: `alert-${a.id}`, kind: "warning", text: `${a.title} at ${r.name}`, act: "Open", rack: r.id });
    if (r.waiting) out.push({ key: `card-${r.id}`, kind: "card", text: `New card tapped at ${r.name}`, act: "Register", rack: r.id });
    if (r.status === "OFFLINE") out.push({ key: `off-${r.id}`, kind: "offline", text: `${r.name} offline 14 min`, act: "Open", rack: r.id });
  }
  return out;
}
function renderNeeds() {
  const list = needsList();
  const keys = new Set(list.map((n) => n.key));
  for (const [key, el] of needsShown) {
    if (!keys.has(key)) { needsShown.delete(key); el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }
  }
  for (const n of list) {
    if (needsShown.has(n.key)) continue;
    const el = h("button", { type: "button", class: "needs-item", onClick: () => openRack(n.rack) },
      riveIcon("badge", { size: 24, inputs: { kind: BADGE[n.kind] } }).el, n.text, h("span", { class: "act" }, n.act));
    needsShown.set(n.key, el);
    if (n.kind === "alarm") needsEl.prepend(el); else needsEl.append(el);
  }
  document.querySelector(".needs-title").textContent = list.length ? `Needs You (${list.length})` : "Needs You";
  needsEl.querySelector(".needs-clear")?.remove();
  if (!list.length) needsEl.append(h("span", { class: "needs-clear" }, "Nothing right now."));
}

// ---------- terminal ----------
const feed = document.querySelector("#feed");
const termSignal = riveIcon("signal", { size: 20, inputs: { level: 4 } });
document.querySelector("#term-signal").append(termSignal.el);
const KIND_BADGE = { ok: "ok", warn: "warning", alarm: "alarm", deny: "denied", off: "offline", card: "card", info: "info", cmd: "info" };
const clock = (d = new Date()) => d.toTimeString().slice(0, 8);

/** Adds a feed line. `html` is written in this file (sample text), never user input. */
function log(kind, html, { sim = false, time = clock() } = {}) {
  const line = h("div", { class: `line ${kind}` }, h("span", { class: "t" }, time));
  line.append(kind === "help" ? h("span", { class: "badge-space" }) : riveIcon("badge", { size: 18, inputs: { kind: BADGE[KIND_BADGE[kind]] } }).el);
  const msg = h("span", { class: "msg" });
  msg.innerHTML = html;
  if (sim) msg.append(h("span", { class: "sim" }, "  sim"));
  line.append(msg);
  feed.append(line);
  while (feed.children.length > 200) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
  termSignal.fire("blip");
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const HELP = `racks              list racks and their status
open <rack>        open a rack's panel
tap <rack>         pretend a registered card unlocks it
deny <rack>        pretend an unknown card is refused
shake <rack>       pretend someone is tampering with it
ack <rack>         mark a rack's alerts handled
clear              clear the terminal`;

function run(text) {
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  if (!cmd) return;
  log("cmd", `admin $ ${esc(text.trim())}`);
  const r = arg ? byId(arg) : null;
  const needRack = () => { log("deny", arg ? `no rack called "${esc(arg)}". try: racks` : `which rack? e.g. ${cmd} newman`); };
  switch (cmd.toLowerCase()) {
    case "help": log("help", HELP); break;
    case "clear": feed.replaceChildren(); break;
    case "racks":
      for (const x of racks) log(x.alarm ? "alarm" : x.status === "OFFLINE" ? "off" : x.alerts.length ? "warn" : "ok",
        `<b>${x.id.padEnd(11)}</b>${x.alarm ? "ALARM" : x.status.toLowerCase()}`);
      break;
    case "open": if (!r) needRack(); else { openRack(r.id); log("info", `opened <b>${r.id}</b>`); } break;
    case "tap":
      if (!r) { needRack(); break; }
      if (r.status === "OFFLINE") { log("off", `<b>${r.id}</b> is offline; a real tap would still work from its saved list`); break; }
      map.flash(r.id, "unlock");
      if (openId === r.id) playScene(SCENE.granted, 2900);
      log("ok", `<b>${r.id}</b> ${esc(r.cards.find((c) => c.on)?.name || "Demo Rider")} unlocked`, { sim: true });
      break;
    case "deny":
      if (!r) { needRack(); break; }
      map.flash(r.id, "deny");
      if (openId === r.id) playScene(SCENE.denied, 2400);
      r.waiting = r.waiting || "8474ffc1";
      log("deny", `<b>${r.id}</b> card ${r.waiting} refused: not registered here`, { sim: true });
      changed(r);
      break;
    case "shake":
      if (!r) { needRack(); break; }
      if (!r.alarm) {
        r.alarm = true;
        r.status = "WARNING";
        r.alerts.unshift({ id: ++alertSeq, kind: "alarm", title: "Tamper Alarm", detail: "Jolt of 1.31 g, just now" });
      }
      log("alarm", `<b>${r.id}</b> TAMPER ALARM, jolt 1.31 g, siren on`, { sim: true });
      changed(r);
      showAlarm(r);
      break;
    case "ack":
      if (!r) { needRack(); break; }
      if (!r.alerts.length && !r.alarm) { log("info", `<b>${r.id}</b> has no open alerts`); break; }
      r.alerts = []; r.alarm = false; if (r.status === "WARNING") r.status = "ONLINE";
      log("ok", `<b>${r.id}</b> alerts marked handled`);
      changed(r);
      if (popRack === r.id) pop.hidden = true;
      break;
    default: log("deny", `unknown command "${esc(cmd)}". type help`);
  }
}
const input = document.querySelector("#cmd");
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

// ---------- opening story: a quiet feed, then an alarm comes in ----------
const t = (m) => clock(new Date(Date.now() - m * 60000));
log("info", "<b>torgersen</b> lock module checked in", { time: t(16) });
log("deny", "<b>newman</b> card f02f1d68 refused: not registered here", { time: t(4) });
log("ok", "<b>squires</b> Demo Rider unlocked", { time: t(3) });
log("warn", "<b>squires</b> rack bumped, jolt 0.62 g", { time: t(3) });
log("off", "<b>torgersen</b> offline 14 min", { time: t(1) });
renderNeeds();
renderSummary();
setTimeout(() => run("shake squires"), 2600);

window.__mock = { run, openRack, closeRack, map };
