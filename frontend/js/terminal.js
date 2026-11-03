// HokieBikeRack admin terminal: one page, every section stacked like commands in a terminal.
// No pop-ups: forms and confirmations open inline under the row they belong to.
// Sections refresh every 10 s, except one where a form is open (so typing is never wiped).
import { api, clearCredentials, hasCredentials, setCredentials, setUnauthorizedHandler } from "./api.js";
import { DENY_REASONS, ago, clear, clock, h, renderIfChanged, shortRef, stamp } from "./dom.js";

const VERSION = "0.3.0";
const term = document.querySelector("#term");

const state = {
  me: null,
  canEdit: false,
  openRack: null,            // rack id whose details are open
  rackForm: null,            // { rackId, kind: "rename" | "device" }
  token: null,               // { rackId, label, text } device token printed once
  newRack: false,
  unknownForm: null,         // credential reference being registered
  events: { type: "", rackId: "", unack: false, page: 0, registering: null },
  cards: { showRevoked: false, editing: null, revoking: null, manual: false },
  reportDays: 7,
  auditPage: 0,
  racks: [],
};

// ---------- small building blocks ----------

function btn(label, onClick, opts = {}) {
  return h("button", {
    type: "button", class: `btn${opts.danger ? " danger" : ""}`, onClick, disabled: opts.disabled,
    "aria-pressed": opts.pressed === undefined ? null : String(Boolean(opts.pressed)),
  }, label);
}

function field(label, input) {
  return h("label", { class: "field" }, h("span", {}, `${label}:`), input);
}

function check(label, attrs = {}) {
  return h("label", { class: "check" }, h("input", { type: "checkbox", ...attrs }), h("span", { class: "box" }), label);
}

function section(id, cmd, args = "") {
  const head = h("h2", {}, h("span", { class: "prompt" }, "$"), cmd, args ? h("span", { class: "args" }, args) : null);
  const tools = h("span", { class: "actions" });
  head.append(tools);
  const msg = h("p", { class: "note", role: "status" });
  const body = h("div", { class: "body" });
  const el = h("section", { id, "aria-label": cmd }, head, h("div", { class: "body" }, msg), body);
  return { el, head, tools, body, msg };
}

/** A short message under a section heading. Clears itself. */
function say(sec, text, kind = "ok") {
  sec.msg.className = `msg-${kind}`;
  sec.msg.textContent = text;
  clearTimeout(sec.msgTimer);
  sec.msgTimer = setTimeout(() => { sec.msg.textContent = ""; }, kind === "err" ? 9000 : 4000);
}

/** Runs an API call; on failure prints the server's message in the section. */
async function run(sec, fn, okText) {
  try {
    const result = await fn();
    if (okText) say(sec, okText, "ok");
    return result;
  } catch (err) {
    say(sec, `error: ${err.message}`, "err");
    return null;
  }
}

function table(headers, rows, emptyText, colspan) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, headers.map((t) => h("th", { class: t.endsWith("#") ? "num" : "" }, t.replace("#", ""))))),
    h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: colspan || headers.length, class: "empty" }, emptyText)))));
}

const busy = (sec) => Boolean(sec.el.querySelector(".form")) || sec.el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);

// ---------- sign in ----------

function showLogin(message = "") {
  clear(term);
  const user = h("input", { name: "username", autocomplete: "username", value: "admin", spellcheck: "false", required: true });
  const pass = h("input", { name: "password", type: "password", autocomplete: "current-password", required: true });
  const err = h("p", { class: "msg-err", role: "alert" }, message);
  const form = h("form", { class: "login", onSubmit: async (e) => {
    e.preventDefault();
    setCredentials(user.value.trim(), pass.value);
    pass.value = "";
    err.textContent = "";
    await start(err);
  } },
  h("label", {}, h("span", {}, "login:"), user),
  h("label", {}, h("span", {}, "password:"), pass),
  h("button", { type: "submit", class: "btn" }, "sign in"),
  err);
  term.append(
    h("p", {}, h("span", { class: "prompt" }, "hokiebikerack"), ` admin console ${VERSION}`),
    h("p", { class: "note" }, "viewer accounts are read-only."),
    form);
  (message ? pass : (user.value ? pass : user)).focus();
}

async function start(errEl) {
  try {
    state.me = await api("/me");
  } catch (e) {
    clearCredentials();
    if (errEl) errEl.textContent = e.status === 401 ? "login incorrect" : e.message;
    else showLogin();
    return;
  }
  state.canEdit = Boolean(state.me.canEdit);
  buildConsole();
}

setUnauthorizedHandler(() => {
  clearCredentials();
  clearInterval(timer);
  showLogin("session ended. sign in again.");
});

// ---------- the console ----------

let timer = null;
const S = {};   // sections

