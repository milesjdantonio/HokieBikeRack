// Testing panel: a button in the bottom-right corner of every version that opens a panel for
// testers. It talks straight to the rack (the Arduino Uno) over USB with Web Serial, so it works
// with the offline rack: add and remove cards, unlock, set off the alarm, play sounds, move the
// servo, and read the rack's own log. Chrome or Edge only (Web Serial), on localhost or https.
//
// Everything here is a serial command the firmware already has (docs/notes/firmware.md, "Serial
// console"). The test-only ones need HBR_ENABLE_SERIAL_SIM 1 in config.h.
import { h } from "../js/dom.js";
import { icon } from "./icons.js";

const BAUD = 115200;
const SIM_ONLY = new Set(["tap", "shake", "buzz", "servo", "lock", "unlock", "silence", "cancel"]);
const TAMPER_GRACE_MS = 10000; // firmware ignores shakes this long after the lock closes
const LOG_MAX = 400;
const OPEN_KEY = "hbr-testing-open";

const state = {
  port: null, reader: null, writer: null, readDone: null, writeDone: null,
  connected: false, ready: false,
  lock: null,          // "locked" | "unlocked"
  alarm: "quiet",      // "quiet" | "warning" | "alarm"
  cards: [], cardCount: null, collecting: 0,
  cardMode: null,      // { kind: "add" | "remove", until: ms }
  lastLockedAt: 0, lastSimSentAt: 0, simOff: false,
  busy: "",            // short text while a sequence runs
};
let warningTimer = 0;

// ---------- styles (tokens from tokens.css / theme.css) ----------
const css = `
.hbt-fab { position: fixed; z-index: 1000; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 10px 16px 10px 12px;
  background: var(--panel-3); color: var(--ink); font: 500 14px/1 var(--text); cursor: pointer; box-shadow: var(--float-shadow); }
.hbt-fab svg { width: 18px; height: 18px; }
.hbt-fab:hover { background: var(--panel-2); transform: translateY(-1px); }
.hbt-fab:active { transform: translateY(1px); }
.hbt-fab[aria-expanded="true"] { background: var(--accent); color: var(--accent-ink); }
.hbt-fab:focus-visible, .hbt-panel button:focus-visible, .hbt-panel input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 760px) { .hbt-fab { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); } }
.hbt-panel { position: fixed; z-index: 1000; right: 16px; bottom: calc(68px + env(safe-area-inset-bottom, 0px));
  width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 100px); overflow: auto; overscroll-behavior: contain;
  display: grid; gap: 2px; border-radius: var(--radius, 16px); background: var(--panel); color: var(--ink);
  font: 400 14px/1.45 var(--text); box-shadow: var(--float-shadow); }
@media (max-width: 760px) { .hbt-panel { bottom: calc(136px + env(safe-area-inset-bottom, 0px)); max-height: calc(100vh - 160px); } }
.hbt-panel[hidden] { display: none; }
.hbt-sec { display: grid; gap: 10px; padding: 14px 16px; background: var(--panel); }
.hbt-sec + .hbt-sec { background: var(--panel-2); }
.hbt-head { display: flex; align-items: center; gap: 10px; }
.hbt-panel h2, .hbt-panel h3, .hbt-panel p { margin: 0; }
.hbt-title { font-family: var(--display); font-weight: 300; font-size: 1.5rem; line-height: 1.1; flex: 1; }
.hbt-close { border: 0; background: transparent; color: var(--muted); border-radius: 999px; width: 32px; height: 32px; display: grid; place-items: center; cursor: pointer; }
.hbt-close:hover { background: var(--panel-2); color: var(--ink); }
.hbt-close svg { width: 18px; height: 18px; }
.hbt-h { font-size: 0.95rem; font-weight: 500; }
.hbt-note { color: var(--muted); font-size: 13px; }
.hbt-warn { color: var(--warning); font-size: 13px; }
.hbt-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.hbt-btn { border: 0; border-radius: 999px; padding: 8px 14px; background: var(--panel-3); color: var(--ink); font: 500 13px/1 var(--text); cursor: pointer; }
.hbt-btn:hover:not(:disabled) { background: #2a333e; }
.hbt-btn:active:not(:disabled) { transform: translateY(1px); }
.hbt-btn:disabled { opacity: 0.4; cursor: default; }
.hbt-primary { background: var(--accent); color: var(--accent-ink); }
.hbt-primary:hover:not(:disabled) { background: var(--accent-hover, #f08837); }
.hbt-danger { color: var(--negative); }
.hbt-confirm { background: var(--negative); color: #1a0606; }
.hbt-num { width: 76px; border: 0; border-radius: 10px; padding: 7px 10px; background: var(--panel-3); color: var(--ink); font: 400 13px var(--text); font-variant-numeric: tabular-nums; }
.hbt-state { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; border-radius: 10px; overflow: hidden; }
.hbt-state > div { background: var(--panel-3); padding: 8px 10px; display: grid; gap: 2px; }
.hbt-state span { color: var(--muted); font-size: 12px; }
.hbt-state b { font-weight: 500; font-variant-numeric: tabular-nums; }
.hbt-ok { color: var(--positive); } .hbt-amber { color: var(--warning); } .hbt-bad { color: var(--negative); }
.hbt-cards { display: grid; gap: 2px; border-radius: 10px; overflow: hidden; }
.hbt-card { display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 12px; background: var(--panel-3); }
.hbt-card code { flex: 1; font: 400 13px ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--ink); }
.hbt-wait { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--panel-3); }
.hbt-wait b { flex: 1; font-weight: 500; }
.hbt-log { margin: 0; height: 180px; overflow: auto; padding: 10px 12px; border-radius: 10px; background: #05070a; color: var(--muted);
  font: 400 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.hbt-log .sent { color: var(--ink); } .hbt-log .good { color: var(--positive); } .hbt-log .warn { color: var(--warning); } .hbt-log .bad { color: var(--negative); }
.hbt-send { display: flex; gap: 8px; }
.hbt-send input { flex: 1; min-width: 0; border: 0; border-radius: 10px; padding: 8px 10px; background: var(--panel-3); color: var(--ink); font: 400 13px ui-monospace, Consolas, monospace; }
@media (prefers-reduced-motion: reduce) { .hbt-fab, .hbt-btn { transition: none; transform: none !important; } }
`;

