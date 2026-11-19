// RIDER version (/rider/): for the everyday bike user. No login. Every rack answers the two things a
// rider wants first (Miles): how many open spots, and is there an alarm (and when was the last one).
// Browser: rack list beside the campus map. App (phone, ?view=app): tabs Racks / Map / My Card / Alerts.
// Riders never see anyone's card, and don't need to know about the rack's connection (Miles).
// Map pins (Miles): green = plenty of spots, yellow = under 25% open, red = full,
// flashing red with a slash and a red pulse = an alarm or a report (police incident open).
import { h, ago } from "../js/dom.js";
import { riveIcon } from "../js/rive.js";
import { rackMap } from "./map.js";
import { icon } from "./icons.js";
import { createLive, isAlarm } from "./live.js";
import { apiUrl, backendReady } from "../js/backend.js";

const params = new URLSearchParams(location.search);
const APP = params.get("view") === "app" || (params.get("view") !== "desktop" && matchMedia("(max-width: 760px)").matches);
document.body.classList.toggle("view-app", APP);
const fill = (el, ...kids) => (el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)), el);
const btn = (label, onClick, cls = "", attrs = {}) => h("button", { class: `btn ${cls}`, type: "button", onClick, ...attrs }, label);

const live = createLive({ every: 5000, want: {} });
const S = live.state;
let here = null;   // { lat, lng } after Find Nearest
let openId = null;