function buildConsole() {
  clear(term);
  const live = h("span", { class: "live-ok" }, "connecting");
  const top = h("div", { class: "topline" },
    h("span", {}, h("b", {}, "hokiebikerack"), ` ${VERSION}   ${state.me.username}@${location.host} `,
      h("span", { class: state.canEdit ? "ok" : "warn" }, state.canEdit ? "(admin)" : "(read-only)")),
    h("span", {}, live, h("span", { class: "cursor", "aria-hidden": "true" }), "  ",
      btn("help", () => toggleHelp()), " ",
      btn("sign out", () => { clearCredentials(); clearInterval(timer); showLogin(); })));
  term.append(top);
  S.live = live;

  S.help = section("help", "help");
  S.status = section("status", "status");
  S.apps = section("apps", "apps");
  S.racks = section("racks", "racks");
  S.unknown = section("unknown", "cards", "--unknown");
  S.events = section("events", "events", "--tail 50");
  S.cards = section("cards", "cards");
  S.report = section("report", "report");
  S.audit = section("audit", "audit", "--tail 20");
  for (const sec of [S.help, S.status, S.apps, S.racks, S.unknown, S.events, S.cards, S.report, S.audit]) term.append(sec.el);

  renderApps();
  renderHelp();
  S.help.el.hidden = localStorage.getItem("hbr.term.help") === "hidden";
  refreshAll(true);
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === "visible") refreshAll(false); }, 10000);
}

async function refreshAll(force) {
  const jobs = [
    [S.status, loadStatus], [S.racks, loadRacks], [S.unknown, loadUnknown], [S.events, loadEvents],
    [S.cards, loadCards], [S.report, loadReport], [S.audit, loadAudit],
  ];
  let ok = true;
  await Promise.all(jobs.map(async ([sec, fn]) => {
    if (!force && busy(sec)) return;
    try { await fn(); } catch (e) { ok = false; if (e.status !== 401) say(sec, `error: ${e.message}`, "err"); }
  }));
  S.live.className = ok ? "live-ok" : "live-bad";
  S.live.textContent = ok ? `live ${clock()}` : "backend unreachable";
}

// ---------- $ status ----------

async function loadStatus() {
  const [racks, creds, unknown, rev] = await Promise.all([
    api("/racks"), api("/credentials"), api("/credentials/unknown"), api("/credentials/revision")]);
  state.racks = racks;
  const devices = racks.reduce((n, r) => n + r.deviceCount, 0);
  const online = racks.reduce((n, r) => n + r.onlineDeviceCount, 0);
  const alerts = racks.reduce((n, r) => n + r.openAlerts, 0);
  const active = creds.filter((c) => c.status === "ACTIVE").length;
  const item = (label, value, cls = "") => h("span", {}, `${label} `, h("b", { class: cls }, String(value)));
  renderIfChanged(S.status.body, JSON.stringify([racks.length, devices, online, alerts, active, unknown.length, rev.revision]), () =>
    h("p", { class: "status-line" },
      item("racks", racks.length),
      item("devices online", `${online}/${devices}`, devices && online < devices ? "warn" : ""),
      item("open alerts", alerts, alerts ? "warn" : ""),
      item("active cards", active),
      item("unknown taps", unknown.length, unknown.length ? "warn" : ""),
      item("card list revision", rev.revision)));
}

// ---------- $ help (the terminal's tutorial) ----------

function toggleHelp(show) {
  const hidden = show === undefined ? !S.help.el.hidden : !show;
  S.help.el.hidden = hidden;
  localStorage.setItem("hbr.term.help", hidden ? "hidden" : "shown");
  if (!hidden) S.help.el.scrollIntoView({ block: "start" });
}

function renderHelp() {
  const line = (cmd, text) => h("tr", {}, h("td", { class: "ok" }, cmd), h("td", { class: "wrap" }, text));
  clear(S.help.tools).append(btn("hide help", () => toggleHelp(false)));
  clear(S.help.body).append(
    h("p", {}, "everything is on this one page. each section is like a command; it refreshes every 10 s on its own."),
    h("p", { class: "sub" }, "first time? set up a rack in this order:"),
    h("table", {}, h("tbody", {},
      line("1. $ racks", "[new rack]: give it a name and (optional) lat, lng. or use [place on map] to click the spot."),
      line("2.", "[details] > [add device]: a token is printed once. copy it into firmware/include/config.h."),
      line("3. esp32", "flash it. within a minute the rack shows online here."),
      line("4. tap a card", "it appears under $ cards --unknown. [register] it and pick the racks it works at."),
      line("5. tap again", "green light and a beep: it worked. see it under $ events."))),
    h("p", { class: "sub" }, "what each section is for:"),
    h("table", {}, h("tbody", {},
      line("$ status", "counts at a glance. amber means something wants a look."),
      line("$ apps", "the rider and staff apps, in a phone frame or a new tab."),
      line("$ racks", "every rack, its lock modules and their health. [ack alerts] clears its warnings."),
      line("$ cards --unknown", "cards that were tapped but aren't registered yet."),
      line("$ events", "everything the racks reported. filter by type or rack. * means the rack's clock wasn't set."),
      line("$ cards", "registered cards. [edit] changes racks or expiry, [revoke] turns one off for good."),
      line("$ report", "counts by type, rack and day."),
      line("$ audit", "every change an admin made, and who made it."))),
    h("p", { class: "note" }, "viewer accounts see everything but can't change anything. more: docs/notes/overview.md"));
}