// ---------- serial link ----------
const supported = "serial" in navigator && window.isSecureContext;

async function connect() {
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD });
    state.port = port;
    const enc = new TextEncoderStream();
    state.writeDone = enc.readable.pipeTo(port.writable).catch(() => {});
    state.writer = enc.writable.getWriter();
    const dec = new TextDecoderStream();
    state.readDone = port.readable.pipeTo(dec.writable).catch(() => {});
    state.reader = dec.readable.getReader();
    Object.assign(state, { connected: true, ready: false, simOff: false, lock: null, alarm: "quiet", cards: [], cardCount: null, cardMode: null });
    log("Connected. The rack restarts when a computer connects; waiting for it to start.", "sent");
    render();
    readLoop();
    // Normally "Ready." arrives within ~3 s. If this board didn't restart, ask anyway.
    setTimeout(() => { if (state.connected && !state.ready) markReady(); }, 6000);
  } catch (err) {
    if (err && err.name === "NotFoundError") return; // the tester closed the port picker
    log("Couldn't connect: " + (err && err.message ? err.message : err), "bad");
    if (state.port) disconnect();
  }
}

async function disconnect() {
  const { reader, writer, port } = state;
  Object.assign(state, { connected: false, ready: false, reader: null, writer: null, port: null, cardMode: null });
  try { if (reader) await reader.cancel(); } catch (e) { /* already gone */ }
  try { await state.readDone; } catch (e) { /* ignore */ }
  try { if (writer) { await writer.close(); await state.writeDone; } } catch (e) { /* ignore */ }
  try { if (port) await port.close(); } catch (e) { /* ignore */ }
  log("Disconnected.", "sent");
  render();
}

async function readLoop() {
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await state.reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (line.trim()) onLine(line);
      }
    }
  } catch (err) {
    if (state.connected) { log("Lost the rack: " + (err && err.message ? err.message : err), "bad"); disconnect(); }
  }
}

