// POLICE version (/police/): incidents first. An admin or staff member pressed Alert Authorities on a
// tamper alarm; police see where it is, what the rack reported (timeline), and move it along:
// On My Way -> On Scene -> Resolved. No card or rider data here (roles-plan.md).
// Browser: incident list + map + detail. App (phone, ?view=app): tabs Incidents / Map / History.
import { h, ago } from "../js/dom.js";
import { api } from "../js/api.js";
import { riveIcon } from "../js/rive.js";
import { rackMap } from "./map.js";
import { icon } from "./icons.js";
import { createLive, isAlarm, pinRack, INCIDENT_WORD } from "./live.js";

const params = new URLSearchParams(location.search);
const APP = params.get("view") === "app" || (params.get("view") !== "desktop" && matchMedia("(max-width: 760px)").matches);
document.body.classList.toggle("view-app", APP);
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const btn = (label, onClick, cls = "", attrs = {}) => h("button", { class: `btn ${cls}`, type: "button", onClick, ...attrs }, label);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const NEXT = { ALERTED: ["EN_ROUTE", "On My Way"], EN_ROUTE: ["ON_SCENE", "On Scene"], ON_SCENE: ["RESOLVED", "Resolved"] };
const EVENT_WORD = { TAMPER_WARNING: "Rack shaken (warning chirp)", TAMPER_ALARM: "Tamper alarm, siren on", ACCESS_GRANTED: "A registered card unlocked it",
  ACCESS_DENIED: "An unknown card was refused", DEVICE_BOOT: "Lock module restarted" };

const live = createLive({ every: 4000, want: { incidents: true } });
const S = live.state;
let openIncident = null;   // id
let showHistory = false;

const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
function toast(text, bad = false) {
  const t = h("div", { class: `toast${bad ? " bad" : ""}` }, text);
  toasts.append(t);
  setTimeout(() => t.classList.add("leaving"), 4200);
  setTimeout(() => t.remove(), 4600);
}