// ---------- $ apps ----------

function renderApps() {
  clear(S.apps.body).append(h("p", { class: "actions" },
    btn("open rider app", () => openPhone("")),
    btn("open staff app", () => openPhone("staff")),
    h("span", { class: "note" }, "or in a new tab: "),
    h("a", { href: "/app/", target: "_blank", rel: "noopener" }, "/app"),
    h("a", { href: "/app/?mode=staff", target: "_blank", rel: "noopener" }, "/app?mode=staff")));
}

function openPhone(mode) {
  const src = `/app/?embed=1${mode ? `&mode=${mode}` : ""}`;
  const opener = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); if (opener && opener.focus) opener.focus(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const overlay = h("div", { class: "phone-overlay", role: "dialog", "aria-modal": "true",
    "aria-label": mode ? "staff app" : "rider app", onClick: (e) => { if (e.target === overlay) close(); } },
  h("div", { class: "phone-wrap" },
    h("div", { class: "phone-bar" }, h("span", {}, mode ? "staff app" : "rider app"),
      h("a", { href: src.replace("embed=1&", "").replace("?embed=1", ""), target: "_blank", rel: "noopener" }, "open in new tab"),
      btn("close", close)),
    h("div", { class: "phone" }, h("iframe", { src, title: mode ? "Staff app" : "Rider app" }))));
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".btn").focus();
}

// ---------- $ racks ----------

/** "37.2297, -80.4199" -> {latitude, longitude}; "" -> null; anything else -> throws. */
function parseCoords(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new Error("coordinates look like 37.2297, -80.4199 (latitude, longitude)");
  return { latitude: Number(m[1]), longitude: Number(m[2]) };
}
const coordsText = (r) => (r.latitude != null ? `${r.latitude}, ${r.longitude}` : "");

async function loadRacks() {
  const racks = await api("/racks");
  state.racks = racks;
  let detail = null;
  if (state.openRack && racks.some((r) => r.id === state.openRack)) {
    const [rack, rev] = await Promise.all([api(`/racks/${state.openRack}`), api("/credentials/revision")]);
    detail = { rack, revision: rev.revision };
  }
  const sig = JSON.stringify([racks, detail, state.openRack, state.rackForm, state.token, state.newRack, state.canEdit]);
  renderIfChanged(S.racks.body, sig, () => {
    const rows = [];
    for (const r of racks) {
      const open = r.id === state.openRack;
      rows.push(h("tr", { class: open ? "open" : "" },
        h("td", {}, r.name),
        h("td", { class: `st-${r.status}` }, r.status.toLowerCase()),
        h("td", { class: "num" }, `${r.onlineDeviceCount}/${r.deviceCount}`),
        h("td", {}, ago(r.lastSeenAt)),
        h("td", { class: `num ${r.openAlerts ? "warn" : "dim"}` }, String(r.openAlerts)),
        h("td", {}, h("span", { class: "actions" },
          btn(open ? "close" : "details", () => { state.openRack = open ? null : r.id; state.rackForm = null; loadRacks(); }),
          r.status === "UNCONFIRMED" && state.canEdit ? btn("confirm online", async () => {
            const res = await run(S.racks, () => api(`/racks/${r.id}/confirm-online`, { method: "POST" }));
            if (res) { say(S.racks, `${r.name} confirmed online`); refreshAll(true); }
          }) : null,
          r.openAlerts && state.canEdit ? btn("ack alerts", async () => {
            const res = await run(S.racks, () => api(`/events/acknowledge-rack/${r.id}`, { method: "POST" }));
            if (res) { say(S.racks, `${res.acknowledged} alert(s) marked handled`); refreshAll(true); }
          }) : null))));
      if (open && detail) rows.push(h("tr", { class: "detail" }, h("td", { colspan: 6 }, rackDetail(detail.rack, detail.revision))));
    }
    const parts = [table(["NAME", "STATUS", "DEVICES#", "LAST SEEN", "ALERTS#", ""], rows, "no racks yet.")];
    if (state.canEdit) parts.push(state.newRack ? newRackForm() : h("p", {}, btn("new rack", () => { state.newRack = true; loadRacks(); })));
    return parts;
  });
  const first = S.racks.body.querySelector(".form input");
  if (first && !S.racks.el.contains(document.activeElement)) first.focus();
}

