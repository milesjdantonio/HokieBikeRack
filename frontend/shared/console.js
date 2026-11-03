// The control-room console used by the ADMIN and STAFF versions (body data-role="admin" | "staff").
// Real data from the backend. Browser layout: map + rack panel + Needs You + terminal. App layout
// (phone, or ?view=app): bottom tabs Now / Racks / Terminal (Activity for staff) / More.
//
// What each role can do is in CAN below (docs/notes/roles-plan.md). Every action is a real API call;
// nothing here fakes hardware (Miles: hardware is tested in person).
import { h, ago, shortRef, DENY_REASONS } from "../js/dom.js";
import { api } from "../js/api.js";
import { riveIcon } from "../js/rive.js";
import { rackMap, placeMap, searchPlaces } from "./map.js";
import { icon } from "./icons.js";
import { createLive, slug, findRack, isAlarm, isUp, pinRack, spotsText, alarmText, INCIDENT_WORD, STATUS_TEXT, bars } from "./live.js";

const ROLE = document.body.dataset.role === "staff" ? "staff" : "admin";
const CAN = ROLE === "admin"
  ? { terminal: true, configure: true, cards: true, audit: true, reports: true }
  : { terminal: false, configure: false, cards: false, audit: false, reports: true };
const AGENCY = "VT Police";
const BADGE = { info: 0, ok: 1, denied: 2, warning: 3, alarm: 4, offline: 5, card: 6, police: 7 };
const SCENE = { idle: 0, granted: 1, denied: 2, alarm: 3, offline: 4 };

const params = new URLSearchParams(location.search);
const APP = params.get("view") === "app" || (params.get("view") !== "desktop" && matchMedia("(max-width: 760px)").matches);
document.body.classList.toggle("view-app", APP);

const live = createLive({ want: { events: true, unknown: true, incidents: true, cards: CAN.cards, requests: CAN.configure } });
const S = live.state;
const rackById = (id) => S.racks.find((r) => r.id === id);
/** replaceChildren that skips null/false and flattens arrays (native replaceChildren prints "null"). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
/** 16:58:12 for terminal lines. */
const stamp = (iso) => new Date(iso || Date.now()).toTimeString().slice(0, 8);
const btn = (label, onClick, cls = "", attrs = {}) => h("button", { class: `btn ${cls}`, type: "button", onClick, ...attrs }, label);

/** Runs an API action, shows its error (if any) in a toast, refreshes the data. */
async function act(fn, done) {
  try {
    const res = await fn();
    if (done) toast(typeof done === "function" ? done(res) : done);
    await live.refresh();
    return res;
  } catch (e) {
    toast(e.message || "That didn't work.", true);
    return null;
  }
}

// ---------- toasts ----------
const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
function toast(text, bad = false) {
  const t = h("div", { class: `toast${bad ? " bad" : ""}` }, text);
  toasts.append(t);
  setTimeout(() => t.classList.add("leaving"), 3600);
  setTimeout(() => t.remove(), 4000);
}

// =====================================================================================
// Terminal (admin) / Activity feed (staff)
// =====================================================================================
const feed = h("div", { class: "term-feed", "aria-live": "polite" });
const termSignal = riveIcon("signal", { size: 20, inputs: { level: 4 } });
const cmdInput = h("input", { class: "term-input", id: "cmd", spellcheck: "false", autocapitalize: "off", autocomplete: "off", placeholder: "help" });
const KIND_BADGE = { ok: "ok", warn: "warning", alarm: "alarm", deny: "denied", off: "offline", card: "card", info: "info", cmd: "info", police: "police" };

/** parts: strings, or { b: "rack name" } for bold. Text only, never HTML. */
function log(kind, parts, { time, sim = false } = {}) {
  const msg = h("span", { class: "msg" }, [parts].flat().map((p) => (p && typeof p === "object" && "b" in p ? h("b", {}, p.b) : String(p ?? ""))),
    sim ? h("span", { class: "sim" }, "  simulated") : null);
  const line = h("div", { class: `line ${kind}` }, h("span", { class: "t" }, time || stamp(new Date().toISOString())),
    kind === "help" ? h("span", { class: "badge-space" }) : riveIcon("badge", { size: 18, inputs: { kind: BADGE[KIND_BADGE[kind]] ?? 0 } }).el, msg);
  feed.append(line);
  while (feed.children.length > 250) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
  termSignal.fire("blip");
}

/** One rack event as a terminal line. */
function eventLine(e, opts = {}) {
  const rack = { b: e.rackName ? slug(e.rackName) : "unknown rack" };
  const d = e.details || {};
  const who = e.credentialLabel || (e.credentialReference ? `card ${shortRef(e.credentialReference, 8)}` : "a card");
  const o = { time: stamp(e.occurredAt || e.receivedAt), sim: e.simulated, ...opts };
  switch (e.eventType) {
    case "ACCESS_GRANTED": return log("ok", [rack, ` ${who} unlocked`], o);
    case "ACCESS_DENIED": return log("deny", [rack, ` ${who} refused: ${(DENY_REASONS[d.reason] || d.reason || "not allowed here").toLowerCase()}`], o);
    case "TAMPER_WARNING": return log("warn", [rack, ` shake detected, jolt ${d.deviationG ?? "?"} g, warning chirp`], o);
    case "TAMPER_ALARM": return log("alarm", [rack, ` TAMPER ALARM, jolt ${d.deviationG ?? "?"} g, siren on`], o);
    case "DEVICE_BOOT": return log("info", [rack, ` lock module started${d.resetReason ? ` (${String(d.resetReason).toLowerCase()})` : ""}`], o);
    case "SENSOR_FAULT": return log("warn", [rack, ` sensor problem: ${String(d.sensor || d.component || "sensor").toLowerCase()} ${String(d.state || "").toLowerCase()}`], o);
    default: return log("info", [rack, ` ${e.eventType.toLowerCase().replaceAll("_", " ")}`], o);
  }
}

const HELP_LINES = [
  ["racks", "list racks and their status"],
  ["add <name>", "add a new rack: pick its spot on the map"],
  ["open <rack>", "open a rack"],
  ["ack <rack>", "mark a rack's alerts handled"],
  ["alert <rack> confirm", `alert ${AGENCY} about a rack's tamper alarm`],
  ["register <rack> <name>", "register the card waiting at a rack"],
  ["confirm <rack>", "confirm a rack is back online (check it in person first)"],
  ["rename <rack> <new name>", "rename a rack"],
  ["move <rack>", "move a rack's pin on the map"],
  ["cards [rack]", "list registered cards"],
  ["revoke <card name> confirm", "turn a card off for good"],
  ["incidents", "open police incidents"],
  ["requests", "riders asking for access online"],
  ["approve <name> / deny <name>", "decide an access request"],
  ["clear", "clear the terminal"],
];