async function send(command) {
  if (!state.writer) return;
  const word = command.trim().split(/\s+/)[0];
  if (SIM_ONLY.has(word)) state.lastSimSentAt = Date.now();
  log("> " + command, "sent");
  try { await state.writer.write(command + "\n"); } catch (err) { log("Couldn't send: " + err.message, "bad"); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function markReady() {
  state.ready = true;
  render();
  send("list");
}

// ---------- what the rack says ----------
function onLine(line) {
  let kind = "";
  let m;
  if (/^Ready\./.test(line)) markReady();
  if ((m = line.match(/^(\d+) card\(s\) enrolled:/))) {
    state.cards = []; state.cardCount = +m[1]; state.collecting = +m[1];
  } else if (state.collecting && (m = line.match(/^\s+(\d+): ([0-9a-f]+)/i))) {
    state.cards.push({ n: +m[1], ref: m[2] }); state.collecting--;
  } else if ((m = line.match(/^cards enrolled: (\d+)/))) {
    state.cardCount = +m[1];
  }
  if ((m = line.match(/\[lock\] (?:servo -> |SIMULATED )(UNLOCKED|LOCKED|unlock|lock)\b/))) {
    state.lock = /^un/i.test(m[1]) ? "unlocked" : "locked";
    if (state.lock === "locked") state.lastLockedAt = Date.now();
  }
  if (/TAMPER_ALARM/.test(line)) { state.alarm = "alarm"; clearTimeout(warningTimer); kind = "bad"; }
  else if (/TAMPER_WARNING/.test(line)) {
    if (state.alarm !== "alarm") state.alarm = "warning";
    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => { if (state.alarm === "warning") { state.alarm = "quiet"; render(); } }, 4000);
    kind = "warn";
  } else if (/siren off|alarm silenced|ACCESS_GRANTED/.test(line)) { state.alarm = "quiet"; }
  if (/ACCESS_GRANTED|ENROLLED|REMOVED|^ok:/.test(line)) kind = kind || "good";
  if (/ACCESS_DENIED|SENSOR_FAULT|NOT added|FAULT|not answering/i.test(line)) kind = kind || "warn";

  if ((m = line.match(/^ok: tap the card to (ADD|REMOVE) within (\d+) s/))) {
    state.cardMode = { kind: m[1] === "ADD" ? "add" : "remove", until: Date.now() + +m[2] * 1000 };
    startCountdown();
  } else if (/\[cards\] .*(ENROLLED|already enrolled|NOT added|REMOVED|wasn't enrolled)|no card tapped in time|^ok: back to normal/.test(line)) {
    state.cardMode = null;
    if (/ENROLLED|REMOVED/.test(line)) setTimeout(() => send("list"), 300);
  }
  if (/^ok: removed card|^ok: all cards removed/.test(line)) setTimeout(() => send("list"), 300);
  if (/^commands:/.test(line) && Date.now() - state.lastSimSentAt < 2000) state.simOff = true;

  log(line, kind);
  render();
}

// ---------- actions ----------
let countdownTimer = 0;
function startCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (!state.cardMode || Date.now() > state.cardMode.until + 1500) { state.cardMode = null; clearInterval(countdownTimer); }
    renderCards();
  }, 250);
}

async function fullAlarm() {
  const wait = TAMPER_GRACE_MS - (Date.now() - state.lastLockedAt);
  if (state.lastLockedAt && wait > 0) {
    state.busy = `Waiting ${Math.ceil(wait / 1000)} s: the rack ignores shaking just after it locks`;
    render();
    await sleep(wait + 300);
  }
  state.busy = "First shake: warning";
  render();
  await send("shake");
  await sleep(3500); // past the firmware's 3 s cooldown, so the second shake counts
  state.busy = "Second shake: full alarm";
  render();
  await send("shake");
  await sleep(1200);
  state.busy = "";
  render();
}

// A button that needs a second click within 4 s (no browser confirm()).
function confirmButton(label, confirmLabel, action, extraClass = "") {
  const b = h("button", { type: "button", class: "hbt-btn " + extraClass }, label);
  let armed = 0;
  b.addEventListener("click", () => {
    if (armed) { clearTimeout(armed); armed = 0; b.textContent = label; b.classList.remove("hbt-confirm"); action(); return; }
    b.textContent = confirmLabel; b.classList.add("hbt-confirm");
    armed = setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove("hbt-confirm"); }, 4000);
  });
  return b;
}

// ---------- DOM ----------
let fab, panel, logEl, connRow, stateEl, cardsEl, busyEl, simEl;
const live = []; // buttons that need a connected rack

function btn(label, onClick, cls = "", sim = false) {
  const b = h("button", { type: "button", class: "hbt-btn " + cls, onClick }, label);
  live.push({ el: b, sim });
  return b;
}

function numberField(value, min, max, label) {
  return h("input", { type: "number", class: "hbt-num", value: String(value), min: String(min), max: String(max), "aria-label": label });
}