function newRackForm() {
  const name = h("input", { required: true, maxlength: 120, class: "wide", placeholder: "e.g. torgersen hall north" });
  const loc = h("input", { maxlength: 255, class: "wide" });
  const coords = h("input", { placeholder: "37.2297, -80.4199", spellcheck: "false" });
  const done = () => { state.newRack = false; loadRacks(); };
  return h("form", { class: "form", onSubmit: async (e) => {
    e.preventDefault();
    let where;
    try { where = parseCoords(coords.value); } catch (err) { say(S.racks, `error: ${err.message}`, "err"); return; }
    const res = await run(S.racks, () => api("/racks", { method: "POST", body: { name: name.value.trim(), locationDescription: loc.value.trim() || null, ...(where || {}) } }),
      `created rack "${name.value.trim()}"`);
    if (res) { state.openRack = res.rack.id; done(); loadStatus(); }
  } },
  h("div", { class: "row" }, field("name", name), field("location", loc)),
  h("div", { class: "row" }, field("map lat, lng", coords), h("span", { class: "note" }, "optional. right-click a spot in google maps to copy it.")),
  h("div", { class: "row" }, h("button", { type: "submit", class: "btn" }, "create"), btn("cancel", done)));
}

function rackDetail(rack, revision) {
  const r = rack.rack;
  const parts = [h("p", { class: "note" }, `id ${r.id}   location: `, h("span", { class: "dim" }, r.locationDescription || "not set"),
    "   map: ", r.latitude != null ? h("span", { class: "dim" }, coordsText(r)) : h("span", { class: "warn" }, "not placed (won't show on the app's map)"))];
  const form = state.rackForm && state.rackForm.rackId === r.id ? state.rackForm.kind : null;
  if (state.canEdit && !form) {
    parts.push(h("p", { class: "actions" },
      btn("edit", () => { state.rackForm = { rackId: r.id, kind: "rename" }; loadRacks(); }),
      btn("add device", () => { state.rackForm = { rackId: r.id, kind: "device" }; loadRacks(); }),
      // Clicking the spot on a satellite map is easier than typing coordinates.
      btn("place on map", () => window.open(`/app/?mode=staff#rack/${r.id}/place`, "_blank", "noopener"))));
  }
  if (form === "rename") parts.push(renameForm(r));
  if (form === "device") parts.push(addDeviceForm(r));
  if (state.token && state.token.rackId === r.id) {
    parts.push(h("p", { class: "msg-warn" }, `token for "${state.token.label}". shown once: copy it now, the server keeps only a hash.`),
      h("pre", { class: "out" }, state.token.text),
      h("p", { class: "actions" },
        btn("copy", () => copy(state.token.text, S.racks)),
        btn("done", () => { state.token = null; loadRacks(); })));
  }
  const devRows = rack.devices.map((d) => h("tr", {},
    h("td", {}, d.label),
    h("td", { class: !d.active ? "dim" : d.online ? "ok" : "dim" }, !d.active ? "disabled" : d.online ? "online" : "offline"),
    h("td", {}, d.firmwareVersion || "-"),
    h("td", {}, ago(d.lastSeenAt)),
    h("td", { class: !d.lastSeenAt ? "dim" : d.authorizationRevision >= revision ? "ok" : "warn" },
      !d.lastSeenAt ? "-" : d.authorizationRevision >= revision ? "current" : "syncing"),
    h("td", { class: "wrap" }, health(d.lastHeartbeat)),
    h("td", {}, state.canEdit ? h("span", { class: "actions" },
      btn("new token", async () => {
        const res = await run(S.racks, () => api(`/racks/${r.id}/devices/${d.id}/rotate-token`, { method: "POST" }),
          `new token for "${d.label}"; the old one no longer works`);
        if (res) { state.token = { rackId: r.id, label: d.label, text: res.configSnippet.trim() }; loadRacks(); }
      }),
      btn(d.active ? "disable" : "enable", async () => {
        const res = await run(S.racks, () => api(`/racks/${r.id}/devices/${d.id}`, { method: "PATCH", body: { active: !d.active } }),
          `${d.label} ${d.active ? "disabled" : "enabled"}`);
        if (res) loadRacks();
      }, { danger: d.active })) : null)));
  parts.push(table(["DEVICE", "STATE", "FIRMWARE", "LAST SEEN", "CARD LIST", "HEALTH", ""], devRows,
    "no devices. add one, then put its id and token in the esp32's config.h."));
  return parts;
}

function health(hb) {
  if (!hb) return h("span", { class: "dim" }, "no heartbeat yet");
  const part = (text, cls) => h("span", { class: cls }, text);
  const sep = "  ";
  return [
    part(`reader ${hb.readerOk === false ? "FAULT" : "ok"}`, hb.readerOk === false ? "bad" : "ok"), sep,
    part(`accel ${hb.accelOk === false ? "FAULT" : "ok"}`, hb.accelOk === false ? "bad" : "ok"), sep,
    part(`clock ${hb.clockSynced ? "set" : "NOT SET"}`, hb.clockSynced ? "ok" : "bad"), sep,
    part(`lock ${hb.lockUnlocked ? "open" : "closed"}`, hb.lockUnlocked ? "warn" : "dim"), sep,
    part(`servo ${hb.servoEnabled ? "real" : "sim"}`, hb.servoEnabled ? "warn" : "dim"),
    hb.alarmActive ? [sep, part("ALARM", "bad")] : null,
    hb.wifiRssi != null ? [sep, part(`rssi ${hb.wifiRssi}`, "dim")] : null,
    hb.queueDepth != null ? [sep, part(`queue ${hb.queueDepth}`, hb.queueDepth > 0 ? "warn" : "dim")] : null,
    hb.simulated ? [sep, part("sim", "sim")] : null,
  ];
}