async function run(text) {
  const parts = text.trim().split(/\s+/);
  const [cmd] = parts;
  if (!cmd) return;
  log("cmd", `${ROLE} $ ${text.trim()}`);
  const verb = cmd.toLowerCase();
  const needsRack = ["open", "ack", "alert", "register", "confirm", "move", "rename"].includes(verb);
  const r = needsRack ? findRack(S.racks, parts[1]) : null;
  if (needsRack && !r) {
    log("deny", parts[1] ? `no rack called "${parts[1]}". type racks to see their names` : `which rack? e.g. ${verb} ${S.racks[0] ? slug(S.racks[0].name) : "newman-library"}`);
    return;
  }
  switch (verb) {
    case "help":
      log("help", HELP_LINES.map(([c, d]) => `${c.padEnd(28)}${d}`).join("\n") + "\nthe Commands page has examples.");
      break;
    case "clear": fill(feed, ); break;
    case "racks":
      if (!S.racks.length) log("info", "no racks yet. add one on the map");
      for (const x of S.racks) {
        log(isAlarm(x) ? "alarm" : x.status === "OFFLINE" ? "off" : x.status === "ONLINE" ? "ok" : "warn",
          [{ b: slug(x.name).padEnd(22) }, isAlarm(x) ? "ALARM" : STATUS_TEXT[x.status].toLowerCase(), `, ${spotsText(x).toLowerCase()}`,
            x.incidentStatus ? `, ${AGENCY} ${INCIDENT_WORD[x.incidentStatus].toLowerCase()}` : ""]);
      }
      break;
    case "open": openRack(r.id); log("info", ["opened ", { b: slug(r.name) }]); break;
    case "add": {
      if (!CAN.configure) { log("deny", "adding racks is for admins"); break; }
      const name = parts.slice(1).join(" ");
      openPlaceSheet({ name });
      log("info", name ? `adding ${name}: click where it stands on the map, then Add Rack` : "adding a rack: name it, click where it stands, then Add Rack");
      break;
    }
    case "ack":
      if (!r.openAlerts) { log("info", [{ b: slug(r.name) }, " has no open alerts"]); break; }
      await ackRack(r);
      break;
    case "alert":
      if (!isAlarm(r)) { log("info", [{ b: slug(r.name) }, " isn't alarming. alert is for tamper alarms"]); break; }
      if (r.incidentStatus) { log("police", [{ b: slug(r.name) }, ` ${AGENCY} already ${INCIDENT_WORD[r.incidentStatus].toLowerCase()}`]); break; }
      if ((parts[2] || "").toLowerCase() !== "confirm") { log("warn", `this alerts ${AGENCY} about ${r.name}. to send it, type: alert ${slug(r.name)} confirm`); break; }
      await alertAuthorities(r);
      break;
    case "register": {
      const card = S.unknown.find((u) => u.lastRackId === r.id);
      if (!card) { log("info", [{ b: slug(r.name) }, " has no card waiting. tap the new card on the rack first"]); break; }
      const name = parts.slice(2).join(" ");
      if (!name) { log("deny", `give the card a name: register ${slug(r.name)} Jane Doe`); break; }
      await registerCard(card, name, r);
      break;
    }
    case "rename": {
      if (!CAN.configure) { log("deny", "renaming racks is for admins"); break; }
      const name = parts.slice(2).join(" ");
      if (!name) { log("deny", `give the new name: rename ${slug(r.name)} Goodwin Hall East`); break; }
      await renameRack(r, name);
      break;
    }
    case "confirm":
      if (r.status !== "UNCONFIRMED") { log("info", [{ b: slug(r.name) }, " isn't waiting to be confirmed"]); break; }
      await confirmOnline(r);
      break;
    case "move":
      if (APP) { openPlaceSheet({ rack: r }); break; }
      openRack(r.id); startMove(r); log("info", "click the map or drag the pin, then Save Spot");
      break;
    case "cards": {
      const rr = parts[1] ? findRack(S.racks, parts[1]) : null;
      const list = S.cards.filter((c) => c.status !== "REVOKED" && (!rr || c.allRacks || c.rackIds.includes(rr.id)));
      if (!list.length) log("info", "no cards registered yet");
      for (const c of list) log(c.active ? "ok" : "off", [{ b: c.displayLabel }, ` ${c.status.toLowerCase().replaceAll("_", " ")}, ${c.allRacks ? "all racks" : `${c.rackIds.length} rack(s)`}, used ${c.lastUsedAt ? ago(c.lastUsedAt) : "never"}`]);
      break;
    }
    case "revoke": {
      const confirmWord = parts[parts.length - 1].toLowerCase() === "confirm";
      const name = parts.slice(1, confirmWord ? -1 : undefined).join(" ").toLowerCase();
      const c = S.cards.find((x) => x.status !== "REVOKED" && x.displayLabel.toLowerCase() === name)
        || S.cards.find((x) => x.status !== "REVOKED" && x.displayLabel.toLowerCase().startsWith(name));
      if (!name || !c) { log("deny", name ? `no card called "${name}". type cards` : "which card? e.g. revoke Demo Rider confirm"); break; }
      if (!confirmWord) { log("warn", `this turns off ${c.displayLabel} for good. type: revoke ${c.displayLabel} confirm`); break; }
      await revokeCard(c);
      break;
    }
    case "requests":
      if (!CAN.configure) { log("deny", "access requests are for admins"); break; }
      if (!S.requests.length) log("info", "no access requests waiting");
      for (const q of S.requests) log("card", [{ b: q.name }, ` ${q.email}${q.hokiePassportId ? `, HokieP ${q.hokiePassportId}` : ""}, asked ${ago(q.requestedAt)}`]);
      break;
    case "approve":
    case "deny": {
      if (!CAN.configure) { log("deny", "access requests are for admins"); break; }
      const name = parts.slice(1).join(" ").toLowerCase();
      const q = S.requests.find((x) => x.name.toLowerCase() === name) || S.requests.find((x) => x.name.toLowerCase().startsWith(name));
      if (!name || !q) { log("deny", name ? `no request from "${name}". type requests` : `whose? e.g. ${verb} Sam Hokie`); break; }
      await decideRequest(q, verb === "approve");
      break;
    }
    case "incidents":
      if (!S.incidents.length) log("info", "no open police incidents");
      for (const i of S.incidents) log("police", [{ b: slug(i.rackName) }, ` ${AGENCY} ${INCIDENT_WORD[i.status].toLowerCase()}, alerted ${ago(i.alertedAt)} by ${i.alertedBy}`]);
      break;
    default: log("deny", `unknown command "${cmd}". type help, or see the Commands page`);
  }
}

const cmdHistory = [];
let hIndex = 0;
const prompt = h("form", { class: "term-prompt", autocomplete: "off", onSubmit: (e) => {
  e.preventDefault();
  const v = cmdInput.value;
  if (v.trim()) { cmdHistory.push(v); hIndex = cmdHistory.length; run(v); }
  cmdInput.value = "";
} }, h("label", { class: "term-ps", for: "cmd" }, `${ROLE} $`), cmdInput);
cmdInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && hIndex > 0) { cmdInput.value = cmdHistory[--hIndex]; e.preventDefault(); }
  if (e.key === "ArrowDown") { hIndex = Math.min(cmdHistory.length, hIndex + 1); cmdInput.value = cmdHistory[hIndex] || ""; e.preventDefault(); }
});
const term = h("section", { class: "term", "aria-label": CAN.terminal ? "Terminal" : "Activity" },
  h("div", { class: "term-head" }, h("span", { class: "term-signal" }, termSignal.el), h("span", {}, CAN.terminal ? "terminal" : "activity"),
    CAN.terminal ? h("a", { class: "term-hint", href: "#commands" }, "commands") : null),
  feed, CAN.terminal ? prompt : null);

// =====================================================================================
// Actions (each also has a button; most also a command)
// =====================================================================================
async function ackRack(r) {
  const res = await act(() => api(`/events/acknowledge-rack/${r.id}`, { method: "POST" }));
  if (res) log("ok", [{ b: slug(r.name) }, ` ${res.acknowledged} alert(s) marked handled`]);
}
async function ackEvent(e, r) {
  const res = await act(() => api(`/events/${e.id}/acknowledge`, { method: "POST" }));
  if (res) log("ok", [{ b: slug(r.name) }, ` ${e.eventType.toLowerCase().replaceAll("_", " ")} marked handled`]);
}
async function alertAuthorities(r) {
  const res = await act(() => api(`/racks/${r.id}/alert-authorities`, { method: "POST", body: {} }));
  if (!res) return null;
  log("police", [{ b: slug(r.name) }, ` alerting ${AGENCY}: tamper alarm at ${r.name}`]);
  setTimeout(() => log("police", [{ b: slug(r.name) }, ` ${AGENCY} alerted by ${res.incident.alertedBy}. follow it in the police version`]), 2000);
  return res;
}
async function registerCard(card, name, r) {
  const res = await act(() => api("/credentials", { method: "POST", body: {
    credentialReference: card.credentialReference, displayLabel: name.trim(), allRacks: false, rackIds: [r.id] } }));
  if (res) log("ok", [`registered ${name.trim()} at `, { b: slug(r.name) }, ". racks sync within a minute"]);
  return res;
}
/** Access requests (riders asking online; the stand-in for StarRez). */
async function decideRequest(q, approve) {
  const res = await act(() => api(`/access-requests/${q.id}/${approve ? "approve" : "deny"}`, { method: "POST" }),
    approve ? `${q.name} approved` : `${q.name} denied`);
  if (res) log(approve ? "ok" : "off", [{ b: q.name }, approve ? " approved. they link their HokieP from the rider app with one tap" : " denied"]);
  return res;
}
function reviewRequest(id) {
  const q = S.requests.find((x) => x.id === id);
  if (!q) return;
  openDialog("Access Request", (body, close) => fill(body,
    h("dl", { class: "kv" },
      h("dt", {}, "Name"), h("dd", {}, q.name),
      h("dt", {}, "VT Email"), h("dd", {}, q.email),
      h("dt", {}, "Hokie Passport"), h("dd", {}, q.hokiePassportId || "Not given"),
      h("dt", {}, "Asked"), h("dd", {}, ago(q.requestedAt)),
      q.note ? [h("dt", {}, "Note"), h("dd", {}, q.note)] : null),
    h("p", { class: "hint" }, "Approving lets them link their Hokie Passport: they press Link My HokieP in the rider app, then tap it on any rack."),
    h("div", { class: "panel-actions" },
      btn("Approve", async () => { if (await decideRequest(q, true)) close(); }, "btn-primary"),
      btn("Deny", async () => { if (await decideRequest(q, false)) close(); }, "btn-quiet"))));
}
/** Makes (or replaces) a card owner's private rider code and shows it once. */
async function riderCode(c, body) {
  if (c.riderName && !confirm(`Make a new rider code for ${c.riderName}? The old code stops working.`)) return;
  const res = await act(() => api(`/credentials/${c.id}/rider-code`, { method: "POST", body: { name: c.riderName || c.displayLabel } }));
  if (!res) return;
  log("ok", [`rider code for `, { b: res.name }, `: ${res.code} (shown once)`]);
  showCode(body, res);
}
function showCode(body, res) {
  const box = h("div", { class: "secret" },
    h("b", {}, `Rider code for ${res.name}`),
    h("p", {}, "Give it to them: they type it into My Card in the rider app to see where their bike is and get alarm warnings. It's only shown this once."),
    h("pre", { class: "code-big" }, res.code),
    h("div", { class: "panel-actions" },
      btn("Copy", async () => { try { await navigator.clipboard.writeText(res.code); toast("Copied"); } catch { toast("Select the code and copy it", true); } }, "btn-primary"),
      btn("Done", () => box.remove(), "btn-quiet")));
  (body || document.body).prepend(box);
  box.scrollIntoView({ block: "start" });
}

/** A small modal. build(body, close). Escape or the backdrop closes it. */
function openDialog(title, build) {
  const body = h("div", { class: "dialog-body" });
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const wrap = h("div", { class: "dialog-wrap", onClick: (e) => { if (e.target === wrap) close(); } },
    h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("header", { class: "dialog-head" }, h("b", {}, title), btn("Close", close, "btn-quiet")), body));
  document.body.append(wrap);
  document.addEventListener("keydown", onKey);
  build(body, close);
  wrap.querySelector("button")?.focus();
}

async function confirmOnline(r) {
  const res = await act(() => api(`/racks/${r.id}/confirm-online`, { method: "POST" }));
  if (res) log("ok", [{ b: slug(r.name) }, " confirmed online"]);
}
async function revokeCard(c) {
  const res = await act(() => api(`/credentials/${c.id}/revoke`, { method: "POST" }));
  if (res) log("off", [{ b: c.displayLabel }, " turned off for good (revoked)"]);
}