// ---------- incident detail ----------
async function renderIncident(body, id) {
  let d;
  try { d = await api(`/incidents/${id}`); } catch (e) { fill(body, h("p", { class: "empty" }, e.message)); return; }
  const i = d.incident;
  const rack = S.racks.find((r) => r.id === i.rackId);
  const next = NEXT[i.status];
  const note = h("textarea", { class: "input", rows: "2", maxlength: "500", placeholder: next?.[0] === "RESOLVED" ? "What happened? (optional)" : "Note (optional)", "aria-label": "Note" });
  const steps = ["ALERTED", "EN_ROUTE", "ON_SCENE", "RESOLVED"];
  const at = steps.indexOf(i.status);
  // Timeline: what the rack reported and what people did, in order.
  const items = [
    ...d.rackEvents.map((e) => ({ at: e.occurredAt, kind: e.eventType === "TAMPER_ALARM" ? "alarm" : e.eventType === "TAMPER_WARNING" ? "warn" : "info",
      text: EVENT_WORD[e.eventType] || e.eventType.toLowerCase().replaceAll("_", " "), sub: e.details?.deviationG ? `Jolt ${e.details.deviationG} g` : "" })),
    ...d.updates.map((u) => ({ at: u.at, kind: "police", text: u.status === "ALERTED" ? `Reported to ${i.agency}` : INCIDENT_WORD[u.status], sub: [u.actor, u.note].filter(Boolean).join(" · ") })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const dirs = i.latitude != null ? `https://www.openstreetmap.org/directions?to=${i.latitude},${i.longitude}#map=18/${i.latitude}/${i.longitude}` : null;
  fill(body,
    h("div", { class: "pol-head" }, riveIcon("police", { size: 96, height: 64, inputs: { state: i.status === "RESOLVED" ? 2 : 2 } }).el,
      h("div", {}, h("h1", { class: "panel-title" }, i.rackName), h("p", { class: "panel-sub" }, i.rackLocation || "Location not described"))),
    h("ol", { class: "incident-steps big" }, steps.map((s, n) => h("li", { class: n <= at ? "done" : "" }, INCIDENT_WORD[s]))),
    h("div", { class: "facts" },
      h("div", { class: "fact" }, h("span", {}, "Reported"), h("b", {}, `${time(i.alertedAt)}`), h("small", {}, `${ago(i.alertedAt)} by ${i.alertedBy}`)),
      h("div", { class: rack && isAlarm(rack) ? "fact alarm" : "fact" }, h("span", {}, "Rack Alarm"), h("b", {}, rack ? (isAlarm(rack) ? "Still active" : "Stopped") : "-"))),
    i.note ? h("p", { class: "state" }, `Note: ${i.note}`) : null,
    next ? h("form", { class: "stack-form", onSubmit: async (e) => {
      e.preventDefault();
      try {
        await api(`/incidents/${i.id}/status`, { method: "POST", body: { status: next[0], note: note.value.trim() || null } });
        toast(next[0] === "RESOLVED" ? "Resolved. The rack's alarm is stopped." : `Marked: ${next[1]}`);
        await live.refresh();
        renderIncident(body, i.id);
      } catch (err) { toast(err.message, true); }
    } }, note, h("div", { class: "panel-actions" }, h("button", { class: `btn ${next[0] === "RESOLVED" ? "btn-primary" : "btn-police"} big-btn`, type: "submit" }, next[1]),
      next[0] !== "RESOLVED" ? btn("Resolved", async () => {
        if (!confirm("Mark this incident resolved? This also stops the rack's alarm.")) return;
        try { await api(`/incidents/${i.id}/status`, { method: "POST", body: { status: "RESOLVED", note: note.value.trim() || null } }); toast("Resolved. The rack's alarm is stopped."); await live.refresh(); renderIncident(body, i.id); } catch (err) { toast(err.message, true); }
      }, "btn-quiet") : null,
      dirs ? h("a", { class: "btn btn-quiet", href: dirs, target: "_blank", rel: "noopener" }, "Directions") : null))
      : h("p", { class: "state" }, `Resolved ${ago(i.resolvedAt)}.`),
    h("h2", {}, "Timeline"),
    h("ol", { class: "timeline" }, items.map((t) => h("li", { class: `tl-${t.kind}` }, h("span", { class: "tl-time" }, time(t.at)),
      h("span", {}, h("b", {}, t.text), t.sub ? h("small", {}, t.sub) : null)))),
  );
}

// ---------- lists ----------
function incidentRow(i, onOpen) {
  return h("button", { type: "button", class: `inc-row${i.id === openIncident ? " current" : ""}`, onClick: () => onOpen(i.id) },
    riveIcon("badge", { size: 28, inputs: { kind: 7 } }).el,
    h("span", { class: "needs-main" }, h("b", {}, i.rackName), h("span", {}, `${INCIDENT_WORD[i.status]} · reported ${ago(i.alertedAt)}`)),
    h("span", { class: `chip chip-${i.status}` }, INCIDENT_WORD[i.status]));
}
function alarmRow(r, onOpen) {
  return h("button", { type: "button", class: "inc-row", onClick: () => onOpen(r) },
    riveIcon("badge", { size: 28, inputs: { kind: 4 } }).el,
    h("span", { class: "needs-main" }, h("b", {}, r.name), h("span", {}, "Tamper alarm, not reported to police yet")),
    h("span", { class: "chip" }, "Live"));
}

async function historyList(el, onOpen) {
  fill(el, h("p", { class: "empty" }, "Loading…"));
  try {
    const all = await api("/incidents", { query: { open: false } });
    const done = all.filter((i) => i.status === "RESOLVED");
    fill(el, done.length ? done.map((i) => incidentRow(i, onOpen)) : h("p", { class: "empty" }, "No past incidents."));
  } catch (e) { fill(el, h("p", { class: "empty" }, e.message)); }
}

// ---------- desktop ----------
let map, listEl, detailEl, summaryEl;
function buildDesktop(root) {
  summaryEl = h("span", { class: "top-summary" });
  listEl = h("div", { class: "pol-list" });
  detailEl = h("div", { class: "pol-detail", hidden: true });
  const mapEl = h("div", { class: "map" });
  const histBtn = btn("Past Incidents", () => { showHistory = !showHistory; histBtn.textContent = showHistory ? "Open Incidents" : "Past Incidents"; renderList(); }, "btn-quiet");
  root.append(h("header", { class: "top" },
    h("a", { class: "brand", href: "#" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 28 }).el), "HokieBikeRack", h("span", { class: "role-tag police-tag" }, "Police")),
    summaryEl, h("a", { class: "view-switch", href: "?view=app" }, "App View"), h("a", { class: "view-switch", href: "/" }, "Versions")),
  h("main", { class: "pol-stage" },
    h("aside", { class: "pol-side" }, h("div", { class: "pol-side-head" }, h("h2", {}, "Incidents"), histBtn), listEl, detailEl),
    h("section", { class: "map-area" }, mapEl)));
  map = rackMap(mapEl, { look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" }, onSelect: (r) => {
    const i = S.incidents.find((x) => x.rackId === r.id);
    if (i) openDetail(i.id);
  } });
  map.setInset({ left: 0 });
}
function renderList() {
  if (showHistory) { historyList(listEl, openDetail); return; }
  const alarms = S.racks.filter((r) => isAlarm(r) && !r.incidentStatus);
  fill(listEl,
    S.incidents.length ? S.incidents.map((i) => incidentRow(i, openDetail))
      : h("div", { class: "all-clear" }, riveIcon("police", { size: 96, height: 64, inputs: { state: 0 } }).el, h("b", {}, "No open incidents"), h("span", {}, "Reports from campus staff appear here.")),
    alarms.length ? [h("h3", { class: "needs-group" }, "Live Alarms, Not Reported"), alarms.map((r) => alarmRow(r, (rr) => map?.select(rr.id)))] : null);
}
function openDetail(id) {
  openIncident = id;
  const i = S.incidents.find((x) => x.id === id);
  if (APP) {
    const body = openSheet(i ? i.rackName : "Incident");
    renderIncident(body, id);
    return;
  }
  detailEl.hidden = false;
  listEl.hidden = true;
  const back = btn([icon("back"), "All Incidents"], closeDetail, "btn-quiet back-btn");
  const body = h("div", { class: "pol-detail-body" });
  fill(detailEl, back, body);
  renderIncident(body, id);
  if (i) map.select(i.rackId);
}
function closeDetail() {
  openIncident = null;
  detailEl.hidden = true;
  listEl.hidden = false;
  map?.select(null, { move: false });
  renderList();
}