function renameForm(r) {
  const name = h("input", { value: r.name, required: true, maxlength: 120, class: "wide" });
  const loc = h("input", { value: r.locationDescription || "", maxlength: 255, class: "wide" });
  const coords = h("input", { value: coordsText(r), placeholder: "37.2297, -80.4199", spellcheck: "false" });
  const done = () => { state.rackForm = null; loadRacks(); };
  return h("form", { class: "form", onSubmit: async (e) => {
    e.preventDefault();
    let where;
    try { where = parseCoords(coords.value); } catch (err) { say(S.racks, `error: ${err.message}`, "err"); return; }
    const body = { name: name.value.trim(), locationDescription: loc.value.trim(), ...(where || { clearCoordinates: true }) };
    const res = await run(S.racks, () => api(`/racks/${r.id}`, { method: "PATCH", body }), "saved");
    if (res) done();
  } },
  h("div", { class: "row" }, field("name", name), field("location", loc)),
  h("div", { class: "row" }, field("map lat, lng", coords), h("span", { class: "note" }, "empty = not on the map")),
  h("div", { class: "row" }, h("button", { type: "submit", class: "btn" }, "save"), btn("cancel", done)));
}

function addDeviceForm(r) {
  const label = h("input", { required: true, maxlength: 120, placeholder: "esp32 #1" });
  const done = () => { state.rackForm = null; loadRacks(); };
  return h("form", { class: "form", onSubmit: async (e) => {
    e.preventDefault();
    const res = await run(S.racks, () => api(`/racks/${r.id}/devices`, { method: "POST", body: { label: label.value.trim() } }),
      `added "${label.value.trim()}"`);
    if (res) { state.token = { rackId: r.id, label: label.value.trim(), text: res.configSnippet.trim() }; done(); loadStatus(); }
  } },
  h("div", { class: "row" }, field("device label", label)),
  h("div", { class: "row" }, h("button", { type: "submit", class: "btn" }, "add device"), btn("cancel", done)));
}

async function copy(text, sec) {
  try { await navigator.clipboard.writeText(text); say(sec, "copied"); }
  catch { say(sec, "copy failed: select the text and copy it by hand", "warn"); }
}

// ---------- register a card (shared by three sections) ----------

function registerForm(sec, ref, rackId, onDone) {
  const refInput = h("input", { value: ref || "", required: true, pattern: "[0-9a-fA-F]{64}", class: "ref", spellcheck: "false",
    placeholder: "64 hex characters" });
  const label = h("input", { required: true, maxlength: 120, placeholder: "name on the card", class: "wide" });
  const all = h("input", { type: "checkbox" });
  const racks = state.racks.map((r) => ({ r, box: h("input", { type: "checkbox", checked: r.id === rackId }) }));
  const until = h("input", { type: "datetime-local" });
  const form = h("form", { class: "form", onSubmit: async (e) => {
    e.preventDefault();
    const res = await run(sec, () => api("/credentials", { method: "POST", body: {
      credentialReference: refInput.value.trim().toLowerCase(),
      displayLabel: label.value.trim(),
      allRacks: all.checked,
      rackIds: racks.filter((x) => x.box.checked).map((x) => x.r.id),
      validUntil: until.value ? new Date(until.value).toISOString() : null,
    } }), `registered "${label.value.trim()}". racks pick it up on their next sync (about a minute).`);
    if (res) { onDone(true); refreshAll(true); }
  } },
  ref ? h("p", { class: "note" }, `reference ${ref}`) : h("div", { class: "row" }, field("reference", refInput)),
  h("div", { class: "row" }, field("label", label)),
  h("div", { class: "row" },
    h("label", { class: "check" }, all, h("span", { class: "box" }), "all racks"),
    racks.map((x) => h("label", { class: "check" }, x.box, h("span", { class: "box" }), x.r.name))),
  h("div", { class: "row" }, field("valid until", until), h("span", { class: "note" }, "empty = no end")),
  h("div", { class: "row" }, h("button", { type: "submit", class: "btn" }, "register"), btn("cancel", () => onDone(false))));
  setTimeout(() => (ref ? label : refInput).focus(), 0);
  return form;
}

// ---------- $ cards --unknown ----------