// =====================================================================================
// Needs You
// =====================================================================================
const GROUPS = [
  { kind: "alarm", title: "Alarms" },
  { kind: "police", title: "Police" },
  { kind: "confirm", title: "Back Online: Confirm" },
  { kind: "request", title: "Access Requests" },
  { kind: "card", title: "Cards to Register" },
  { kind: "warning", title: "Alerts" },
  { kind: "offline", title: "Offline" },
  { kind: "setup", title: "Not Set Up" },
];
const NEED_BADGE = { alarm: "alarm", police: "police", confirm: "ok", request: "card", card: "card", warning: "warning", offline: "offline", setup: "info" };
function needsList() {
  const out = [];
  for (const r of S.racks) {
    const inc = r.incidentStatus ? `${AGENCY} ${INCIDENT_WORD[r.incidentStatus].toLowerCase()}` : null;
    if (isAlarm(r)) out.push({ key: `alarm-${r.id}`, kind: "alarm", title: "Tamper alarm", sub: `${r.name}${inc ? ` · ${inc}` : " · police not alerted"}`, act: "Open", rack: r.id });
    else if (r.incidentStatus) out.push({ key: `police-${r.id}`, kind: "police", title: `${AGENCY} ${INCIDENT_WORD[r.incidentStatus]}`, sub: r.name, act: "Open", rack: r.id });
    if (r.status === "UNCONFIRMED") out.push({ key: `confirm-${r.id}`, kind: "confirm", title: r.name, sub: `Checked in again ${ago(r.lastSeenAt)}`, act: "Confirm", rack: r.id });
    const other = r.openAlerts - r.openAlarms;
    if (other > 0) out.push({ key: `alert-${r.id}`, kind: "warning", title: `${other} alert${other > 1 ? "s" : ""}`, sub: r.name, act: "Open", rack: r.id });
    if (r.status === "OFFLINE") out.push({ key: `off-${r.id}`, kind: "offline", title: r.name, sub: r.lastSeenAt ? `Last check-in ${ago(r.lastSeenAt)}` : "Never checked in", act: "Open", rack: r.id });
    if (r.status === "UNKNOWN" && CAN.configure) out.push({ key: `setup-${r.id}`, kind: "setup", title: r.name, sub: "No lock module yet", act: "Add", rack: r.id });
  }
  for (const q of S.requests) {
    out.push({ key: `req-${q.id}`, kind: "request", title: q.name, sub: `${q.email}${q.hokiePassportId ? ` · HokieP ${q.hokiePassportId}` : ""} · ${ago(q.requestedAt)}`,
      act: "Review", request: q.id });
  }
  for (const u of S.unknown) {
    out.push({ key: `card-${u.credentialReference}`, kind: "card", title: `Card ${shortRef(u.credentialReference, 8)}`,
      sub: `Tapped ${u.lastRackName ? `at ${u.lastRackName} ` : ""}${ago(u.lastSeenAt)}`, act: "Register", rack: u.lastRackId });
  }
  return out;
}
const needsRows = new Map();
function renderNeeds(el, countEl, skip = []) {
  const all = needsList();
  const list = all.filter((n) => !skip.includes(n.kind));
  const keys = new Set(list.map((n) => n.key));
  for (const k of [...needsRows.keys()]) if (!keys.has(k)) needsRows.delete(k);
  const row = (n) => {
    let entry = needsRows.get(n.key);
    if (!entry) {
      const title = h("b", {}, n.title), sub = h("span", {});
      const el2 = h("button", { type: "button", class: "needs-item", onClick: () => (n.request ? reviewRequest(n.request) : n.rack && openRack(n.rack, { focus: n.kind })) },
        riveIcon("badge", { size: 24, inputs: { kind: BADGE[NEED_BADGE[n.kind]] } }).el,
        h("span", { class: "needs-main" }, title, sub), h("span", { class: "act" }, n.act));
      entry = { el: el2, title, sub };
      needsRows.set(n.key, entry);
    }
    entry.title.textContent = n.title;
    entry.sub.textContent = n.sub;
    entry.el.classList.toggle("current", n.rack && n.rack === openId);
    return entry.el;
  };
  const groups = GROUPS.map((g) => ({ ...g, items: list.filter((n) => n.kind === g.kind) })).filter((g) => g.items.length);
  fill(el, ...groups.flatMap((g) => [h("h3", { class: "needs-group" }, `${g.title} (${g.items.length})`), ...g.items.map(row)]));
  if (!list.length) el.append(h("p", { class: "needs-clear" }, S.racks.length ? "Nothing needs you right now. Every rack is fine." : "No racks yet."));
  if (countEl) countEl.textContent = list.length ? String(list.length) : "";
  return all;
}

// =====================================================================================
// Rack detail (desktop panel and app sheet share this)
// =====================================================================================
let openId = null;
const detailCache = new Map();   // rackId -> { detail, alerts, incident }

async function loadDetail(r) {
  const [detail, alerts, incident] = await Promise.all([
    api(`/racks/${r.id}`),
    api("/events", { query: { rackId: r.id, unacknowledged: true, size: 30 } }),
    r.incidentId ? api(`/incidents/${r.incidentId}`) : null,
  ]);
  const since = Date.now() - 24 * 3600e3;
  const open = alerts.items.filter((e) => ["MEDIUM", "HIGH", "CRITICAL"].includes(e.severity) && Date.parse(e.receivedAt) > since);
  const data = { detail, alerts: open, incident };
  detailCache.set(r.id, data);
  return data;
}

function sceneState(r) {
  if (isAlarm(r)) return SCENE.alarm;
  return isUp(r) ? SCENE.idle : SCENE.offline;
}

function stateLine(r, data) {
  if (isAlarm(r)) return h("p", { class: "state state-alarm" }, r.incidentStatus
    ? `Alarm. ${AGENCY} ${INCIDENT_WORD[r.incidentStatus].toLowerCase()}.` : "Alarm. Someone is tampering with this rack.");
  if (r.status === "UNCONFIRMED") return h("p", { class: "state state-warning" }, "Back online, not confirmed. It was offline and is checking in again. Check it in person, then confirm.");
  if (r.status === "OFFLINE") return h("p", { class: "state state-offline" }, `Offline${r.lastSeenAt ? `, last check-in ${ago(r.lastSeenAt)}` : ""}. It keeps working on its saved card list for up to 72 h.`);
  if (r.status === "UNKNOWN") return h("p", { class: "state state-offline" }, CAN.configure ? "No lock module yet. Add one below to get its setup code." : "No lock module installed yet.");
  if (r.openAlerts) return h("p", { class: "state state-warning" }, `Needs a look: ${r.openAlerts} open alert${r.openAlerts > 1 ? "s" : ""}.`);
  if (data?.detail.devices.some((d) => d.online && (d.lastHeartbeat?.readerOk === false || d.lastHeartbeat?.accelOk === false))) return h("p", { class: "state state-warning" }, "A sensor isn't responding. Check the lock module.");
  return h("p", { class: "state" }, "Working. Cards tap in normally.");
}

/** The two things everyone wants first: open spots and the alarm. */
function facts(r) {
  return h("div", { class: "facts" },
    h("div", { class: r.openSpots === 0 ? "fact full" : "fact" }, h("span", {}, "Open Spots"), h("b", {}, r.capacity ? `${r.openSpots} of ${r.capacity}` : "-")),
    h("div", { class: isAlarm(r) ? "fact alarm" : "fact" }, h("span", {}, "Alarm"),
      h("b", {}, isAlarm(r) ? "Active now" : r.lastAlarmAt ? `Last ${ago(r.lastAlarmAt)}` : "None yet")));
}

function incidentBox(r, data) {
  if (!r.incidentStatus) return null;
  const inc = data?.incident;
  const steps = ["ALERTED", "EN_ROUTE", "ON_SCENE", "RESOLVED"];
  const at = steps.indexOf(r.incidentStatus);
  return h("div", { class: "incident" },
    riveIcon("police", { size: 72, height: 48, inputs: { state: 2 } }).el,
    h("div", {}, h("b", {}, `${AGENCY}: ${INCIDENT_WORD[r.incidentStatus]}`),
      h("span", {}, inc ? `Alerted ${ago(inc.incident.alertedAt)} by ${inc.incident.alertedBy}` : "Alerted"),
      h("ol", { class: "incident-steps" }, steps.slice(0, 3).map((s, i) => h("li", { class: i <= at ? "done" : "" }, INCIDENT_WORD[s])))),
    h("a", { class: "btn btn-quiet", href: "/police/" }, "Police View"));
}

