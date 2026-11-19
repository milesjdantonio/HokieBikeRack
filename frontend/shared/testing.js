// Testing panel: a button in the bottom-right corner of every version that opens a panel for
// testers. It talks straight to the rack (the Arduino Uno) over USB with Web Serial, so it works
// with the offline rack: add and remove cards, unlock, set off the alarm, play sounds, move the
// servo, and read the rack's own log. Chrome or Edge only (Web Serial), on localhost or https.
//
// Everything here is a serial command the firmware already has (docs/notes/firmware.md, "Serial
// console"). The test-only ones need HBR_ENABLE_SERIAL_SIM 1 in config.h.
import { h } from "../js/dom.js";
import { icon } from "./icons.js";
import { link } from "./rack-link.js";

const SIM_ONLY = new Set(["tap", "shake", "buzz", "servo", "lock", "unlock", "silence", "cancel"]);
const TAMPER_GRACE_MS = 10000; // firmware ignores shakes this long after the lock closes
const LOG_MAX = 400;

const state = {
  connected: false, ready: false,  // mirrors link.connected / link.ready
  lock: null,          // "locked" | "unlocked"
  alarm: "quiet",      // "quiet" | "warning" | "alarm"
  cards: [], cardCount: null, collecting: 0,
  cardMode: null,      // { kind: "add" | "remove", until: ms }
  lastLockedAt: 0, lastSimSentAt: 0, simOff: false,
  busy: "",            // short text while a sequence runs
};
let warningTimer = 0;


// ---------- the USB link (shared with the dashboard's rack connection: shared/rack-link.js) ----------
const supported = link.supported;

async function connect() {
  try {
    if (await link.connect()) log("Connected. The rack restarts when a computer connects; waiting for it to start.", "sent");
  } catch (err) {
    log("Couldn't connect: " + (err && err.message ? err.message : err), "bad");
  }
}

function disconnect() { link.disconnect(); }

async function send(command) {
  if (!link.connected) return;
  if (SIM_ONLY.has(command.trim().split(/\s+/)[0])) state.lastSimSentAt = Date.now();
  if (!(await link.send(command))) log("Couldn't send " + command, "bad");
}

link.onChange(() => {
  const was = { connected: state.connected, ready: state.ready };
  state.connected = link.connected;
  state.ready = link.ready;
  if (state.connected && !was.connected) Object.assign(state, { simOff: false, lock: null, alarm: "quiet", cards: [], cardCount: null, cardMode: null });
  if (!state.connected && was.connected) { state.cardMode = null; log("Disconnected.", "sent"); }
  if (state.ready && !was.ready) send("list");
  render();
});
link.onLine((line, info) => (info.sent ? log(line, "sent") : onLine(line)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- what the rack says ----------
function onLine(line) {
  let kind = "";
  let m;
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
  // Same-origin stylesheet next to this file (an inline <style> would be blocked by the CSP).
  document.head.append(h("link", { rel: "stylesheet", href: new URL("./testing.css", import.meta.url).href }));

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
        btn("Unlock", () => send("unlock"), "", true),
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
  // Always start closed: the USB link drops on every page change anyway, and a panel that reopens
  // by itself covers the version you just switched to.
  toggle(false);
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
    kids.push(h("p", { class: "hbt-note" }, "Connect the rack to see its cards."));
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