async function loadUnknown() {
  const unknown = await api("/credentials/unknown");
  renderIfChanged(S.unknown.body, JSON.stringify([unknown, state.unknownForm, state.canEdit, state.racks.length]), () => {
    const rows = [];
    for (const u of unknown) {
      rows.push(h("tr", { class: state.unknownForm === u.credentialReference ? "open" : "" },
        h("td", {}, shortRef(u.credentialReference, 16)),
        h("td", { class: "num" }, String(u.attempts)),
        h("td", {}, ago(u.lastSeenAt)),
        h("td", {}, u.lastRackName || "-"),
        h("td", {}, state.canEdit && state.unknownForm !== u.credentialReference
          ? btn("register", () => { state.unknownForm = u.credentialReference; loadUnknown(); }) : null)));
      if (state.unknownForm === u.credentialReference) {
        rows.push(h("tr", { class: "detail" }, h("td", { colspan: 5 },
          registerForm(S.unknown, u.credentialReference, u.lastRackId, () => { state.unknownForm = null; loadUnknown(); }))));
      }
    }
    return [h("p", { class: "note" }, "cards tapped in the last 7 days that aren't registered."),
      table(["REFERENCE", "TAPS#", "LAST TAP", "RACK", ""], rows, "none.")];
  });
}

// ---------- $ events ----------

const EVENT_TYPES = [["all", ""], ["access", "ACCESS"], ["denied", "ACCESS_DENIED"], ["tamper", "TAMPER"], ["sensor", "SENSOR"], ["device", "DEVICE"]];

function eventDetail(e) {
  const d = e.details || {};
  switch (e.eventType) {
    case "ACCESS_DENIED": return DENY_REASONS[d.reason] || d.reason || "";
    case "TAMPER_WARNING":
    case "TAMPER_ALARM": return d.deviationG != null ? `jolt ${Number(d.deviationG).toFixed(2)} g` : "";
    case "SENSOR_FAULT": return `${d.sensor || ""} ${String(d.state || "").toLowerCase().replaceAll("_", " ")}`;
    case "DEVICE_BOOT": return d.resetReason ? `reset ${String(d.resetReason).toLowerCase().replaceAll("_", " ")}` : "";
    default: return "";
  }
}

async function loadEvents() {
  const f = state.events;
  const data = await api("/events", { query: { rackId: f.rackId, type: f.type, unacknowledged: f.unack || undefined, page: f.page, size: 50 } });
  // Filter line (rebuilt only when the rack list or filters change).
  renderIfChanged(S.events.tools, JSON.stringify([f, state.racks.map((r) => r.id)]), () => [
    h("span", { class: "args" }, "--type"),
    EVENT_TYPES.map(([label, value]) => btn(label, () => { f.type = value; f.page = 0; loadEvents(); }, { pressed: f.type === value })),
    h("span", { class: "args" }, "--rack"),
    (() => {
      const sel = h("select", { "aria-label": "rack", onChange: (e) => { f.rackId = e.target.value; f.page = 0; e.target.blur(); loadEvents(); } },
        h("option", { value: "" }, "all"), state.racks.map((r) => h("option", { value: r.id }, r.name)));
      sel.value = f.rackId;
      return sel;
    })(),
    check("needs review", { checked: f.unack, onChange: (e) => { f.unack = e.target.checked; f.page = 0; loadEvents(); } }),
  ]);
  const pages = Math.max(1, Math.ceil(data.total / 50));
  renderIfChanged(S.events.body, JSON.stringify([data, f.registering, state.canEdit]), () => {
    const rows = [];
    for (const e of data.items) {
      const alert = ["MEDIUM", "HIGH", "CRITICAL"].includes(e.severity);
      const unknownCard = e.eventType === "ACCESS_DENIED" && e.credentialReference && !e.credentialId;
      rows.push(h("tr", {},
        h("td", { title: e.timeSource === "SERVER" ? "rack clock not set: time the server received it" : "" },
          stamp(e.occurredAt), e.timeSource === "SERVER" ? h("span", { class: "dim" }, "*") : " "),
        h("td", {}, e.rackName || "-"),
        h("td", {}, e.eventType.toLowerCase(), e.simulated ? h("span", { class: "sim" }, " sim") : null),
        h("td", { class: `sev-${e.severity}` }, e.severity.toLowerCase()),
        h("td", {}, e.credentialLabel || (e.credentialReference ? shortRef(e.credentialReference) : "-")),
        h("td", { class: "dim" }, eventDetail(e)),
        h("td", { class: e.acknowledgedAt ? "dim" : alert ? "warn" : "dim" },
          e.acknowledgedAt ? `handled by ${e.acknowledgedBy}` : alert ? "review" : "-"),
        h("td", {}, state.canEdit ? h("span", { class: "actions" },
          alert && !e.acknowledgedAt ? btn("ack", async () => {
            if (await run(S.events, () => api(`/events/${e.id}/acknowledge`, { method: "POST" }), "marked handled")) refreshAll(true);
          }) : null,
          unknownCard && f.registering !== e.id ? btn("register", () => { f.registering = e.id; loadEvents(); }) : null) : null)));
      if (f.registering === e.id) {
        rows.push(h("tr", { class: "detail" }, h("td", { colspan: 8 },
          registerForm(S.events, e.credentialReference, e.rackId, () => { f.registering = null; loadEvents(); }))));
      }
    }
    return [
      table(["TIME", "RACK", "EVENT", "SEV", "CARD", "DETAIL", "STATUS", ""], rows, "no events. tap a card on a rack, or run tools/device_simulator.py."),
      h("p", { class: "actions" },
        btn("newer", () => { f.page--; loadEvents(); }, { disabled: f.page === 0 }),
        h("span", { class: "note" }, `page ${f.page + 1}/${pages}  ${data.total} events  * = rack clock not set`),
        btn("older", () => { f.page++; loadEvents(); }, { disabled: f.page + 1 >= pages })),
    ];
  });
}