/** Fills `body` with everything about rack r. Called again when the data changes. */
function renderDetail(body, r, data, { focus } = {}) {
  const d = data?.detail;
  const devices = d ? d.devices : [];
  const now = [];
  if (isAlarm(r) && !r.incidentStatus) now.push(btn("Alert Authorities", () => askAuthorities(r), "btn-police"));
  if (r.status === "UNCONFIRMED") now.push(btn("Confirm Online", () => confirmOnline(r), "btn-primary"));
  if (r.openAlerts) now.push(btn(r.openAlerts > 1 ? "Mark All Handled" : "Mark Handled", () => ackRack(r)));

  const alerts = data ? (data.alerts.length
    ? h("div", { class: "list" }, data.alerts.map((e) => {
      const kind = e.eventType === "TAMPER_ALARM" ? "alarm" : e.eventType.startsWith("TAMPER") ? "warning" : e.eventType === "ACCESS_DENIED" ? "denied" : "warning";
      return h("div", { class: "item" }, riveIcon("badge", { size: 22, inputs: { kind: BADGE[kind] } }).el,
        h("span", { class: "item-main" }, h("b", {}, e.eventType === "TAMPER_ALARM" ? "Tamper Alarm" : e.eventType === "TAMPER_WARNING" ? "Rack Shaken"
          : e.eventType.charAt(0) + e.eventType.slice(1).toLowerCase().replaceAll("_", " ")),
        h("span", {}, `${e.details?.deviationG ? `Jolt of ${e.details.deviationG} g, ` : ""}${ago(e.occurredAt)}`)),
        btn("Handled", () => ackEvent(e, r)));
    }))
    : h("p", { class: "empty" }, "No open alerts.")) : h("p", { class: "empty" }, "Loading…");

  const waiting = S.unknown.filter((u) => u.lastRackId === r.id);
  const waitingBlock = waiting.length ? [h("h2", { id: "waiting" }, "Waiting to Register"), h("div", { class: "list" }, waiting.map((u) => {
    const name = h("input", { class: "input", placeholder: "Rider's name", "aria-label": `Name for card ${shortRef(u.credentialReference, 8)}`, maxlength: "120" });
    const form = h("form", { class: "item item-form", onSubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      const card = await registerCard(u, name.value, r);
      if (card) {
        const res = await act(() => api(`/credentials/${card.id}/rider-code`, { method: "POST", body: { name: card.displayLabel } }));
        if (res) { log("ok", [`rider code for `, { b: res.name }, `: ${res.code} (shown once)`]); showCode(body, res); }
      }
    } },
    riveIcon("badge", { size: 22, inputs: { kind: BADGE.card } }).el,
    h("span", { class: "item-main" }, h("b", {}, `Card ${shortRef(u.credentialReference, 8)}`), h("span", {}, `Tapped ${ago(u.lastSeenAt)} · ${u.attempts} tap${u.attempts > 1 ? "s" : ""}`), name),
    h("button", { class: "btn btn-primary", type: "submit" }, "Register"));
    if (focus === "card") setTimeout(() => name.focus(), 50);
    return form;
  }))] : [];

  const deviceRows = devices.length ? h("div", { class: "list" }, devices.map((dev) => {
    const hb = dev.lastHeartbeat || {};
    const problems = [];
    if (dev.online && hb.readerOk === false) problems.push("card reader not responding");
    if (dev.online && hb.accelOk === false) problems.push("motion sensor not responding");
    const status = !dev.active ? ["off", "Turned Off"] : dev.online && dev.needsConfirm ? ["st-UNCONFIRMED", "Not Confirmed"] : dev.online ? ["ok", "Online"] : ["off", "Offline"];
    return h("div", { class: "item item-wrap" }, riveIcon("signal", { size: 22, inputs: { level: bars(hb.wifiRssi, dev.online) } }).el,
      h("span", { class: "item-main" }, h("b", {}, dev.label),
        h("span", {}, !dev.lastSeenAt ? "Never connected. Flash it with its setup code." : problems.length ? problems.join(", ")
          : dev.online ? `All sensors working, signal ${hb.wifiRssi ?? "?"} dBm${dev.firmwareVersion ? `, firmware ${dev.firmwareVersion}` : ""}` : `Last check-in ${ago(dev.lastSeenAt)}`)),
      h("span", { class: status[0] }, status[1]),
      CAN.configure ? h("span", { class: "item-actions" },
        btn("Rename", (e) => {
          const nameEl = e.currentTarget.closest(".item").querySelector(".item-main b");
          inlineRename(nameEl, dev.label, (v) => act(() => api(`/racks/${r.id}/devices/${dev.id}`, { method: "PATCH", body: { label: v } }), `Renamed to ${v}`), "Lock module name");
        }, "btn-quiet"),
        btn("New Setup Code", async () => {
          if (!confirm(`Make a new setup code for ${dev.label}? The old one stops working right away, so the rack must be re-flashed.`)) return;
          const res = await act(() => api(`/racks/${r.id}/devices/${dev.id}/rotate-token`, { method: "POST" }), "New setup code made. Copy it now: it's only shown once.");
          if (res) showSecret(body, res);
        }, "btn-quiet"),
        btn(dev.active ? "Turn Off" : "Turn On", () => act(() => api(`/racks/${r.id}/devices/${dev.id}`, { method: "PATCH", body: { active: !dev.active } }),
          dev.active ? "Lock module turned off" : "Lock module turned on"), "btn-quiet")) : null);
  })) : h("p", { class: "empty" }, d ? "No lock module yet." : "Loading…");

  const addDevice = CAN.configure ? (() => {
    const label = h("input", { class: "input", placeholder: "e.g. ESP32 #2", maxlength: "120", "aria-label": "Lock module name" });
    return h("form", { class: "inline-form", onSubmit: async (e) => {
      e.preventDefault();
      const res = await act(() => api(`/racks/${r.id}/devices`, { method: "POST", body: { label: label.value.trim() || `ESP32 #${devices.length + 1}` } }),
        "Lock module added. Copy its setup code now: it's only shown once.");
      if (res) { log("ok", [{ b: slug(r.name) }, ` lock module ${res.device.label} added`]); showSecret(body, res); }
    } }, label, h("button", { class: "btn", type: "submit" }, "Add Lock Module"));
  })() : null;

  const cards = CAN.cards ? S.cards.filter((c) => c.status !== "REVOKED" && (c.allRacks || c.rackIds.includes(r.id))) : [];
  const cardBlock = CAN.cards ? [h("h2", {}, "Cards That Work Here"), cards.length ? h("div", { class: "list" }, cards.map((c) =>
    h("div", { class: "item" }, riveIcon("badge", { size: 22, inputs: { kind: c.active ? BADGE.ok : BADGE.denied } }).el,
      h("span", { class: "item-main" }, h("b", {}, c.displayLabel), h("span", {}, `${c.riderName ? `Rider: ${c.riderName} · ` : ""}${c.allRacks ? "All racks · " : ""}${c.active ? (c.lastUsedAt ? `Used ${ago(c.lastUsedAt)}` : "Not used yet") : "Turned off"}`)),
      h("span", { class: "item-actions" },
        btn("Rename", (e) => {
          const nameEl = e.currentTarget.closest(".item").querySelector(".item-main b");
          inlineRename(nameEl, c.displayLabel, async (v) => {
            const res = await act(() => api(`/credentials/${c.id}`, { method: "PATCH", body: { displayLabel: v } }), `Renamed to ${v}`);
            if (res) log("ok", [{ b: c.displayLabel }, " renamed to ", { b: v }]);
            return res;
          }, "Card name");
        }, "btn-quiet"),
        btn(c.active ? "Turn Off" : "Turn On", () => act(() => api(`/credentials/${c.id}`, { method: "PATCH", body: { active: !c.active } }),
          `${c.displayLabel} turned ${c.active ? "off" : "on"}`).then((x) => x && log(c.active ? "off" : "ok", [{ b: c.displayLabel }, ` turned ${c.active ? "off" : "on"}`])), "btn-quiet"),
        btn(c.riderName ? "New Rider Code" : "Rider Code", () => riderCode(c, body), "btn-quiet"),
        btn("Revoke", () => { if (confirm(`Turn off ${c.displayLabel} for good? This can't be undone.`)) revokeCard(c); }, "btn-quiet")))))
    : h("p", { class: "empty" }, "No cards yet. Tap a new card on this rack, then register it here.")] : [];

  const settings = CAN.configure ? (() => {
    const name = h("input", { class: "input", value: r.name, maxlength: "120", "aria-label": "Rack name" });
    const where = h("input", { class: "input", value: r.locationDescription || "", maxlength: "255", placeholder: "Where it is, e.g. Squires, north side", "aria-label": "Where it is" });
    const cap = h("input", { class: "input", type: "number", min: "1", max: "200", value: r.capacitySetting ?? "", placeholder: `Spots (blank = ${Math.max(1, r.deviceCount)}, one per lock module)`, "aria-label": "Number of spots" });
    return [h("h2", {}, "Rack Settings"), h("form", { class: "stack-form", onSubmit: async (e) => {
      e.preventDefault();
      const n = cap.value.trim() ? Number(cap.value) : null;
      const body = { name: name.value.trim(), locationDescription: where.value.trim(), ...(n ? { capacity: n } : { clearCapacity: true }) };
      const res = await act(() => api(`/racks/${r.id}`, { method: "PATCH", body }), "Saved");
      if (res) log("ok", [{ b: slug(res.rack.name) }, " renamed / location saved"]);
    } }, name, where, h("label", { class: "field" }, h("span", {}, "Spots"), cap),
      h("p", { class: "hint" }, "Spots in use are counted from card taps: a card's first tap parks, the next tap leaves. If the count is off, reset it."),
      h("div", { class: "panel-actions" }, h("button", { class: "btn", type: "submit" }, "Save"),
      btn("All Spots Open", async () => {
        const res = await act(() => api(`/racks/${r.id}/reset-spots`, { method: "POST" }), "Spots reset");
        if (res) log("ok", [{ b: slug(r.name) }, " spots reset: all open"]);
      }, "btn-quiet"),
      btn(r.latitude != null ? "Move on Map" : "Place on Map", () => (APP ? openPlaceSheet({ rack: r }) : startMove(r)))))];
  })() : [];

  const titleEl = h("h1", { class: "panel-title" }, r.name);
  const titleRow = h("div", { class: "title-row" }, titleEl,
    CAN.configure ? btn("Rename", () => inlineRename(titleRow, r.name, (v) => renameRack(r, v), "Rack name"), "btn-quiet rename-btn") : null);
  fill(body,
    titleRow,
    h("p", { class: "panel-sub" }, r.locationDescription || (r.latitude == null ? "Not on the map yet" : "")),
    facts(r),
    stateLine(r, data),
    incidentBox(r, data),
    now.length ? h("div", { class: "panel-actions panel-now" }, now) : null,
    h("h2", {}, "Alerts"), alerts,
    ...waitingBlock,
    h("h2", {}, devices.length > 1 ? "Lock Modules" : "Lock Module"), deviceRows, addDevice,
    ...cardBlock,
    ...settings,
  );
  if (focus === "card") body.querySelector("#waiting")?.scrollIntoView({ block: "center" });
}

/**
 * Rename in place: swaps `el` for a text box with Save / Cancel. onSave(newName) does the API call.
 */