// ---------- app ----------
let appMain, appTabs, appSheet, appTitle, appMapEl, appMap = null;
let tab = "incidents";
function buildApp(root) {
  appTitle = h("h1", { class: "app-title" }, "Incidents");
  appMain = h("main", { class: "app-main" });
  appMapEl = h("div", { class: "app-map", hidden: true });
  appTabs = h("nav", { class: "app-tabs tabs-3", "aria-label": "Sections" }, [["incidents", "Incidents", "alerts"], ["map", "Map", "racks"], ["history", "History", "health"]].map(([id, label, ic]) =>
    h("a", { href: `#${id}`, "data-tab": id, onClick: (e) => { e.preventDefault(); appGo(id); } }, icon(ic), h("span", {}, label))));
  appSheet = h("div", { class: "app-sheet", hidden: true });
  root.append(h("header", { class: "app-head" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 26 }).el), appTitle, h("span", { class: "role-tag police-tag" }, "Police")),
    appMain, appMapEl, appTabs, appSheet);
}
function appGo(id) {
  tab = id;
  for (const a of appTabs.querySelectorAll("a")) { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  appTitle.textContent = { incidents: "Incidents", map: "Map", history: "History" }[tab];
  appMain.hidden = tab === "map";
  appMapEl.hidden = tab !== "map";
  if (tab === "map" && !appMap) {
    appMap = rackMap(appMapEl, { look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" }, onSelect: (r) => {
      const i = S.incidents.find((x) => x.rackId === r.id);
      if (i) openDetail(i.id);
    } });
    appMap.setRacks(S.racks.map(pinRack));
  }
  renderApp();
}
function renderApp() {
  if (tab === "incidents") {
    const alarms = S.racks.filter((r) => isAlarm(r) && !r.incidentStatus);
    fill(appMain,
      S.incidents.length ? h("div", { class: "inc-list" }, S.incidents.map((i) => incidentRow(i, openDetail)))
        : h("section", { class: "all-clear" }, riveIcon("police", { size: 96, height: 64, inputs: { state: 0 } }).el, h("b", {}, "No open incidents"), h("span", {}, "Reports from campus staff appear here.")),
      alarms.length ? h("div", { class: "inc-list" }, h("h3", { class: "needs-group" }, "Live Alarms, Not Reported"), alarms.map((r) => alarmRow(r, () => appGo("map")))) : null,
      h("a", { class: "btn btn-quiet", href: "?view=desktop" }, "Desktop View"));
  } else if (tab === "history") {
    const el = h("div", { class: "inc-list" });
    fill(appMain, el);
    historyList(el, (id) => openDetail(id));
  }
}
function openSheet(title) {
  appSheet.hidden = false;
  const body = h("div", { class: "app-rack" });
  fill(appSheet, h("header", { class: "app-sheet-head" }, btn([icon("back"), "Back"], () => { appSheet.hidden = true; fill(appSheet); openIncident = null; }, "btn-quiet back-btn"), h("b", {}, title)), body);
  return body;
}

// ---------- live ----------
live.on("change", (state) => {
  const n = state.incidents.length;
  if (summaryEl) summaryEl.replaceChildren(h("b", {}, String(n)), ` open incident${n === 1 ? "" : "s"}`);
  document.title = `${n ? `(${n}) ` : ""}Police · HokieBikeRack`;
  map?.setRacks(state.racks.map(pinRack));
  appMap?.setRacks(state.racks.map(pinRack));
  if (!APP && listEl && !openIncident) renderList();
  if (APP && tab !== "map" && appSheet.hidden) renderApp();
});
live.on("incident", ({ incident: i, before }) => {
  if (!before) toast(`New report: ${i.rackName}`, true);
});
live.on("connection", (ok) => document.body.classList.toggle("disconnected", !ok));

const root = document.querySelector("#root");
root.append(toasts);
if (APP) buildApp(root); else buildDesktop(root);
await live.start();
if (APP) appGo("incidents"); else renderList();
window.__police = { live, openDetail };