// ---------- $ cards ----------

async function loadCards() {
  const cards = await api("/credentials");
  const c = state.cards;
  const name = Object.fromEntries(state.racks.map((r) => [r.id, r.name]));
  renderIfChanged(S.cards.tools, JSON.stringify([c.showRevoked, c.manual, state.canEdit]), () => [
    check("show revoked", { checked: c.showRevoked, onChange: (e) => { c.showRevoked = e.target.checked; loadCards(); } }),
    state.canEdit && !c.manual ? btn("register by reference", () => { c.manual = true; loadCards(); }) : null,
  ]);
  const visible = cards.filter((x) => c.showRevoked || x.status !== "REVOKED");
  renderIfChanged(S.cards.body, JSON.stringify([visible, c, state.racks, state.canEdit]), () => {
    const rows = [];
    for (const x of visible) {
      rows.push(h("tr", { class: c.editing === x.id || c.revoking === x.id ? "open" : "" },
        h("td", {}, x.displayLabel),
        h("td", { class: `st-${x.status}` }, x.status.toLowerCase().replaceAll("_", " ")),
        h("td", {}, x.allRacks ? "all" : x.rackIds.map((id) => name[id] || "?").join(", ") || h("span", { class: "warn" }, "none")),
        h("td", {}, x.validUntil ? stamp(x.validUntil) : "-"),
        h("td", {}, ago(x.lastUsedAt)),
        h("td", { class: "num" }, String(x.grantedCount)),
        h("td", { class: "dim" }, shortRef(x.credentialReference)),
        h("td", {}, state.canEdit && x.status !== "REVOKED" && c.editing !== x.id && c.revoking !== x.id ? h("span", { class: "actions" },
          btn("edit", () => { c.editing = x.id; c.revoking = null; loadCards(); }),
          btn("revoke", () => { c.revoking = x.id; c.editing = null; loadCards(); }, { danger: true })) : null)));
      if (c.editing === x.id) rows.push(h("tr", { class: "detail" }, h("td", { colspan: 8 }, editCardForm(x))));
      if (c.revoking === x.id) {
        rows.push(h("tr", { class: "detail" }, h("td", { colspan: 8 }, h("div", { class: "form" },
          h("p", {}, `revoke "${x.displayLabel}"? it stops working at every rack after their next sync. this can't be undone.`),
          h("div", { class: "row" },
            btn("revoke", async () => {
              if (await run(S.cards, () => api(`/credentials/${x.id}/revoke`, { method: "POST" }), `revoked "${x.displayLabel}"`)) {
                c.revoking = null; refreshAll(true);
              }
            }, { danger: true }),
            btn("cancel", () => { c.revoking = null; loadCards(); }))))));
      }
    }
    return [
      c.manual ? registerForm(S.cards, null, null, () => { c.manual = false; loadCards(); }) : null,
      table(["LABEL", "STATUS", "RACKS", "VALID UNTIL", "LAST USED", "USES#", "REF", ""], rows,
        "no cards. tap one on a rack, then register it under cards --unknown."),
    ];
  });
}

function editCardForm(x) {
  const label = h("input", { value: x.displayLabel, required: true, maxlength: 120, class: "wide" });
  const enabled = h("input", { type: "checkbox", checked: x.active });
  const all = h("input", { type: "checkbox", checked: x.allRacks });
  const racks = state.racks.map((r) => ({ r, box: h("input", { type: "checkbox", checked: x.rackIds.includes(r.id) }) }));
  const toLocal = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const until = h("input", { type: "datetime-local", value: toLocal(x.validUntil) });
  const done = () => { state.cards.editing = null; loadCards(); };
  setTimeout(() => label.focus(), 0);
  return h("form", { class: "form", onSubmit: async (e) => {
    e.preventDefault();
    const validUntil = until.value ? new Date(until.value).toISOString() : null;
    const res = await run(S.cards, () => api(`/credentials/${x.id}`, { method: "PATCH", body: {
      displayLabel: label.value.trim(), active: enabled.checked, allRacks: all.checked,
      rackIds: racks.filter((y) => y.box.checked).map((y) => y.r.id),
      validUntil, clearValidUntil: validUntil === null,
    } }), "saved. racks pick it up on their next sync.");
    if (res) { state.cards.editing = null; refreshAll(true); }
  } },
  h("div", { class: "row" }, field("label", label)),
  h("div", { class: "row" },
    h("label", { class: "check" }, enabled, h("span", { class: "box" }), "enabled"),
    h("label", { class: "check" }, all, h("span", { class: "box" }), "all racks"),
    racks.map((y) => h("label", { class: "check" }, y.box, h("span", { class: "box" }), y.r.name))),
  h("div", { class: "row" }, field("valid until", until), h("span", { class: "note" }, "empty = no end")),
  h("div", { class: "row" }, h("button", { type: "submit", class: "btn" }, "save"), btn("cancel", done)));
}