function inlineRename(el, current, onSave, label = "New name") {
  const input = h("input", { class: "input", value: current, maxlength: "120", "aria-label": label });
  const form = h("form", { class: "inline-form rename-form", onSubmit: async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v || v === current) { form.replaceWith(el); return; }
    if (await onSave(v)) form.replaceWith(el);
  } }, input, h("button", { class: "btn btn-primary", type: "submit" }, "Save"), btn("Cancel", () => form.replaceWith(el), "btn-quiet"));
  el.replaceWith(form);
  input.select();
}
async function renameRack(r, name) {
  const res = await act(() => api(`/racks/${r.id}`, { method: "PATCH", body: { name } }), `Renamed to ${name}`);
  if (res) log("ok", [{ b: slug(r.name) }, " renamed to ", { b: slug(name) }]);
  return res;
}

/** Shows a new device token + config snippet once, with Copy. */
function showSecret(body, res) {
  const box = h("div", { class: "secret" },
    h("b", {}, `Setup code for ${res.device.label}`),
    h("p", {}, "Paste into firmware/include/config.h, add your Wi-Fi and card key, then flash the rack. It's only shown this once."),
    h("pre", {}, res.configSnippet),
    h("div", { class: "panel-actions" },
      btn("Copy", async () => { try { await navigator.clipboard.writeText(res.configSnippet); toast("Copied"); } catch { toast("Select the text and copy it", true); } }, "btn-primary"),
      btn("Done", () => box.remove(), "btn-quiet")));
  body.prepend(box);
  box.scrollIntoView({ block: "start" });
}

// ---------- Alert Authorities (asks first) ----------
function askAuthorities(r) {
  if (!APP) { showDrop(r, "confirm"); return; }
  if (confirm(`Alert ${AGENCY} about the tamper alarm at ${r.name}? Only if a bike may be being stolen.`)) alertAuthorities(r);
}

// =====================================================================================
// Place sheet (Add Rack anywhere, Move on Map in the app): TerraSim-style click to place + search
// =====================================================================================
function openPlaceSheet({ rack = null, name: startName = "" } = {}) {
  let point = rack && rack.latitude != null ? { latitude: rack.latitude, longitude: rack.longitude } : null;
  const mapEl = h("div", { class: "place-map" });
  const where = h("p", { class: "place-where" }, point ? "Drag the pin or click to move it." : "Click the map where the rack stands.");
  const name = h("input", { class: "input", placeholder: "Rack name, e.g. Squires North", maxlength: "120", "aria-label": "Rack name", value: startName });
  const loc = h("input", { class: "input", placeholder: "Where it is (optional)", maxlength: "255", "aria-label": "Where it is" });
  const search = h("input", { class: "input", placeholder: "Search a building or street", "aria-label": "Search places" });
  const results = h("div", { class: "place-results" });
  let pm = null;
  const close = () => { pm?.destroy(); sheet.remove(); };
  const save = async (e) => {
    e?.preventDefault();
    if (!point) { toast("Click the map first", true); return; }
    if (rack) {
      const res = await act(() => api(`/racks/${rack.id}`, { method: "PATCH", body: point }), "Moved on the map");
      if (res) { log("ok", [{ b: slug(rack.name) }, ` moved on the map to ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`]); close(); }
    } else {
      if (!name.value.trim()) { name.focus(); toast("Give the rack a name", true); return; }
      const res = await act(() => api("/racks", { method: "POST", body: { name: name.value.trim(), locationDescription: loc.value.trim() || null, ...point } }), "Rack added");
      if (res) { log("ok", ["new rack ", { b: slug(res.rack.name) }, ". next: add its lock module"]); close(); openRack(res.rack.id); }
    }
  };
  let searchTimer = null;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 3) { fill(results, ); return; }
    searchTimer = setTimeout(async () => {
      try {
        const found = await searchPlaces(q);
        fill(results, ...found.map((p) => btn([h("b", {}, p.name), h("span", {}, p.detail)], () => { pm.flyTo(p.lng, p.lat); fill(results, ); }, "place-result")));
      } catch (err) { fill(results, h("p", { class: "empty" }, err.message)); }
    }, 300);
  });
  const sheet = h("div", { class: "place-sheet", role: "dialog", "aria-label": rack ? `Move ${rack.name}` : "Add a rack" },
    h("form", { class: "place-side", onSubmit: save },
      h("h1", {}, rack ? `Move ${rack.name}` : "Add a Rack"),
      where, search, results,
      rack ? null : [name, loc],
      h("div", { class: "panel-actions" }, h("button", { class: "btn btn-primary", type: "submit" }, rack ? "Save Spot" : "Add Rack"), btn("Cancel", close, "btn-quiet"))),
    mapEl);
  document.body.append(sheet);
  pm = placeMap(mapEl, { initial: point, onPick: (p) => { point = p; where.textContent = `Spot: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}. Drag the pin to fine-tune.`; } });
  (rack || startName ? search : name).focus();
}

// =====================================================================================
// Commands / Reports / Audit Log pages
// =====================================================================================
const COMMANDS = [
  { group: "Look Around", items: [["help", "List every command in the terminal.", "help"], ["racks", "Every rack and its status. The bold name is what you type.", "racks"],
    ["open <rack>", "Open a rack's panel.", "open newman"], ["incidents", "Open police incidents.", "incidents"]] },
  { group: "Alarms and Alerts", items: [["ack <rack>", "Mark all of a rack's alerts handled.", "ack squires"],
    ["alert <rack> confirm", `Alert ${AGENCY} about a rack's tamper alarm. Without "confirm" it only explains.`, "alert squires confirm"]] },
  { group: "Riders", items: [["requests", "Riders who asked for access online (the stand-in for StarRez).", "requests"],
    ["approve <name>", "Approve a request. They then link their Hokie Passport from the rider app with one tap.", "approve Sam Hokie"],
    ["deny <name>", "Deny a request.", "deny Sam Hokie"]] },
  { group: "Cards", items: [["register <rack> <name>", "Register the card that was just tapped at a rack.", "register newman Jane Doe"],
    ["cards [rack]", "List registered cards, all or for one rack.", "cards newman"], ["revoke <name> confirm", "Turn a card off for good.", "revoke Old Test Card confirm"]] },
  { group: "Racks", items: [["add <name>", "Add a new rack: the map opens so you can click where it stands, then Add Rack.", "add Squires North"],
    ["confirm <rack>", "Confirm a rack that came back from being offline is working. Check it in person first.", "confirm newman"],
    ["move <rack>", "Move a rack's pin: click the map or drag the pin, then Save Spot.", "move newman"],
    ["rename <rack> <new name>", "Rename a rack. Cards and lock modules have a Rename button in the rack's panel.", "rename meow Goodwin Hall East"]] },
  { group: "Terminal", items: [["clear", "Clear the terminal. Nothing is deleted.", "clear"], ["↑ / ↓", "Bring back earlier commands.", ""]] },
];
function commandsPage() {
  const insert = (text) => { go(APP ? "terminal" : "map"); cmdInput.value = text; cmdInput.focus(); };
  const row = ([syntax, what, example]) => h("div", { class: "cmdrow" }, h("code", {}, syntax),
    h("span", { class: "cmd-what" }, what, example ? h("span", {}, "Example: ", h("code", {}, example)) : null),
    example ? btn("Insert", () => insert(example), "btn-quiet") : h("span"));
  return h("div", { class: "sheet-inner" }, h("h1", {}, "Commands"),
    h("p", { class: "lead" }, "Type these in the terminal. Everything here also has a button; the terminal is just faster. A rack is its short name (type ",
      h("code", {}, "racks"), " to see them) or the start of its name. Insert puts the example in the terminal."),
    COMMANDS.map((g) => [h("h2", {}, g.group), h("div", { class: "cmds" }, g.items.map(row))]));
}

async function reportsPage(container, days = 7) {
  fill(container, h("div", { class: "sheet-inner" }, h("h1", {}, "Reports"), h("p", { class: "lead" }, "Loading…")));
  let rep;
  try { rep = await api("/reports/summary", { query: { days } }); } catch (e) {
    fill(container, h("div", { class: "sheet-inner" }, h("h1", {}, "Reports"), h("p", { class: "lead state-alarm" }, e.message)));
    return;
  }
  const t = rep.byType || {};
  const tamper = (t.TAMPER_WARNING || 0) + (t.TAMPER_ALARM || 0);
  const stat = (label, value, sub) => h("div", { class: "stat" }, h("span", {}, label), h("b", {}, String(value)), sub ? h("small", {}, sub) : null);
  const table = (head, rows, empty) => rows.length
    ? h("table", { class: "table" }, h("thead", {}, h("tr", {}, head.map((x, i) => h("th", { class: i ? "num" : "" }, x)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((x, i) => h("td", { class: i ? "num" : "" }, String(x)))))))
    : h("p", { class: "empty" }, empty);
  const reasons = Object.entries(rep.deniedReasons || {}).sort((a, b) => b[1] - a[1]);
  const busiest = [...rep.byRack].sort((a, b) => b.granted - a.granted)[0];
  fill(container, h("div", { class: "sheet-inner" },
    h("div", { class: "page-head" }, h("h1", {}, "Reports"),
      h("div", { class: "seg", role: "group", "aria-label": "Period" }, [1, 7, 30].map((n) =>
        btn(n === 1 ? "Today" : `${n} Days`, () => reportsPage(container, n), n === days ? "on" : "", { "aria-pressed": String(n === days) })))),
    h("p", { class: "lead" }, `${days === 1 ? "Last 24 hours" : `Last ${days} days`} · ${rep.registeredRacks} rack${rep.registeredRacks === 1 ? "" : "s"} · ${rep.activeCredentials} active card${rep.activeCredentials === 1 ? "" : "s"}`
      + (busiest && busiest.granted ? ` · busiest: ${busiest.rackName}` : "")),
    h("div", { class: "stats" }, stat("Unlocks", t.ACCESS_GRANTED || 0), stat("Cards Refused", t.ACCESS_DENIED || 0),
      stat("Shakes and Alarms", tamper, t.TAMPER_ALARM ? `${t.TAMPER_ALARM} alarm${t.TAMPER_ALARM > 1 ? "s" : ""}` : null), stat("Sensor Problems", t.SENSOR_FAULT || 0)),
    h("h2", {}, "By Rack"), table(["Rack", "Unlocks", "Refused", "Shakes / Alarms", "Faults"], rep.byRack.map((r) => [r.rackName, r.granted, r.denied, r.tamper, r.faults]), "No racks yet."),
    h("h2", {}, "By Day"), table(["Day", "Unlocks", "Refused", "Shakes / Alarms"], [...rep.byDay].reverse().map((d) => [d.day, d.granted, d.denied, d.tamper]), "Nothing happened in this period."),
    h("h2", {}, "Why Cards Were Refused"), table(["Reason", "Times"], reasons.map(([k, v]) => [DENY_REASONS[k] || k, v]), "No cards were refused.")));
}

