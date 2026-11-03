// RIDER version (/rider/): for the everyday bike user. No login. Every rack answers the two things a
// rider wants first (Miles): how many open spots, and is there an alarm (and when was the last one).
// Browser: rack list beside the campus map. App (phone, ?view=app): tabs Racks / Map / My Card / Alerts.
// Riders never see anyone's card, and don't need to know about the rack's connection (Miles).
// Map pins (Miles): green = plenty of spots, yellow = under 25% open, red = full,
// flashing red with a slash = a report was made (police incident open): use another rack.
import { h, ago } from "../js/dom.js";
import { riveIcon } from "../js/rive.js";
import { rackMap } from "./map.js";
import { icon } from "./icons.js";
import { createLive, isAlarm } from "./live.js";

const params = new URLSearchParams(location.search);
const APP = params.get("view") === "app" || (params.get("view") !== "desktop" && matchMedia("(max-width: 760px)").matches);
document.body.classList.toggle("view-app", APP);
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const btn = (label, onClick, cls = "", attrs = {}) => h("button", { class: `btn ${cls}`, type: "button", onClick, ...attrs }, label);

const live = createLive({ every: 5000, want: {} });
const S = live.state;
let here = null;   // { lat, lng } after Find Nearest
let openId = null;

// ---------- words riders read ----------
const installed = (r) => r.deviceCount > 0;
const reported = (r) => Boolean(r.incidentStatus);
const few = (r) => r.openSpots > 0 && r.openSpots / r.capacity < 0.25;
function spots(r) {
  if (!installed(r)) return { big: "-", small: "Not open yet", cls: "muted" };
  if (reported(r)) return { big: "Closed", small: "Reported", cls: "reported" };
  if (r.openSpots === 0) return { big: "Full", small: `${r.capacity} of ${r.capacity} in use`, cls: "full" };
  return { big: String(r.openSpots), small: `of ${r.capacity} spot${r.capacity === 1 ? "" : "s"} open`, cls: few(r) ? "few" : "open" };
}
function alarm(r) {
  if (isAlarm(r)) return { text: "Alarm now", sub: "Staff have been alerted", cls: "alarm" };
  if (r.lastAlarmAt) return { text: `Last alarm ${ago(r.lastAlarmAt)}`, sub: "Quiet now", cls: "" };
  return { text: "No alarms", sub: "Never had one", cls: "calm" };
}
function sentence(r) {
  if (!installed(r)) return "This rack isn't open yet.";
  if (reported(r)) return "This rack was reported to the police. Please use another rack for now.";
  if (isAlarm(r)) return "Someone tampered with this rack. Bikes stay locked; staff are on it.";
  if (r.openSpots === 0) return "Full right now. Try a nearby rack.";
  if (few(r)) return "Almost full. Tap your card on the reader: a green light and one beep, and it's open for 5 seconds.";
  return "Ready. Tap your card on the reader: a green light and one beep, and it's open for 5 seconds.";
}
const distKm = (r) => (here && r.latitude != null ? haversine(here.lat, here.lng, r.latitude, r.longitude) : null);
function haversine(a, b, c, d) {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const walk = (km) => (km < 0.05 ? "right here" : `${Math.max(1, Math.round((km * 1000) / 80))} min walk`);
// pin.riv states: 0 green, 5 yellow, 6 red, 7 flashing red + slash, 3 grey (not open yet).
const riderPin = (r) => ({ ...r,
  pin: !installed(r) ? 3 : reported(r) ? 7 : r.openSpots === 0 ? 6 : few(r) ? 5 : 0,
  label: `${r.name} · ${!installed(r) ? "not open" : reported(r) ? "reported" : r.openSpots === 0 ? "full" : `${r.openSpots} open`}` });

function sorted() {
  const list = S.racks.filter((r) => r.latitude != null || installed(r));
  return list.sort((a, b) => {
    if (here) return (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9);
    const score = (r) => (!installed(r) ? -3 : reported(r) ? -2 : r.openSpots === 0 ? -1 : r.openSpots);
    return score(b) - score(a) || a.name.localeCompare(b.name);
  });
}

// ---------- pieces ----------
function rackCard(r, onOpen) {
  const sp = spots(r), al = alarm(r), km = distKm(r);
  return h("button", { type: "button", class: `rider-card${r.id === openId ? " current" : ""}`, onClick: () => onOpen(r.id) },
    h("span", { class: `rc-spots ${sp.cls}` }, h("b", {}, sp.big), h("small", {}, ["Full", "-", "Closed"].includes(sp.big) ? "" : "open")),
    h("span", { class: "rc-main" }, h("b", {}, r.name), h("span", {}, [r.locationDescription, km != null ? walk(km) : null].filter(Boolean).join(" · ")),
      h("span", { class: `rc-alarm ${al.cls}` }, al.text)),
    icon("back"));
}
function detail(body, r) {
  const sp = spots(r), al = alarm(r);
  const scene = riveIcon("rack", { size: 440, height: 200, fit: "cover", align: "BottomCenter",
    inputs: { state: isAlarm(r) || reported(r) ? 3 : installed(r) ? 0 : 4 }, label: `${r.name}, live` });
  const dirs = r.latitude != null ? `https://www.openstreetmap.org/directions?to=${r.latitude},${r.longitude}#map=18/${r.latitude}/${r.longitude}` : null;
  fill(body,
    h("div", { class: "panel-scene app-scene" }, scene.el),
    h("div", { class: "rider-detail" },
      h("h1", { class: "panel-title" }, r.name),
      r.locationDescription ? h("p", { class: "panel-sub" }, r.locationDescription) : null,
      h("div", { class: "facts big-facts" },
        h("div", { class: `fact ${sp.cls}` }, h("span", {}, "Open Spots"), h("b", {}, ["-", "Full", "Closed"].includes(sp.big) ? sp.big : `${sp.big} of ${r.capacity}`)),
        h("div", { class: `fact ${al.cls === "alarm" ? "alarm" : ""}` }, h("span", {}, "Alarm"), h("b", {}, isAlarm(r) ? "Active now" : r.lastAlarmAt ? ago(r.lastAlarmAt) : "None"),
          h("small", {}, isAlarm(r) ? "Staff have been alerted" : r.lastAlarmAt ? "since the last alarm" : "never had one"))),
      h("p", { class: `state ${isAlarm(r) || reported(r) ? "state-alarm" : r.openSpots === 0 || few(r) ? "state-warning" : ""}` }, sentence(r)),
      h("div", { class: "panel-actions" }, dirs ? h("a", { class: "btn btn-primary", href: dirs, target: "_blank", rel: "noopener" }, "Directions") : null),
      h("h2", {}, "How It Works"),
      h("ol", { class: "how" },
        h("li", {}, h("b", {}, "Park"), " Tap your card on the reader. Green light, one beep: lock your bike in within 5 seconds."),
        h("li", {}, h("b", {}, "Leave"), " Tap the same card again to unlock and take your bike. That's how open spots are counted."),
        h("li", {}, h("b", {}, "Red light, two beeps?"), " Your card isn't registered for this rack. See My Card."))));
}
function myCard() {
  return h("div", { class: "sheet-inner rider-page" },
    h("h1", {}, "My Card"),
    h("div", { class: "card-art" }, riveIcon("badge", { size: 72, inputs: { kind: 6 } }).el,
      h("div", {}, h("b", {}, "Your campus card works the racks"), h("span", {}, "Register it once, then tap in and tap out."))),
    h("h2", {}, "Get Set Up"),
    h("ol", { class: "how" },
      h("li", {}, h("b", {}, "Tap it once"), " on any rack. It won't open yet, but staff now see your card waiting."),
      h("li", {}, h("b", {}, "Ask staff to register it"), " at that rack (or all racks). It works within a minute."),
      h("li", {}, h("b", {}, "Park and leave"), " with a tap each time. Your first tap parks, your next tap leaves.")),
    h("h2", {}, "Good to Know"),
    h("ul", { class: "how plain" },
      h("li", {}, "Shaking or forcing a rack sets off its alarm and alerts staff."),
      h("li", {}, "Lost your card? Tell staff so they can turn it off.")));
}
function alertsPage() {
  const reports = S.racks.filter((r) => installed(r) && reported(r));
  const alarms = S.racks.filter((r) => isAlarm(r) && !reported(r));
  const full = S.racks.filter((r) => installed(r) && r.openSpots === 0 && !isAlarm(r) && !reported(r));
  const row = (r, text, kind) => h("button", { type: "button", class: "inc-row", onClick: () => openRack(r.id) },
    riveIcon("badge", { size: 26, inputs: { kind } }).el, h("span", { class: "needs-main" }, h("b", {}, r.name), h("span", {}, text)));
  const items = [...reports.map((r) => row(r, "Reported to the police. Use another rack for now.", 2)),
    ...alarms.map((r) => row(r, "Alarm now. Staff have been alerted.", 4)), ...full.map((r) => row(r, "Full right now.", 3))];
  return h("div", { class: "sheet-inner rider-page" }, h("h1", {}, "Alerts"),
    items.length ? h("div", { class: "inc-list" }, items)
      : h("div", { class: "all-clear" }, riveIcon("badge", { size: 56, inputs: { kind: 1 } }).el, h("b", {}, "All good"), h("span", {}, "Every rack is working.")));
}

function findNearest() {
  if (!navigator.geolocation) { toast("Location isn't available in this browser."); return; }
  navigator.geolocation.getCurrentPosition((p) => {
    here = { lat: p.coords.latitude, lng: p.coords.longitude };
    const best = sorted().find((r) => installed(r) && r.openSpots > 0);
    render();
    if (best) { toast(`Nearest open: ${best.name}, ${walk(distKm(best))}`); openRack(best.id); }
  }, () => toast("Couldn't get your location. Allow location to sort by distance."), { timeout: 8000 });
}

const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
function toast(text) {
  const t = h("div", { class: "toast" }, text);
  toasts.append(t);
  setTimeout(() => t.classList.add("leaving"), 3600);
  setTimeout(() => t.remove(), 4000);
}

// ---------- desktop ----------
let map, listEl, pageEl, detailEl, page = "racks";
function buildDesktop(root) {
  listEl = h("div", { class: "rider-list" });
  detailEl = h("aside", { class: "panel rider-panel", hidden: true });
  pageEl = h("section", { class: "sheet", hidden: true });
  const mapEl = h("div", { class: "map" });
  const nav = [["racks", "Racks"], ["card", "My Card"], ["alerts", "Alerts"]].map(([p, l]) => h("a", { href: `#${p}`, "data-page": p, onClick: (e) => { e.preventDefault(); go(p); } }, l));
  root.append(h("header", { class: "top" },
    h("a", { class: "brand", href: "#racks" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 28 }).el), "HokieBikeRack"),
    h("nav", { class: "top-nav" }, nav), h("span", { class: "top-summary", id: "rsum" }),
    h("a", { class: "view-switch", href: "?view=app" }, "App View"), h("a", { class: "view-switch", href: "/" }, "Versions")),
  h("main", { class: "rider-stage" },
    h("aside", { class: "rider-side" }, h("div", { class: "pol-side-head" }, h("h2", {}, "Racks"), btn("Find Nearest", findNearest, "btn-primary")), listEl),
    h("section", { class: "map-area" }, mapEl, detailEl), pageEl));
  map = rackMap(mapEl, { look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" }, onSelect: (r) => openRack(r.id) });
}
function go(p) {
  page = p;
  pageEl.hidden = p === "racks";
  for (const a of document.querySelectorAll(".top-nav a")) { if (a.dataset.page === p) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  if (p === "card") fill(pageEl, myCard());
  if (p === "alerts") fill(pageEl, alertsPage());
}
function openRack(id) {
  const r = S.racks.find((x) => x.id === id);
  if (!r) return;
  openId = id;
  if (APP) { const body = openSheet(r.name); detail(body, r); return; }
  go("racks");
  detailEl.hidden = false;
  detailEl.closest(".map-area").classList.add("panel-open");
  const body = h("div");
  fill(detailEl, h("button", { class: "panel-close", type: "button", onClick: closeRack }, "Close"), body);
  detail(body, r);
  map.setInset({ left: 380 + 32 }, { duration: 0 });
  if (r.latitude != null) map.select(id);
  render();
}
function closeRack() {
  openId = null;
  detailEl.hidden = true;
  detailEl.closest(".map-area").classList.remove("panel-open");
  map.select(null, { move: false });
  map.setInset({ left: 0 });
  render();
}

// ---------- app ----------
let appMain, appTabs, appTitle, appSheet, appMapEl, appMap = null, tab = "racks";
function buildApp(root) {
  appTitle = h("h1", { class: "app-title" }, "Racks");
  appMain = h("main", { class: "app-main" });
  appMapEl = h("div", { class: "app-map", hidden: true });
  appTabs = h("nav", { class: "app-tabs", "aria-label": "Sections" }, [["racks", "Racks", "racks"], ["map", "Map", "signal"], ["card", "My Card", "card"], ["alerts", "Alerts", "alerts"]].map(([id, label, ic]) =>
    h("a", { href: `#${id}`, "data-tab": id, onClick: (e) => { e.preventDefault(); appGo(id); } }, icon(ic), h("span", {}, label))));
  appSheet = h("div", { class: "app-sheet", hidden: true });
  root.append(h("header", { class: "app-head" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 26 }).el), appTitle), appMain, appMapEl, appTabs, appSheet);
}
function appGo(id) {
  tab = id;
  for (const a of appTabs.querySelectorAll("a")) { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  appTitle.textContent = { racks: "Racks", map: "Map", card: "My Card", alerts: "Alerts" }[tab];
  appMain.hidden = tab === "map";
  appMapEl.hidden = tab !== "map";
  if (tab === "map" && !appMap) {
    appMap = rackMap(appMapEl, { look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" }, onSelect: (r) => openRack(r.id) });
    appMap.setRacks(S.racks.map(riderPin));
  }
  render();
}
function openSheet(title) {
  appSheet.hidden = false;
  const body = h("div");
  fill(appSheet, h("header", { class: "app-sheet-head" }, btn([icon("back"), "Back"], () => { appSheet.hidden = true; fill(appSheet); openId = null; }, "btn-quiet back-btn"), h("b", {}, title)), body);
  appSheet.scrollTop = 0;
  return body;
}

// ---------- render ----------
let lastSig = "";
function render() {
  const sig = JSON.stringify([S.racks, here, openId, APP ? tab : page]);
  if (sig === lastSig) return;
  lastSig = sig;
  const open = S.racks.filter((r) => installed(r)).reduce((n, r) => n + r.openSpots, 0);
  const sum = document.querySelector("#rsum");
  if (sum) sum.replaceChildren(h("b", {}, String(open)), ` open spot${open === 1 ? "" : "s"} on campus`);
  map?.setRacks(S.racks.map(riderPin));
  appMap?.setRacks(S.racks.map(riderPin));
  const cards = sorted().map((r) => rackCard(r, openRack));
  if (!APP) {
    fill(listEl, cards.length ? cards : h("p", { class: "empty" }, "No racks yet."));
    if (page === "alerts") fill(pageEl, alertsPage());
    return;
  }
  if (tab === "racks") fill(appMain, h("div", { class: "rider-top" }, h("span", {}, h("b", {}, String(open)), ` open spot${open === 1 ? "" : "s"} on campus`), btn("Find Nearest", findNearest, "btn-primary")),
    h("div", { class: "rider-list" }, cards.length ? cards : h("p", { class: "app-empty" }, "No racks yet.")),
    h("a", { class: "btn btn-quiet", href: "?view=desktop" }, "Desktop View"));
  if (tab === "card") fill(appMain, myCard());
  if (tab === "alerts") fill(appMain, alertsPage());
}

live.on("change", render);
const root = document.querySelector("#root");
root.append(toasts);
if (APP) buildApp(root); else buildDesktop(root);
await live.start();
if (APP) appGo(["racks", "map", "card", "alerts"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "racks");
else go(["card", "alerts"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "racks");
render();
window.__rider = { live, openRack };