function build() {
  document.head.append(h("style", {}, css));

  fab = h("button", { type: "button", class: "hbt-fab", "aria-expanded": "false", "aria-controls": "hbt-panel", onClick: () => toggle() },
    icon("test"), "Testing");

  logEl = h("pre", { class: "hbt-log", "aria-live": "off" });
  connRow = h("div", { class: "hbt-row" });
  stateEl = h("div", { class: "hbt-state" });
  cardsEl = h("div", { class: "hbt-sec" });
  busyEl = h("p", { class: "hbt-note", hidden: true });
  simEl = h("p", { class: "hbt-warn", hidden: true },
    "Test commands are off on this rack. Set HBR_ENABLE_SERIAL_SIM 1 in config.h and re-flash.");

  const servoDeg = numberField(65, 0, 180, "Servo angle in degrees");
  const toneHz = numberField(2700, 31, 20000, "Tone pitch in hertz");
  const cmd = h("input", { type: "text", placeholder: "Any serial command, like status", "aria-label": "Serial command", autocomplete: "off", spellcheck: "false" });
  const sendCmd = () => { const v = cmd.value.trim(); if (v) { send(v); cmd.value = ""; } };
  cmd.addEventListener("keydown", (e) => { if (e.key === "Enter") sendCmd(); });

  panel = h("section", { id: "hbt-panel", class: "hbt-panel", role: "dialog", "aria-modal": "false", "aria-label": "Testing", hidden: true },
    h("div", { class: "hbt-sec" },
      h("div", { class: "hbt-head" },
        h("h2", { class: "hbt-title" }, "Testing"),
        h("button", { type: "button", class: "hbt-close", "aria-label": "Close Testing", onClick: () => toggle(false) }, icon("close"))),
      supported
        ? h("p", { class: "hbt-note" }, "Plug the rack into this computer by USB, then connect. Only one program can use the port, so close the serial monitor first.")
        : h("p", { class: "hbt-warn" }, "Connecting to the rack needs Chrome or Edge, on localhost or https."),
      connRow, stateEl, simEl, busyEl),
    cardsEl,
    h("div", { class: "hbt-sec" },
      h("h3", { class: "hbt-h" }, "Lock"),
      h("div", { class: "hbt-row" },
        btn("Unlock 5 s", () => send("unlock"), "", true),
        btn("Lock Now", () => send("lock"), "", true)),
      h("div", { class: "hbt-row" },
        servoDeg,
        btn("Move Servo", () => send("servo " + Math.round(+servoDeg.value || 0)), "", true),
        h("span", { class: "hbt-note" }, "Angles as in config.h"))),
    h("div", { class: "hbt-sec" },
      h("h3", { class: "hbt-h" }, "Alarm"),
      h("div", { class: "hbt-row" },
        btn("Warning", () => send("shake"), "", true),
        btn("Full Alarm", () => fullAlarm(), "", true),
        btn("Silence", () => send("silence"), "", true)),
      h("p", { class: "hbt-note" }, "Uses the real tamper rule with simulated shakes. One shake warns, a second one within 30 s sets off the siren.")),
    h("div", { class: "hbt-sec" },
      h("h3", { class: "hbt-h" }, "Sound and Lights"),
      h("div", { class: "hbt-row" },
        btn("Denied", () => send("tap deadbeef"), "", true),
        toneHz,
        btn("Play Tone", () => send("buzz " + Math.round(+toneHz.value || 2700)), "", true))),
    h("div", { class: "hbt-sec" },
      h("h3", { class: "hbt-h" }, "Rack"),
      h("div", { class: "hbt-row" },
        btn("Status", () => send("status")),
        btn("Sensor Scan", () => send("i2c-scan")),
        btn("Accelerometer", () => send("accel")),
        liveConfirm("Restart Rack", "Confirm Restart", () => { state.ready = false; render(); send("reboot"); }))),
    h("div", { class: "hbt-sec" },
      h("h3", { class: "hbt-h" }, "Rack Log"),
      logEl,
      h("div", { class: "hbt-send" }, cmd, btn("Send", sendCmd))));

  document.body.append(panel, fab);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { toggle(false); fab.focus(); } });
  if (supported) {
    navigator.serial.addEventListener("disconnect", (e) => { if (state.port && e.target === state.port) { log("The rack was unplugged.", "bad"); disconnect(); } });
  }
  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) { /* private mode */ }
  toggle(open);
  render();
}

function liveConfirm(label, confirmLabel, action) {
  const b = confirmButton(label, confirmLabel, action, "hbt-danger");
  live.push({ el: b, sim: false });
  return b;
}

function toggle(force) {
  const open = force === undefined ? panel.hidden : force;
  panel.hidden = !open;
  fab.setAttribute("aria-expanded", String(open));
  try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (e) { /* private mode */ }
}