const ACTION_WORDS = {
  RACK_CREATED: "Added a rack", RACK_UPDATED: "Changed a rack", RACK_CONFIRMED_ONLINE: "Confirmed a rack online",
  DEVICE_ADDED: "Added a lock module", DEVICE_TOKEN_ROTATED: "Made a new setup code", DEVICE_UPDATED: "Changed a lock module",
  CREDENTIAL_CREATED: "Registered a card", CREDENTIAL_UPDATED: "Changed a card", CREDENTIAL_REVOKED: "Revoked a card",
  EVENT_ACKNOWLEDGED: "Marked an alert handled", RACK_EVENTS_ACKNOWLEDGED: "Marked a rack's alerts handled",
  RACK_ALERTS_ACKNOWLEDGED: "Marked a rack's alerts handled", RACK_SPOTS_RESET: "Reset a rack's spots",
  AUTHORITIES_ALERTED: `Alerted ${AGENCY}`, INCIDENT_EN_ROUTE: "Police: on the way", INCIDENT_ON_SCENE: "Police: on scene", INCIDENT_RESOLVED: "Police: resolved",
};
async function auditPage(container, page = 0) {
  fill(container, h("div", { class: "sheet-inner" }, h("h1", {}, "Audit Log"), h("p", { class: "lead" }, "Loading…")));
  let res;
  try { res = await api("/audit-log", { query: { page, size: 50 } }); } catch (e) {
    fill(container, h("div", { class: "sheet-inner" }, h("h1", {}, "Audit Log"), h("p", { class: "lead state-alarm" }, e.message)));
    return;
  }
  const rackName = (id) => S.racks.find((r) => r.id === id)?.name;
  const detailText = (a) => {
    const d = a.details || {};
    const bits = [];
    if (a.targetType === "RACK") bits.push(rackName(a.targetId) || d.name || "");
    if (d.rackId) bits.push(rackName(d.rackId) || "");
    for (const [k, v] of Object.entries(d)) {
      if (["rackId", "credentialReference"].includes(k) || v == null || typeof v === "object") continue;
      bits.push(`${k}: ${v}`);
    }
    return bits.filter(Boolean).join(" · ");
  };
  const pages = Math.max(1, Math.ceil(res.total / res.size));
  fill(container, h("div", { class: "sheet-inner" },
    h("h1", {}, "Audit Log"),
    h("p", { class: "lead" }, `Every change anyone made, newest first. ${res.total} entr${res.total === 1 ? "y" : "ies"}.`),
    res.items.length ? h("table", { class: "table audit" },
      h("thead", {}, h("tr", {}, h("th", {}, "When"), h("th", {}, "Who"), h("th", {}, "What"), h("th", {}, "Details"))),
      h("tbody", {}, res.items.map((a) => h("tr", {},
        h("td", { title: new Date(a.createdAt).toLocaleString() }, ago(a.createdAt)), h("td", {}, a.actor),
        h("td", {}, ACTION_WORDS[a.action] || a.action.toLowerCase().replaceAll("_", " ")), h("td", { class: "wrap" }, detailText(a))))))
      : h("p", { class: "empty" }, "Nothing yet."),
    pages > 1 ? h("div", { class: "pager" },
      btn("Newer", () => auditPage(container, page - 1), "", { disabled: page === 0 }),
      h("span", {}, `Page ${page + 1} of ${pages}`),
      btn("Older", () => auditPage(container, page + 1), "", { disabled: page + 1 >= pages })) : null));
}

// =====================================================================================
// DESKTOP layout
// =====================================================================================
let map = null;
let panel, panelBody, panelScene, drop, dropScene, moveBar, pageSheet, needsEl, needsCount, summaryEl;
let moving = null;

function buildDesktop(root) {
  summaryEl = h("span", { class: "top-summary" });
  const nav = [["map", "Map"], ["commands", "Commands", CAN.terminal], ["reports", "Reports", CAN.reports], ["audit", "Audit Log", CAN.audit]]
    .filter(([, , ok]) => ok !== false).map(([p, label]) => h("a", { href: `#${p}`, "data-page": p }, label));
  const top = h("header", { class: "top" },
    h("a", { class: "brand", href: "#map" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 28 }).el), "HokieBikeRack",
      h("span", { class: "role-tag" }, ROLE === "admin" ? "Admin" : "Staff")),
    h("nav", { class: "top-nav", "aria-label": "Pages" }, nav), summaryEl,
    h("a", { class: "view-switch", href: "?view=app" }, "App View"), h("a", { class: "view-switch", href: "/" }, "Versions"));

  panelScene = riveIcon("rack", { size: 380, height: 180, fit: "cover", align: "BottomCenter", inputs: { state: 0 }, label: "The rack, live" });
  panelBody = h("div", { id: "panel-body" });
  panel = h("aside", { class: "panel", hidden: true, "aria-label": "Rack" },
    h("div", { class: "panel-scene" }, panelScene.el), h("button", { class: "panel-close", type: "button", onClick: closeRack }, "Close"), panelBody);
  dropScene = h("div", { class: "drop-scene" });
  drop = h("div", { class: "drop", role: "alert", hidden: true }, dropScene, h("div", { class: "drop-text" },
    h("b", { id: "drop-title" }), h("span", { id: "drop-where" }), h("div", { id: "drop-extra" }), h("div", { class: "drop-actions", id: "drop-actions" })));
  moveBar = h("div", { class: "move-bar", hidden: true }, h("span", { id: "move-text" }),
    btn("Save Spot", () => stopMove(true), "btn-primary"), btn("Cancel", () => stopMove(false), "btn-quiet"));
  const addRack = CAN.configure ? btn("Add Rack", () => openPlaceSheet(), "map-add") : null;
  const mapEl = h("div", { id: "map", class: "map" });
  const mapArea = h("section", { class: "map-area", "aria-label": "Campus map" }, mapEl, addRack, panel, drop, moveBar);
  pageSheet = h("section", { class: "sheet", hidden: true });
  needsEl = h("div", { class: "needs-list", id: "needs" });
  needsCount = h("span", { class: "needs-count" });
  const needs = h("section", { class: "needs", "aria-labelledby": "needs-title" },
    h("button", { class: "needs-head", type: "button", "aria-expanded": "true", "aria-controls": "needs", onClick: (e) => {
      const folded = needs.classList.toggle("folded");
      e.currentTarget.setAttribute("aria-expanded", String(!folded));
      e.currentTarget.querySelector(".needs-fold").textContent = folded ? "Show" : "Hide";
    } }, h("span", { class: "needs-title", id: "needs-title" }, "Needs You"), needsCount, h("span", { class: "needs-fold" }, "Hide")),
    needsEl);
  root.append(top, h("main", { class: "stage" }, mapArea, pageSheet, h("div", { class: "side" }, needs, term)));

  map = rackMap(mapEl, { look: { ground: "#07090c", building: "#1d242d", label: "#d6dde5" }, onSelect: (r) => openRack(r.id) });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".place-sheet")) return;
    if (!pageSheet.hidden) go("map");
    else if (moving) stopMove(false);
    else if (!panel.hidden) closeRack();
  });
}

function openRack(id, { focus } = {}) {
  const r = rackById(id);
  if (!r) return;
  if (APP) { openAppRack(r, { focus }); return; }
  go("map");
  stopMove(false);
  const wasOpen = !panel.hidden && openId === id;
  openId = id;
  panel.hidden = false;
  panel.closest(".map-area").classList.add("panel-open");
  if (!wasOpen) { panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = ""; panel.scrollTop = 0; }
  const cached = detailCache.get(id);
  renderDetail(panelBody, r, cached, { focus });
  panelScene.set("state", sceneState(r));
  loadDetail(r).then((data) => { if (openId === id) renderDetail(panelBody, rackById(id) || r, data, { focus }); }).catch((e) => toast(e.message, true));
  map.setInset({ left: 380 + 16 * 2 }, { duration: 0 });
  if (r.latitude != null) map.select(id); else map.select(null, { move: false });
  renderNeeds(needsEl, needsCount);
}
function closeRack() {
  if (!panel) return;
  stopMove(false);
  panel.hidden = true;
  panel.closest(".map-area").classList.remove("panel-open");
  openId = null;
  map.select(null, { move: false });
  map.setInset({ left: 0 });
  renderNeeds(needsEl, needsCount);
}

function startMove(r) {
  if (APP || !map) { openPlaceSheet({ rack: r }); return; }
  if (r.latitude == null) { openPlaceSheet({ rack: r }); return; }
  stopMove(false);
  const text = moveBar.querySelector("#move-text");
  text.textContent = `Click the map or drag the pin to move ${r.name}.`;
  moving = { rack: r, spot: null, handle: map.startMove(r.id, (p) => {
    moving.spot = p;
    text.textContent = `New spot ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}. Save it?`;
  }) };
  moveBar.hidden = false;
}
async function stopMove(keep) {
  if (!moving) return;
  const { rack: r, spot, handle } = moving;
  moving = null;
  moveBar.hidden = true;
  if (keep && spot) {
    const res = await act(() => api(`/racks/${r.id}`, { method: "PATCH", body: spot }), "Moved on the map");
    handle.stop(Boolean(res));
    if (res) log("ok", [{ b: slug(r.name) }, ` moved on the map to ${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)}`]);
  } else handle.stop(false);
}