// ---------- you: your rider code (kept on this phone), where your bike is, warnings ----------
// Riders ask for access online (the stand-in for StarRez); staff approve; the rider links their Hokie
// Passport with one tap on any rack. The private code is the key, so it's kept only on this device.
const CODE_KEY = "hbr.riderCode";
let myCode = localStorage.getItem(CODE_KEY);
let me = null;          // GET /rider/me
let meError = "";
const warned = new Set();
/** Calls the rider API with this device's rider code (if any). Throws an Error with the server's message. */
async function riderApi(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (myCode) headers["X-Rider-Code"] = myCode;
  if (body) headers["Content-Type"] = "application/json";
  let res;
  await backendReady();
  try { res = await fetch(apiUrl(path), { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Can't reach HokieBikeRack right now."); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && (data.detail || data.message)) || `Error ${res.status}`);
    err.status = res.status;
    err.fields = data && data.errors;
    throw err;
  }
  return data;
}
/** Reloads "my card" (where my bike is parked, alarms there) for the saved rider code. */
async function refreshMe() {
  if (!myCode) { me = null; return; }
  try { me = await riderApi("/rider/me"); meError = ""; }
  catch (e) { if (e.status === 404) { meError = "That rider code doesn't match anyone. Check it, or request access."; me = null; } }
}
/** IDs of the racks my bike is parked at. */
const myRackIds = () => new Set((me?.parked || []).map((p) => p.rackId));
/** Racks with my bike that have an alarm or a police report (for the banner). */
function myWarnings() {
  return (me?.parked || []).filter((p) => p.alarm || p.reported);
}

// ---------- words riders read ----------
const installed = (r) => r.deviceCount > 0;
/** Reported to the police (an incident is open). */
const reported = (r) => Boolean(r.incidentStatus);
/** Under a quarter of its spots are open. */
const few = (r) => r.openSpots > 0 && r.openSpots / r.capacity < 0.25;
/** The open-spots badge for a rack: big text, small text and colour. */
function spots(r) {
  if (!installed(r)) return { big: "-", small: "Not open yet", cls: "muted" };
  if (reported(r)) return { big: "Closed", small: "Reported", cls: "reported" };
  if (isAlarm(r)) return { big: "Alarm", small: "Alarm now", cls: "reported" };
  if (r.openSpots === 0) return { big: "Full", small: `${r.capacity} of ${r.capacity} in use`, cls: "full" };
  return { big: String(r.openSpots), small: `of ${r.capacity} spot${r.capacity === 1 ? "" : "s"} open`, cls: few(r) ? "few" : "open" };
}
/** The alarm line for a rack: now, last time, or never. */
function alarm(r) {
  if (isAlarm(r)) return { text: "Alarm now", sub: "Staff have been alerted", cls: "alarm" };
  if (r.lastAlarmAt) return { text: `Last alarm ${ago(r.lastAlarmAt)}`, sub: "Quiet now", cls: "" };
  return { text: "No alarms", sub: "Never had one", cls: "calm" };
}
/** One plain sentence about the rack for a rider (closed, full, alarm...). */
function sentence(r) {
  if (!installed(r)) return "This rack isn't open yet.";
  if (reported(r)) return "This rack was reported to the police. Please use another rack for now.";
  if (isAlarm(r)) return "Someone tampered with this rack. Bikes stay locked; staff are on it.";
  if (r.openSpots === 0) return "Full right now. Try a nearby rack.";
  if (few(r)) return "Almost full. Tap your card on the reader: a green light and one beep, and it's open for 5 seconds.";
  return "Ready. Tap your card on the reader: a green light and one beep, and it's open for 5 seconds.";
}
/** How far the rack is from me in km (null until "Find Nearest" got my location). */
const distKm = (r) => (here && r.latitude != null ? haversine(here.lat, here.lng, r.latitude, r.longitude) : null);
/** Distance in km between two latitude/longitude points (great-circle). */
function haversine(a, b, c, d) {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** Walking time at about 80 m a minute. */
const walk = (km) => (km < 0.05 ? "right here" : `${Math.max(1, Math.round((km * 1000) / 80))} min walk`);
// pin.riv states: 0 green, 5 yellow, 6 red, 7 flashing red + slash, 3 grey (not open yet).
const riderPin = (r) => ({ ...r,
  pin: !installed(r) ? 3 : reported(r) || isAlarm(r) ? 7 : r.openSpots === 0 ? 6 : few(r) ? 5 : 0,
  label: `${r.name} · ${!installed(r) ? "not open" : reported(r) ? "reported" : isAlarm(r) ? "alarm" : r.openSpots === 0 ? "full" : `${r.openSpots} open`}` });

/** Racks in list order: nearest first once my location is known, otherwise by name. */
function sorted() {
  const list = S.racks.filter((r) => r.latitude != null || installed(r));
  return list.sort((a, b) => {
    if (here) return (distKm(a) ?? 1e9) - (distKm(b) ?? 1e9);
    const score = (r) => (!installed(r) ? -3 : reported(r) || isAlarm(r) ? -2 : r.openSpots === 0 ? -1 : r.openSpots);
    return score(b) - score(a) || a.name.localeCompare(b.name);
  });
}

// ---------- pieces ----------
function rackCard(r, onOpen) {
  const sp = spots(r), al = alarm(r), km = distKm(r);
  return h("button", { type: "button", class: `rider-card${r.id === openId ? " current" : ""}`, onClick: () => onOpen(r.id) },
    h("span", { class: `rc-spots ${sp.cls}` }, h("b", {}, sp.big), h("small", {}, ["Full", "-", "Closed", "Alarm"].includes(sp.big) ? "" : "open")),
    h("span", { class: "rc-main" }, h("b", {}, r.name, myRackIds().has(r.id) ? h("span", { class: "chip mine" }, "Your bike") : null),
      h("span", {}, [r.locationDescription, km != null ? walk(km) : null].filter(Boolean).join(" · ")),
      h("span", { class: `rc-alarm ${al.cls}` }, al.text)),
    icon("back"));
}
/** A rack's detail: animation, open spots, alarms and how to park with your card. */
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
        h("div", { class: `fact ${sp.cls}` }, h("span", {}, "Open Spots"), h("b", {}, ["-", "Full", "Closed"].includes(sp.big) ? sp.big
          : sp.big === "Alarm" ? (r.openSpots === 0 ? "Full" : `${r.openSpots} of ${r.capacity}`) : `${sp.big} of ${r.capacity}`)),
        h("div", { class: `fact ${al.cls === "alarm" ? "alarm" : ""}` }, h("span", {}, "Alarm"), h("b", {}, isAlarm(r) ? "Active now" : r.lastAlarmAt ? ago(r.lastAlarmAt) : "None"),
          h("small", {}, isAlarm(r) ? "Staff have been alerted" : r.lastAlarmAt ? "since the last alarm" : "never had one"))),
      myRackIds().has(r.id) ? h("p", { class: "state mine-state" }, `Your bike is parked here${(() => { const p = me.parked.find((x) => x.rackId === r.id); return p?.since ? ` since ${new Date(p.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""; })()}.`) : null,
      h("p", { class: `state ${isAlarm(r) || reported(r) ? "state-alarm" : r.openSpots === 0 || few(r) ? "state-warning" : ""}` }, sentence(r)),
      h("div", { class: "panel-actions" }, dirs ? h("a", { class: "btn btn-primary", href: dirs, target: "_blank", rel: "noopener" }, "Directions") : null),
      h("h2", {}, "How It Works"),
      h("ol", { class: "how" },
        h("li", {}, h("b", {}, "Park"), " Tap your card on the reader. Green light, one beep: lock your bike in within 5 seconds."),
        h("li", {}, h("b", {}, "Leave"), " Tap the same card again to unlock and take your bike. That's how open spots are counted."),
        h("li", {}, h("b", {}, "Red light, two beeps?"), " Your card isn't registered for this rack. See My Card."))));
}
/** The My Card page: enter a rider code, or see where your bike is. */
function myCard() {
  const page = h("div", { class: "sheet-inner rider-page rider-me-live" }, h("h1", {}, "My Card"));
  const forget = () => { if (!confirm("Forget your rider code on this device? Keep a copy first if you want to use it again.")) return;
    localStorage.removeItem(CODE_KEY); myCode = null; me = null; warned.clear(); renderBanner(); render(true); };

  // 1. Not set up on this device: request access online, or enter a code you already have.
  if (!myCode || (!me && meError)) {
    const name = h("input", { class: "input", required: true, maxlength: "120", autocomplete: "name", placeholder: "Full name" });
    const email = h("input", { class: "input", required: true, type: "email", maxlength: "160", autocomplete: "email", placeholder: "pid@vt.edu" });
    const hokie = h("input", { class: "input", inputmode: "numeric", pattern: "\\d{9}", maxlength: "9", placeholder: "906123456 (optional)" });
    const note = h("input", { class: "input", maxlength: "500", placeholder: "Where you usually park (optional)" });
    const err = h("p", { class: "form-err", role: "alert" });
    const codeIn = h("input", { class: "input", maxlength: "12", placeholder: "K7P2-QM4X", autocapitalize: "characters", spellcheck: "false" });
    const codeErr = h("p", { class: "form-err", role: "alert" }, meError);
    const field = (label, input, hint) => h("label", { class: "field" }, h("span", {}, label), input, hint ? h("small", { class: "hint" }, hint) : null);
    return fill(page,
      h("div", { class: "card-art" }, riveIcon("badge", { size: 72, inputs: { kind: 6 } }).el,
        h("div", {}, h("b", {}, "Use your Hokie Passport on the racks"), h("span", {}, "Request access online. Once staff approve it, link your HokieP with one tap."))),
      h("h2", {}, "Request Access"),
      h("form", { class: "stack-form", onSubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        try {
          const res = await riderApi("/rider/request", { method: "POST", body: { name: name.value.trim(), email: email.value.trim(),
            hokiePassportId: hokie.value.trim() || null, note: note.value.trim() || null } });
          myCode = res.code;
          localStorage.setItem(CODE_KEY, myCode);
          toast("Request sent. Staff will approve it.");
          await refreshMe();
          render(true);
        } catch (x) { err.textContent = x.fields ? Object.entries(x.fields).map(([k, v]) => `${k}: ${v}`).join(". ") : x.message; }
      } },
      field("Name", name), field("VT Email", email), field("Hokie Passport ID", hokie, "The 9-digit number on your card."), field("Note", note), err,
      h("button", { class: "btn btn-primary", type: "submit" }, "Send Request")),
      h("p", { class: "hint" }, "This stands in for the StarRez form. Requests go to HokieBikeRack staff."),
      h("h2", {}, "Already Have a Rider Code?"),
      h("form", { class: "inline-form", onSubmit: async (e) => {
        e.preventDefault();
        myCode = codeIn.value.trim();
        localStorage.setItem(CODE_KEY, myCode);
        await refreshMe();
        if (!me) { localStorage.removeItem(CODE_KEY); myCode = null; }
        render(true);
      } }, codeIn, h("button", { class: "btn", type: "submit" }, "Use Code")),
      codeErr);
  }
  if (!me) return fill(page, h("p", { class: "empty" }, "Loading…"));

  const codeLine = h("p", { class: "hint" }, "Your rider code is saved on this device. ", btn("Forget This Device", forget, "btn-quiet"));
  // 2. Waiting for staff.
  if (me.status === "PENDING") {
    return fill(page, h("div", { class: "card-art" }, riveIcon("badge", { size: 72, inputs: { kind: 0 } }).el,
      h("div", {}, h("b", {}, `Request sent, ${me.name.split(" ")[0]}`), h("span", {}, "Staff will review it. This page updates by itself."))),
    h("p", { class: "secret-inline" }, "Your rider code: ", h("b", {}, myCode), ". Keep it to use another phone."), codeLine);
  }
  if (me.status === "DENIED") {
    return fill(page, h("p", { class: "state state-alarm" }, "Your request wasn't approved. Ask HokieBikeRack staff why."), codeLine);
  }
  // 3. Approved, no card yet: link the Hokie Passport with one tap.
  if (!me.cards.length) {
    const left = me.linkUntil ? Math.max(0, Math.round((Date.parse(me.linkUntil) - Date.now()) / 1000)) : 0;
    return fill(page,
      h("div", { class: "card-art" }, riveIcon("badge", { size: 72, inputs: { kind: 1 } }).el,
        h("div", {}, h("b", {}, `You're approved, ${me.name.split(" ")[0]}`), h("span", {}, "Last step: link your Hokie Passport."))),
      left > 0
        ? h("div", { class: "link-now" }, h("b", {}, "Tap your Hokie Passport on any rack now"), h("span", {}, `Waiting… ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left. It will beep red once; that's fine, it's being linked.`))
        : h("div", { class: "stack-form" },
          h("ol", { class: "how" }, h("li", {}, "Walk to any HokieBikeRack."), h("li", {}, "Press Link My HokieP below."), h("li", {}, "Within 2 minutes, tap your Hokie Passport on the reader.")),
          btn("Link My HokieP", async () => {
            try { me = await riderApi("/rider/link", { method: "POST" }); render(true); } catch (x) { toast(x.message); }
          }, "btn-primary big-btn")),
      codeLine);
  }
  // 4. All set: your card and where your bike is.
  const parked = me.parked;
  return fill(page,
    h("div", { class: "card-art" }, riveIcon("badge", { size: 72, inputs: { kind: 1 } }).el,
      h("div", {}, h("b", {}, `Hi, ${me.name.split(" ")[0]}`), h("span", {}, me.cards.map((c) => `${c.label}${c.active ? "" : " (turned off)"}`).join(" · ")))),
    h("h2", {}, "Your Bike"),
    parked.length ? h("div", { class: "inc-list" }, parked.map((p) => h("button", { type: "button", class: "inc-row", onClick: () => openRack(p.rackId) },
      riveIcon("badge", { size: 26, inputs: { kind: p.alarm || p.reported ? 4 : 1 } }).el,
      h("span", { class: "needs-main" }, h("b", {}, p.rackName),
        h("span", {}, p.alarm || p.reported ? "Alarm at this rack. Staff have been alerted." : `Parked${p.since ? ` since ${new Date(p.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}${p.lastAlarmAt ? ` · last alarm ${ago(p.lastAlarmAt)}` : ""}`)))))
      : h("p", { class: "empty" }, "Not parked right now. Tap in at a rack and it shows here."),
    h("h2", {}, "How It Works"),
    h("ol", { class: "how" },
      h("li", {}, h("b", {}, "Park"), " Tap your HokieP. Green light, one beep: lock your bike in within 5 seconds."),
      h("li", {}, h("b", {}, "Leave"), " Tap again to unlock and take your bike."),
      h("li", {}, h("b", {}, "Alarm?"), " If someone tampers with the rack holding your bike, you get a warning here.")),
    codeLine);
}

/** The Alerts page: racks with an alarm or a police report right now. */
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

/** Find Nearest: asks for my location, then opens the closest rack with open spots. */
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
/** A short message at the bottom of the screen. */
function toast(text) {
  const t = h("div", { class: "toast" }, text);
  toasts.append(t);
  setTimeout(() => t.classList.add("leaving"), 3600);
  setTimeout(() => t.remove(), 4000);
}

// ---------- desktop ----------
let map, listEl, pageEl, detailEl, page = "racks";
/** Builds the browser layout: map, rack list and detail panel. */
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
/** Switches page in the browser layout (racks, my card, alerts). */
function go(p) {
  page = p;
  pageEl.hidden = p === "racks";
  for (const a of document.querySelectorAll(".top-nav a")) { if (a.dataset.page === p) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  if (p === "card") fill(pageEl, myCard());
  if (p === "alerts") fill(pageEl, alertsPage());
}
/** Opens a rack's detail (panel, or sheet in the app layout). */
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
/** Closes the rack detail. */
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
/** Builds the phone app layout with bottom tabs. */
function buildApp(root) {
  appTitle = h("h1", { class: "app-title" }, "Racks");
  appMain = h("main", { class: "app-main" });
  appMapEl = h("div", { class: "app-map", hidden: true });
  appTabs = h("nav", { class: "app-tabs", "aria-label": "Sections" }, [["racks", "Racks", "racks"], ["map", "Map", "signal"], ["card", "My Card", "card"], ["alerts", "Alerts", "alerts"]].map(([id, label, ic]) =>
    h("a", { href: `#${id}`, "data-tab": id, onClick: (e) => { e.preventDefault(); appGo(id); } }, icon(ic), h("span", {}, label))));
  appSheet = h("div", { class: "app-sheet", hidden: true });
  root.append(h("header", { class: "app-head" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 26 }).el), appTitle), appMain, appMapEl, appTabs, appSheet);
}
/** Switches tab in the app layout. */
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
/** Opens a full-screen sheet in the app layout; returns its body to fill. */
function openSheet(title) {
  appSheet.hidden = false;
  const body = h("div");
  fill(appSheet, h("header", { class: "app-sheet-head" }, btn([icon("back"), "Back"], () => { appSheet.hidden = true; fill(appSheet); openId = null; }, "btn-quiet back-btn"), h("b", {}, title)), body);
  appSheet.scrollTop = 0;
  return body;
}

// ---------- render ----------
let lastSig = "";
/** Redraws what's on screen, only if the data changed (force = always). */
function render(force = false) {
  const sig = JSON.stringify([S.racks, here, openId, APP ? tab : page, me, meError]);
  if (sig === lastSig && !force) return;
  if (sig === lastSig && force && !document.querySelector(".rider-me-live")) return;
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
    if (page === "card" && !pageEl.contains(document.activeElement)) fill(pageEl, myCard());
    return;
  }
  if (tab === "racks") fill(appMain, h("div", { class: "rider-top" }, h("span", {}, h("b", {}, String(open)), ` open spot${open === 1 ? "" : "s"} on campus`), btn("Find Nearest", findNearest, "btn-primary")),
    h("div", { class: "rider-list" }, cards.length ? cards : h("p", { class: "app-empty" }, "No racks yet.")),
    h("a", { class: "btn btn-quiet", href: "?view=desktop" }, "Desktop View"));
  if (tab === "card" && !appMain.contains(document.activeElement)) fill(appMain, myCard());
  if (tab === "alerts") fill(appMain, alertsPage());
}

const banner = h("div", { class: "rider-warning", role: "alert", hidden: true });
/** The red banner when a rack with my bike has an alarm or was reported. */
function renderBanner() {
  const w = myWarnings();
  banner.hidden = !w.length;
  if (!w.length) { fill(banner); return; }
  const p = w[0];
  fill(banner, riveIcon("badge", { size: 30, inputs: { kind: 4 } }).el,
    h("div", {}, h("b", {}, p.reported ? `Your bike's rack was reported: ${p.rackName}` : `Alarm at ${p.rackName}, where your bike is`),
      h("span", {}, p.reported ? "The police were alerted. Check on your bike when it's safe." : "Someone is tampering with that rack. Staff have been alerted.")),
    btn("See Rack", () => openRack(p.rackId), "btn-danger"));
  for (const x of w) {
    const key = `${x.rackId}-${x.reported ? "r" : "a"}`;
    if (!warned.has(key)) { warned.add(key); toast(`Your bike: alarm at ${x.rackName}`); }
  }
}
live.on("change", async () => { await refreshMe(); renderBanner(); render(true); });
const root = document.querySelector("#root");
root.append(toasts, banner);
if (APP) buildApp(root); else buildDesktop(root);
// In the app the warning sits in the page under the header (it would cover content if it floated).
if (APP) document.querySelector(".app-head").after(banner);
await live.start();
if (APP) appGo(["racks", "map", "card", "alerts"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "racks");
else go(["card", "alerts"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "racks");
render();
window.__rider = { live, openRack };