// ---------- $ report ----------

function barRows(entries, cls = "") {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([label, v]) => h("tr", {},
    h("td", {}, label), h("td", { class: "num" }, String(v)),
    h("td", { class: `bar ${cls}` }, "█".repeat(Math.max(1, Math.round((v / max) * 30))))));
}

async function loadReport() {
  const r = await api("/reports/summary", { query: { days: state.reportDays } });
  renderIfChanged(S.report.tools, String(state.reportDays), () => [
    h("span", { class: "args" }, "--days"),
    [1, 7, 30].map((d) => btn(String(d), () => { state.reportDays = d; loadReport(); }, { pressed: state.reportDays === d })),
  ]);
  renderIfChanged(S.report.body, JSON.stringify(r.byType) + JSON.stringify(r.byRack) + JSON.stringify(r.byDay) + r.days, () => {
    const total = Object.values(r.byType).reduce((a, b) => a + b, 0);
    const t = r.byType;
    return [
      h("p", { class: "status-line" },
        h("span", {}, "events ", h("b", {}, String(total))),
        h("span", {}, "unlocks ", h("b", {}, String(t.ACCESS_GRANTED || 0))),
        h("span", {}, "denied ", h("b", {}, String(t.ACCESS_DENIED || 0))),
        h("span", {}, "tamper ", h("b", {}, String((t.TAMPER_WARNING || 0) + (t.TAMPER_ALARM || 0)))),
        h("span", {}, "active cards ", h("b", {}, String(r.activeCredentials)))),
      h("div", { class: "cols" },
        h("div", {}, h("p", { class: "sub" }, "by type"),
          h("table", { class: "bars" }, h("tbody", {}, barRows(Object.entries(r.byType).map(([k, v]) => [k.toLowerCase(), v]))))),
        h("div", {}, h("p", { class: "sub" }, "why taps were denied"),
          Object.keys(r.deniedReasons).length
            ? h("table", { class: "bars" }, h("tbody", {}, barRows(Object.entries(r.deniedReasons).map(([k, v]) => [DENY_REASONS[k] || k, v]), "warn")))
            : h("p", { class: "empty" }, "none."))),
      h("p", { class: "sub" }, "by rack"),
      table(["RACK", "UNLOCKS#", "DENIED#", "TAMPER#", "SENSOR#"], r.byRack.map((x) => h("tr", {},
        h("td", {}, x.rackName), h("td", { class: "num" }, String(x.granted)), h("td", { class: "num" }, String(x.denied)),
        h("td", { class: "num" }, String(x.tamper)), h("td", { class: "num" }, String(x.faults)))), "no racks."),
      h("p", { class: "sub" }, `by day (${r.timeZone})`),
      table(["DAY", "UNLOCKS#", "DENIED#", "TAMPER#"], r.byDay.map((d) => h("tr", {},
        h("td", {}, d.day), h("td", { class: "num" }, String(d.granted)), h("td", { class: "num" }, String(d.denied)),
        h("td", { class: "num" }, String(d.tamper)))), "no events in this period."),
    ];
  });
}

// ---------- $ audit ----------

async function loadAudit() {
  const data = await api("/audit-log", { query: { page: state.auditPage, size: 20 } });
  const pages = Math.max(1, Math.ceil(data.total / 20));
  renderIfChanged(S.audit.body, JSON.stringify(data), () => [
    table(["TIME", "WHO", "ACTION", "TARGET", "DETAILS"], data.items.map((a) => h("tr", {},
      h("td", {}, stamp(a.createdAt)),
      h("td", {}, a.actor),
      h("td", {}, a.action.toLowerCase()),
      h("td", { class: "dim" }, a.targetType ? `${a.targetType.toLowerCase()} ${String(a.targetId || "").slice(0, 8)}` : "-"),
      h("td", { class: "dim wrap" }, Object.entries(a.details || {})
        .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : v}`).join("  ")))), "no admin changes yet."),
    h("p", { class: "actions" },
      btn("newer", () => { state.auditPage--; loadAudit(); }, { disabled: state.auditPage === 0 }),
      h("span", { class: "note" }, `page ${state.auditPage + 1}/${pages}`),
      btn("older", () => { state.auditPage++; loadAudit(); }, { disabled: state.auditPage + 1 >= pages })),
  ]);
}

// ---------- go ----------

if (hasCredentials()) start(null);
else showLogin();