// ---------- drop panel ----------
const dropState = { rack: null, level: null, anim: null, timer: null };
function dropAnim(name, inputs) {
  if (dropState.anim?.name !== name) {
    const a = riveIcon(name, { size: 150, height: 100, inputs });
    fill(dropScene, a.el);
    dropState.anim = { name, a };
  } else for (const [k, v] of Object.entries(inputs)) dropState.anim.a.set(k, v);
}
function showDrop(r, level, extraInfo = {}) {
  if (APP || !drop) return;
  clearTimeout(dropState.timer);
  const fresh = drop.hidden || drop.classList.contains("leaving");
  Object.assign(dropState, { rack: r.id, level });
  drop.classList.remove("leaving", "bump", "alarm", "police");
  const title = drop.querySelector("#drop-title"), where = drop.querySelector("#drop-where");
  const extra = drop.querySelector("#drop-extra"), actions = drop.querySelector("#drop-actions");
  const open = btn("Open Rack", () => openRack(r.id));
  const dismiss = btn("Dismiss", hideDrop, "btn-quiet");
  const jolt = extraInfo.jolt != null ? ` · jolt ${extraInfo.jolt} g` : "";
  if (level === "bump") {
    drop.classList.add("bump");
    dropAnim("shake", { level: 0 });
    title.textContent = "Shake Detected";
    where.textContent = `${r.name}${jolt} · warning chirp played`;
    fill(extra, h("span", { class: "drop-note" }, "If it keeps shaking, the rack sounds its siren."));
    fill(actions, open, dismiss);
    dropState.timer = setTimeout(() => { if (dropState.level === "bump") hideDrop(); }, 9000);
  } else if (level === "alarm") {
    drop.classList.add("alarm");
    dropAnim("shake", { level: 1 });
    title.textContent = "Tamper Alarm";
    where.textContent = `${r.name}${jolt} · just now`;
    fill(extra, h("span", { class: "siren" }, h("span", { class: "siren-bar" })), h("span", { class: "drop-note" }, "Siren on for 10 s. The alarm stays open until handled."));
    fill(actions, r.incidentStatus ? null : btn("Alert Authorities", () => askAuthorities(rackById(r.id) || r), "btn-police"), open, dismiss);
  } else if (level === "confirm") {
    drop.classList.add("alarm");
    title.textContent = `Alert ${AGENCY}?`;
    where.textContent = `About the tamper alarm at ${r.name}.`;
    fill(extra, h("span", { class: "drop-note" }, "Only if a bike may be being stolen. It's recorded, and the police version shows it."));
    fill(actions, btn("Alert Now", async () => {
      dropAnim("police", { state: 1 });
      drop.classList.remove("alarm"); drop.classList.add("police");
      title.textContent = `Alerting ${AGENCY}…`;
      fill(actions, );
      const res = await alertAuthorities(r);
      if (!res) { hideDrop(); return; }
      setTimeout(() => {
        if (dropState.rack !== r.id) return;
        title.textContent = `${AGENCY} Alerted`;
        where.textContent = `${r.name} · by ${res.incident.alertedBy}`;
        fill(extra, h("span", { class: "drop-note" }, "The pin flashes red and blue until the police resolve it."));
        fill(actions, btn("Open Rack", () => openRack(r.id)), btn("Dismiss", hideDrop, "btn-quiet"));
      }, 2100);
    }, "btn-danger"), btn("Cancel", () => (isAlarm(rackById(r.id) || r) ? showDrop(r, "alarm") : hideDrop()), "btn-quiet"));
  }
  drop.hidden = false;
  if (fresh) { drop.style.animation = "none"; void drop.offsetWidth; drop.style.animation = ""; }
}
function hideDrop() {
  if (!drop || drop.hidden) return;
  clearTimeout(dropState.timer);
  drop.classList.add("leaving");
  setTimeout(() => { if (drop.classList.contains("leaving")) { drop.hidden = true; drop.classList.remove("leaving"); fill(dropScene, ); dropState.anim = null; dropState.level = null; } }, 320);
}