function render() {
  if (!panel) return;
  const on = state.connected && state.ready;
  connRow.replaceChildren(
    state.connected
      ? h("button", { type: "button", class: "hbt-btn", onClick: disconnect }, "Disconnect")
      : h("button", { type: "button", class: "hbt-btn hbt-primary", disabled: !supported, onClick: connect }, "Connect Rack"),
    h("span", { class: "hbt-note" }, !state.connected ? "Not connected" : state.ready ? "Connected" : "Starting up"));

  const lockText = state.lock ? (state.lock === "locked" ? "Locked" : "Unlocked") : "Unknown";
  const alarmText = { quiet: "Quiet", warning: "Warning", alarm: "Siren On" }[state.alarm];
  stateEl.hidden = !state.connected;
  stateEl.replaceChildren(
    h("div", {}, h("span", {}, "Lock"), h("b", { class: state.lock === "unlocked" ? "hbt-ok" : "" }, lockText)),
    h("div", {}, h("span", {}, "Alarm"), h("b", { class: state.alarm === "alarm" ? "hbt-bad" : state.alarm === "warning" ? "hbt-amber" : "" }, alarmText)),
    h("div", {}, h("span", {}, "Cards"), h("b", {}, state.cardCount == null ? "–" : String(state.cardCount))));
  simEl.hidden = !state.simOff;
  busyEl.hidden = !state.busy;
  busyEl.textContent = state.busy;
  for (const { el, sim } of live) el.disabled = !on || (sim && state.simOff) || Boolean(state.busy && sim);
  renderCards();
}

function renderCards() {
  if (!cardsEl) return;
  const on = state.connected && state.ready;
  const mode = state.cardMode;
  const kids = [h("h3", { class: "hbt-h" }, "Cards")];
  if (mode) {
    const left = Math.max(0, Math.ceil((mode.until - Date.now()) / 1000));
    kids.push(h("div", { class: "hbt-wait", role: "status" },
      h("b", {}, mode.kind === "add" ? `Tap the card to add · ${left} s` : `Tap the card to remove · ${left} s`),
      h("button", { type: "button", class: "hbt-btn", disabled: state.simOff, onClick: () => send("cancel") }, "Cancel")));
  } else {
    kids.push(h("div", { class: "hbt-row" },
      h("button", { type: "button", class: on ? "hbt-btn hbt-primary" : "hbt-btn", disabled: !on, onClick: () => send("enroll") }, "Add Card"),
      h("button", { type: "button", class: "hbt-btn", disabled: !on, onClick: () => send("unenroll") }, "Remove by Tap"),
      h("button", { type: "button", class: "hbt-btn", disabled: !on, onClick: () => send("list") }, "Refresh")));
  }
  if (!on) {
    kids.push(h("p", { class: "hbt-note" }, "Connect the rack to see its cards. The shield's ADD and REMOVE buttons do the same as the first two buttons here."));
  } else if (!state.cards.length) {
    kids.push(h("p", { class: "hbt-note" }, state.cardCount === 0 ? "No cards yet. Every tap is denied until one is added." : "Loading the list"));
  } else {
    kids.push(h("div", { class: "hbt-cards" }, state.cards.map((c) =>
      h("div", { class: "hbt-card" },
        h("code", {}, c.ref + "…"),
        confirmButton("Remove", "Confirm", () => send("remove " + c.n), "hbt-danger")))));
    kids.push(h("div", { class: "hbt-row" }, confirmButton("Remove All", "Confirm Remove All", () => send("wipe-cards yes"), "hbt-danger")));
    kids.push(h("p", { class: "hbt-note" }, "Cards are stored as a coded reference, not the card number, so the list shows the reference."));
  }
  // Only rebuild when something visible changed, so a half-clicked Confirm survives the countdown ticks.
  const sig = JSON.stringify([on, mode && mode.kind, mode && Math.ceil((mode.until - Date.now()) / 1000), state.cards, state.cardCount, state.simOff]);
  if (cardsEl.dataset.sig === sig) return;
  cardsEl.dataset.sig = sig;
  cardsEl.replaceChildren(...kids);
}

function log(text, kind = "") {
  if (!logEl) return;
  const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  logEl.append(h("span", { class: kind }, text + "\n"));
  while (logEl.childNodes.length > LOG_MAX) logEl.firstChild.remove();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

// The panel must never break the page it sits on.
try {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
} catch (err) {
  console.error("Testing panel failed to start", err);
}