// ---------- pages ----------
let page = "map";
function go(p) {
  if (APP) { appGo(p); return; }
  page = ["commands", "reports", "audit"].includes(p) && pageAllowed(p) ? p : "map";
  pageSheet.hidden = page === "map";
  for (const a of document.querySelectorAll(".top-nav a")) {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (page === "commands") fill(pageSheet, commandsPage());
  if (page === "reports") reportsPage(pageSheet);
  if (page === "audit") auditPage(pageSheet);
  pageSheet.scrollTop = 0;
  if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
}
const pageAllowed = (p) => (p === "commands" ? CAN.terminal : p === "audit" ? CAN.audit : p === "reports" ? CAN.reports : true);

// =====================================================================================
// APP layout: bottom tabs (Now, Racks, Terminal/Activity, More)
// =====================================================================================
let appMain, appTabs, appTitle, appSheet, appTerm;
let tab = "now";
const TABS = [["now", "Now", "alerts"], ["racks", "Racks", "racks"], ["terminal", CAN.terminal ? "Terminal" : "Activity", "health"], ["more", "More", "settings"]];

function buildApp(root) {
  appTitle = h("h1", { class: "app-title" });
  appMain = h("main", { class: "app-main" });
  appTerm = h("div", { class: "app-term", hidden: true }, term);   // stays in the page so its animations live on
  appTabs = h("nav", { class: "app-tabs", "aria-label": "Sections" }, TABS.map(([id, label, ic]) =>
    h("a", { href: `#${id}`, "data-tab": id, onClick: (e) => { e.preventDefault(); appGo(id); } }, icon(ic), h("span", {}, label), h("i", { class: "tab-dot", hidden: true }))));
  appSheet = h("div", { class: "app-sheet", hidden: true });
  root.append(h("header", { class: "app-head" }, h("span", { class: "brand-mark" }, riveIcon("logo", { size: 26 }).el), appTitle,
    h("span", { class: "role-tag" }, ROLE === "admin" ? "Admin" : "Staff")), appMain, appTerm, appTabs, appSheet);
}

function appGo(id) {
  if (["commands", "reports", "audit"].includes(id)) {
    if (!pageAllowed(id)) return;
    openAppSheet(id === "commands" ? "Commands" : id === "reports" ? "Reports" : "Audit Log", (body) => {
      if (id === "commands") body.append(commandsPage());
      if (id === "reports") reportsPage(body);
      if (id === "audit") auditPage(body);
    });
    return;
  }
  tab = TABS.some(([t]) => t === id) ? id : "now";
  for (const a of appTabs.querySelectorAll("a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  appTitle.textContent = { now: "Now", racks: "Racks", terminal: CAN.terminal ? "Terminal" : "Activity", more: "More" }[tab];
  renderApp(true);
  if (tab === "terminal") { feed.scrollTop = feed.scrollHeight; }
  history.replaceState(null, "", `?view=app#${tab}`);
}

let appSig = "";
function renderApp(force = false) {
  if (!appMain) return;
  const sig = JSON.stringify([tab, S.racks, S.unknown, S.incidents]);
  if (!force && sig === appSig && tab !== "terminal") return;
  appSig = sig;
  const dot = appTabs.querySelector('[data-tab="now"] .tab-dot');
  dot.hidden = !needsList().length;
  if (tab === "terminal") { /* the terminal updates itself */ }
  else if (tab === "now") appNow();
  else if (tab === "racks") appRacks();
  else if (tab === "more") appMore();
  appMain.hidden = tab === "terminal";
  appTerm.hidden = tab !== "terminal";
}

/** Now: alarms as numbered steps, then everything else that needs you, then a plain all-clear. */
function appNow() {
  const alarms = S.racks.filter(isAlarm);
  const blocks = alarms.map((r) => h("section", { class: "steps" },
    h("div", { class: "steps-head" }, riveIcon("shake", { size: 72, height: 48, inputs: { level: 1 } }).el,
      h("div", {}, h("b", {}, "Tamper Alarm"), h("span", {}, `${r.name}${r.locationDescription ? `, ${r.locationDescription}` : ""}`))),
    h("ol", {},
      h("li", { class: "done" }, h("div", {}, h("b", {}, "The rack sounded its siren"), h("p", {}, "It flashed red for 10 s. Bikes stay locked."))),
      h("li", {}, h("div", {}, h("b", {}, "Go and look, or send someone"), h("p", {}, "Check whether a bike or the lock is being forced."),
        btn("Open Rack", () => openRack(r.id)))),
      h("li", { class: r.incidentStatus ? "done" : "" }, h("div", {},
        h("b", {}, r.incidentStatus ? `${AGENCY}: ${INCIDENT_WORD[r.incidentStatus]}` : "If a bike is being stolen, alert the authorities"),
        r.incidentStatus ? h("p", {}, "The pin flashes red and blue until they resolve it.") : btn("Alert Authorities", () => askAuthorities(r), "btn-police"))),
      h("li", {}, h("div", {}, h("b", {}, "When it's safe, mark it handled"), btn("Mark Handled", () => ackRack(r)))))));
  const rest = needsList().filter((n) => n.kind !== "alarm");
  const up = S.racks.filter(isUp).length;
  // Every Rive animation is made first; the reused Needs You rows move last (see rive.js sweep()).
  const clear = S.loaded && !alarms.length && !rest.length
    ? h("section", { class: "all-clear" }, riveIcon("badge", { size: 56, inputs: { kind: BADGE.ok } }).el,
      h("b", {}, "All clear"), h("span", {}, `${up} of ${S.racks.length} racks online. Nothing needs you.`)) : null;
  const listEl = h("div", { class: "needs-list" });
  if (rest.length) renderNeeds(listEl, null, ["alarm"]);
  fill(appMain,
    !S.loaded ? h("p", { class: "app-empty" }, "Loading…") : null,
    clear,
    ...blocks,
    rest.length ? h("section", { class: "needs app-needs" }, h("h2", { class: "app-h2" }, alarms.length ? "Also Needs You" : "Needs You"), listEl) : null,
  );
}

function appRacks() {
  const cards = S.racks.map((r) => {
    const word = isAlarm(r) ? "Alarm" : STATUS_TEXT[r.status];
    const cls = isAlarm(r) ? "st-ALARM" : `st-${r.status}`;
    const pin = riveIcon("pin", { size: 44, inputs: { status: r.incidentStatus ? 4 : isAlarm(r) ? 2 : { ONLINE: 0, WARNING: 1, UNCONFIRMED: 1 }[r.status] ?? 3 } });
    return h("button", { type: "button", class: "rcard", onClick: () => openRack(r.id) },
      h("div", { class: "rcard-head" }, pin.el, h("span", { class: "rcard-name" }, h("b", {}, r.name), h("span", {}, r.locationDescription || "")),
        h("span", { class: cls }, word)),
      h("dl", { class: "rcard-data" },
        h("div", { class: r.openSpots === 0 ? "full" : "" }, h("dt", {}, "Open Spots"), h("dd", {}, r.capacity ? `${r.openSpots} of ${r.capacity}` : "-")),
        h("div", { class: isAlarm(r) ? "alarm" : "" }, h("dt", {}, "Alarm"), h("dd", {}, isAlarm(r) ? "Active now" : r.lastAlarmAt ? `Last ${ago(r.lastAlarmAt)}` : "None yet")),
        h("div", {}, h("dt", {}, "Last Check-In"), h("dd", {}, r.lastSeenAt ? ago(r.lastSeenAt) : "Never")),
        h("div", {}, h("dt", {}, "Open Alerts"), h("dd", {}, String(r.openAlerts))),
        h("div", {}, h("dt", {}, "Lock Modules"), h("dd", {}, `${r.onlineDeviceCount} of ${r.deviceCount} online`)),
        h("div", {}, h("dt", {}, "Police"), h("dd", {}, r.incidentStatus ? INCIDENT_WORD[r.incidentStatus] : "None"))),
      h("span", { class: "rcard-go" }, "Details"));
  });
  fill(appMain, h("div", { class: "rack-cards" },
    CAN.configure ? btn("Add Rack", () => openPlaceSheet(), "btn-primary app-add") : null,
    cards.length ? cards : h("p", { class: "app-empty" }, "No racks yet.")));
}

function appMore() {
  const link = (label, sub, onClick) => h("button", { type: "button", class: "more-item", onClick }, h("b", {}, label), h("span", {}, sub));
  fill(appMain, h("div", { class: "more" },
    CAN.terminal ? link("Commands", "Every terminal command, with examples", () => appGo("commands")) : null,
    link("Reports", "Unlocks, refused cards and alarms per rack and per day", () => appGo("reports")),
    CAN.audit ? link("Audit Log", "Every change anyone made", () => appGo("audit")) : null,
    link("Desktop View", "The full map with the side panel", () => { location.href = "?view=desktop"; }),
    link("Other Versions", "Admin, Staff, Police, Rider", () => { location.href = "/"; }),
    h("p", { class: "more-note" }, S.ok === false ? "Can't reach the server right now." : `Connected · ${S.racks.length} rack${S.racks.length === 1 ? "" : "s"}`)));
}

function openAppSheet(title, build) {
  appSheet.hidden = false;
  const body = h("div", { class: "app-sheet-body" });
  fill(appSheet, h("header", { class: "app-sheet-head" }, btn([icon("back"), "Back"], closeAppSheet, "btn-quiet back-btn"), h("b", {}, title)), body);
  build(body);
  appSheet.scrollTop = 0;
  return body;
}
function closeAppSheet() {
  appSheet.hidden = true;
  fill(appSheet, );
  openId = null;
}

function openAppRack(r, { focus } = {}) {
  openId = r.id;
  const scene = riveIcon("rack", { size: 440, height: 200, fit: "cover", align: "BottomCenter", inputs: { state: sceneState(r) } });
  let bodyEl;
  openAppSheet(r.name, (body) => {
    bodyEl = h("div", { class: "app-rack" });
    body.append(h("div", { class: "panel-scene app-scene" }, scene.el), bodyEl);
  });
  appSheet.dataset.rack = r.id;
  appSheet.sceneHandle = scene;
  renderDetail(bodyEl, r, detailCache.get(r.id), { focus });
  loadDetail(r).then((data) => { if (openId === r.id) renderDetail(bodyEl, rackById(r.id) || r, data, { focus }); }).catch((e) => toast(e.message, true));
}

// =====================================================================================
// Live updates
// =====================================================================================
let detailSig = "";
live.on("change", async (state, first) => {
  const alarms = state.racks.filter(isAlarm).length;
  if (summaryEl) {
    fill(summaryEl, h("b", {}, `${state.racks.filter(isUp).length} of ${state.racks.length}`), " racks online",
      alarms ? h("span", { class: "state-alarm" }, ` · ${alarms} alarm${alarms > 1 ? "s" : ""}`) : "",
      state.incidents.length ? h("span", { class: "police-word" }, ` · ${state.incidents.length} police`) : "");
  }
  document.title = `${alarms ? `(${alarms}) ` : ""}${ROLE === "admin" ? "Admin" : "Staff"} · HokieBikeRack`;
  if (map) map.setRacks(state.racks.map(pinRack));
  if (needsEl) renderNeeds(needsEl, needsCount);
  if (first) {
    // History: the last 30 events, oldest first, so the terminal isn't empty when the page opens.
    for (const e of [...state.events].slice(0, 30).reverse()) eventLine(e);
    log("info", `${ROLE === "admin" ? "admin" : "staff"} console ready. ${state.racks.length} rack${state.racks.length === 1 ? "" : "s"}${CAN.terminal ? ". type help" : ""}`);
  }
  // The open rack: refresh its details when anything about it changed.
  const r = openId && rackById(openId);
  if (r) {
    const sig = JSON.stringify([r, state.unknown.filter((u) => u.lastRackId === r.id), CAN.cards ? state.cards : 0]);
    if (sig !== detailSig) {
      detailSig = sig;
      try {
        const data = await loadDetail(r);
        const target = APP ? appSheet.querySelector(".app-rack") : panelBody;
        if (target && openId === r.id) renderDetail(target, rackById(r.id) || r, data);
      } catch { /* shown by the connection banner */ }
      if (!APP) panelScene.set("state", sceneState(r));
      else appSheet.sceneHandle?.set("state", sceneState(r));
    }
  }
  if (APP) renderApp();
});

live.on("event", (e) => {
  eventLine(e);
  const r = rackById(e.rackId);
  if (!r) return;
  if (e.eventType === "ACCESS_GRANTED") { map?.flash(r.id, "unlock"); if (openId === r.id) playScene(SCENE.granted, 2900); }
  if (e.eventType === "ACCESS_DENIED") { map?.flash(r.id, "deny"); if (openId === r.id) playScene(SCENE.denied, 2400); }
  if (e.eventType === "TAMPER_WARNING") showDrop(r, "bump", { jolt: e.details?.deviationG });
  if (e.eventType === "TAMPER_ALARM") { showDrop({ ...r, openAlarms: Math.max(1, r.openAlarms) }, "alarm", { jolt: e.details?.deviationG }); if (APP) toast(`Tamper alarm at ${r.name}`, true); }
});
live.on("rack", ({ rack: r, before: b }) => {
  if (b.status !== "OFFLINE" && r.status === "OFFLINE") log("off", [{ b: slug(r.name) }, " offline: no check-in for 3 min"]);
  if (b.status === "OFFLINE" && r.status === "UNCONFIRMED") log("warn", [{ b: slug(r.name) }, ` checked in again after being offline. not confirmed${CAN.terminal ? `: check it, then type confirm ${slug(r.name)}` : ""}`]);
  if (b.openAlarms > 0 && r.openAlarms === 0) log("ok", [{ b: slug(r.name) }, " alarm handled"]);
});
live.on("request", (q) => {
  log("card", [{ b: q.name }, ` asked for access online (${q.email}). type approve ${q.name}, or open it in Needs You`]);
  toast(`Access request from ${q.name}`);
});
live.on("incident", ({ incident: i, before }) => {
  if (!before) return;   // a new one is logged by whoever pressed Alert Authorities
  log("police", [{ b: slug(i.rackName) }, ` ${AGENCY}: ${INCIDENT_WORD[i.status].toLowerCase()}${i.status === "RESOLVED" ? ". alarm stopped" : ""}`]);
});
let wasDown = false;
live.on("connection", (ok, message) => {
  termSignal.set("level", ok ? 4 : 0);
  document.body.classList.toggle("disconnected", !ok);
  if (!ok) log("off", `can't reach the server (${message}). retrying…`);
  else if (wasDown) log("ok", "connected again");
  wasDown = !ok;
});

let sceneTimer = null;
function playScene(state, ms) {
  const handle = APP ? appSheet.sceneHandle : panelScene;
  if (!handle) return;
  clearTimeout(sceneTimer);
  handle.set("state", state);
  sceneTimer = setTimeout(() => { const r = rackById(openId); if (r) handle.set("state", sceneState(r)); }, ms);
}

// =====================================================================================
// Start
// =====================================================================================
const root = document.querySelector("#root");
root.append(toasts);
if (APP) buildApp(root); else buildDesktop(root);
const hash = location.hash.slice(1);
window.addEventListener("hashchange", () => go(location.hash.slice(1) || (APP ? "now" : "map")));
await live.start();
if (APP) appGo(TABS.some(([t]) => t === hash) || ["commands", "reports", "audit"].includes(hash) ? hash : "now");
else go(hash || "map");

window.__console = { run, live, openRack, go };
