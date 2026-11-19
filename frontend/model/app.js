// Rack Model page (docs/notes/firmware-model.md). Runs the compiled Arduino Uno firmware, feeds
// it the world (cards, post motion, wires) and shows what it does: the 3D rack, the timeline, a
// live readout, the serial console and the card list in EEPROM. Every behaviour you see comes
// from the C++. The Uno has no Wi-Fi, so nothing here pretends to be a server.
import { Buzzer } from "./buzzer.js";
import { Physics, ServoArm, POST } from "./physics.js";
import { FirmwareRunner, RESET } from "./runner.js";
import { Timeline } from "./timeline.js";

const $ = (s) => document.querySelector(s);
/** Escapes text for use inside HTML. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** "1.5 s" (whole seconds from 10 s up). */
const secs = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
// Arduino pin numbers as printed on the board: 0..13 = D0..D13, 14..19 = A0..A5.
const pinLabel = (n) => (n >= 14 ? `A${n - 14}` : `D${n}`);

// Cards the model knows. The kit card starts enrolled, like after the bench test.
const CARDS = [
  { id: "hokiep", name: "Your HokieP", uid: "04a224b27c5e80" },
  { id: "kit", name: "Kit Card", uid: "a1b2c3d4" },
  { id: "unknown", name: "Unknown Card", uid: "5e77a9c1" },
];
const TAP_MS = 400;  // how long a quick tap keeps the card in the reader's field

const PART_INFO = {
  post: { what: "Galvanised square post, cast into concrete with the lock module on top. Drag it to shake it.", files: [] },
  shackle: { what: "The bar riders push through the rear wheel. Each leg has a ramped tip and a groove behind it. Push it in at any time and the latch snaps into the grooves.", files: [] },
  reader: { what: "Where riders tap. The PN532's antenna sits right under this window. Click it to tap the card you picked.", files: ["src/card_reader.cpp"] },
  tubing: { what: "Light tubing wrapped around the top of the post. The green LED shines into one end and the red LED into the other, so riders see the colour from every side.", pins: ["green", "red"], files: ["src/feedback.cpp"] },
  lights: { what: "Green and red 5 mm LEDs, each through a 330 ohm resistor. They also light the tubing around the post.", pins: ["green", "red"], files: ["src/feedback.cpp", "lib/hbr_logic/src/feedback_player.cpp"] },
  vents: { what: "Slots so the buzzer inside can be heard.", files: [] },
  board: { what: "", pins: [], files: ["src/main.cpp", "src/card_store.cpp"] },
  pn532: { what: "PN532 NFC reader in I2C mode at address 0x24, powered from the Uno's 5 V pin. IRQ and reset may be left unwired.", pins: ["sda", "scl", "pnIrq", "pnReset"], files: ["src/card_reader.cpp"] },
  mpu: { what: "MPU-6050 accelerometer on a GY-521 board at I2C address 0x68, powered from 5 V, glued inside the post on its side, so gravity reads on its y axis.", pins: ["sda", "scl"], files: ["src/tamper_sensor.cpp", "lib/hbr_logic/src/tamper_detector.cpp"] },
  servo: { what: "", pins: ["servo"], files: ["src/lock.cpp", "lib/hbr_logic/src/lock_controller.h"] },
  latch: { what: "Spring latch. A spring holds the plate in the shackle's grooves. The servo pulls it aside through a slotted link, so it can open the latch but never holds it shut. A shackle pushed in later shoves the plate aside on its ramp and the plate snaps back: locked without a card or power.", pins: ["servo"], files: ["src/lock.cpp"] },
  buzzer: { what: "", pins: ["buzzer"], files: ["src/feedback.cpp", "lib/hbr_logic/src/feedback_player.cpp"] },
  parts: { what: "The LED resistors, the 1 kohm base resistor and the NPN transistor for the buzzer.", pins: ["green", "red", "buzzer"], files: [] },
  cap: { what: "", files: [] },
  supply: { what: "Separate 5 V supply for the servo. Only its ground is joined to the Uno's. The Uno's own 5 V pin can't feed the servo's start-up current.", files: [] },
  usb: { what: "USB from the laptop: powers the Uno and carries the serial console. With no Wi-Fi, it's the only way to enrol cards or read the event log.", files: ["src/main.cpp"] },
};
const PIN_NAMES = { sda: "I2C SDA", scl: "I2C SCL", servo: "Servo signal", green: "Green LED", red: "Red LED", buzzer: "Buzzer transistor",
  pnIrq: "PN532 IRQ (optional)", pnReset: "PN532 reset (optional)" };
const PATTERN_NAMES = { None: "Idle", Boot: "Boot flash", Granted: "Granted", Denied: "Denied", TamperWarning: "Tamper warning", TamperAlarm: "Siren" };
const DENY_TEXT = {
  NOT_LISTED: "it isn't enrolled. Press Enroll Next Tap on the Cards tab, then tap it again.",
  NO_CARD_KEY: "HBR_CARD_KEY isn't set, so every card is denied.",
};

// ---------------------------------------------------------------- set up
const manifest = await fetch("firmware.json").then((r) => r.json()).catch(() => null);
let runner;
const physics = new Physics();
let arm = null;
let values = {};
const timeline = new Timeline($("#timeline"));
const buzzer = new Buzzer();
let scene = null;
let sceneLib = null;  // scene.js exports (OPTIONS, makeRack), once loaded
// Build option: A standard (Uno), B 0.75x (Nano), C 0.5x with mini parts. Kept in the address (?option=b).
let option = new URLSearchParams(location.search).get("option") || "a";
if (!["a", "b", "c"].includes(option)) option = "a";
let pickedCard = CARDS[0];
let selected = null;
let speed = 1, paused = false;
let lastState = null;
let tap = null;           // { card, releaseAt, readsBefore, at, acted }
let lastResult = null;
let cardsDirty = true;
const events = [];        // the firmware's [event] lines, newest last
let serialLines = 0, serialPartial = "", eventPartial = "";
let lastReal = performance.now(), lastDom = 0, lastCards = 0;
const busy = { mpu: { n: 0, at: -1e9 }, pn: { n: 0, at: -1e9 } };
// The shackle and spring latch are mechanics: the firmware can't see them (no sensor).
const shackle = { out: 0, target: 0, cam: 0, rattle: 0, note: "" };
const SHACKLE_MS = 450;  // how long pulling it out or pushing it in takes

runner = new FirmwareRunner({
  physics,
  preloadCards: [CARDS.find((c) => c.id === "kit").uid],
  onBoot: (reason) => {
    timeline.reset();
    timeline.setup(runner.config);
    values = Object.fromEntries(runner.config.values.map((v) => [v.id, v.value]));
    if (!arm) arm = new ServoArm(runner.config.assumptions);
    arm.target = null;     // the horn stays where it is until the new boot sends a pulse
    arm.lastMs = 0;
    appendSerial(`\n— ${reason === RESET.WATCHDOG ? "watchdog reset" : "power on"} —\n`, "me");
    cardsDirty = true;
    renderValues();
    // The tilt whose gravity shift equals the firmware's threshold: 2·asin(threshold / 2).
    const jolt = Math.ceil(2 * Math.asin(Math.min(1, values.thresholdG / 2)) * 180 / Math.PI);
    $("#lean-note").textContent = `Lean it slowly and the baseline follows, like a post settling. Flick it past ${jolt}° and it counts as a jolt.`;
  },
});

try {
  await runner.boot(RESET.POWER_ON);
} catch (e) {
  fatal("The firmware didn't load. Build it with: node tools/model/build.mjs", e);
}
for (const c of CARDS) c.ref = runner.cardRef(c.uid);

$("#bar-note").textContent = `Firmware ${runner.config.firmwareVersion} for the ${runner.config.board}, compiled from firmware/src and lib/hbr_logic, running in your browser on an emulated Uno. Nothing here touches the real rack.`;

try {
  const mod = await import("./scene.js");
  sceneLib = mod;
  scene = new mod.RackScene($("#scene"), $("#labels"), { onPick: pickFromScene, onDrag: (t) => physics.setDrag(t), option });
  scene.wire(runner.config.pins);
  new ResizeObserver(() => scene.resize()).observe($("#scene"));
  scene.resize();
} catch (e) {
  console.error(e);
  const m = $("#stage-message");
  m.hidden = false;
  m.textContent = "This browser couldn't start 3D graphics. Everything else on the page still runs the firmware.";
}

wireControls();
setOption(option);
requestAnimationFrame(frame);

// ---------------------------------------------------------------- main loop
function frame(nowReal) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, nowReal - lastReal);  // a slow frame still moves the model, up to a point
  lastReal = nowReal;
  const modelDt = paused ? 0 : dt * speed;
  try {
    if (modelDt > 0) step(modelDt);
    const s = runner.state();
    lastState = s;
    const now = s.ms;
    if (scene) scene.update(sceneFrame(s, now));
    if (scene) scene.render(dt / 1000);
    timeline.draw(now);
    if (nowReal - lastDom > 120) {
      lastDom = nowReal;
      renderLive(s);
      renderCardReadout(s);
      syncShackleButton();
      if (selected) renderPartCard(selected, s);
    }
    if (cardsDirty || nowReal - lastCards > 500) {
      cardsDirty = false;
      lastCards = nowReal;
      renderCards(s);
    }
  } catch (e) {
    console.error(e);  // one bad frame must never stop the model
  }
}

/** Runs the firmware for `ms` of its time, lifting a tapped card off at the right moment. */
function step(ms) {
  const frameStart = runner.nowMs;
  if (tap && !tap.hold && !tap.released && runner.nowMs + ms >= tap.releaseAt) {
    // Run up to the moment the card leaves the field, then take it away.
    process(runner.run(Math.max(0, tap.releaseAt - runner.nowMs)), frameStart);
    if (runner.restartRequested) { reboot(runner.resetReason); return; }
    runner.card(null);
    tap.released = true;
    ms = Math.max(0, frameStart + ms - runner.nowMs);
  }
  if (ms > 0) process(runner.run(ms), frameStart);
  moveShackle(runner.nowMs - frameStart);
  if (runner.restartRequested) reboot(runner.resetReason);
}

/** Turns the firmware's output log for one frame into the servo, buzzer, timeline and readout. */
function process(log, frameStart) {
  // the servo horn follows each pulse change at its own speed
  let t = arm.lastMs ?? frameStart;
  for (const [ms, us] of log.servo) {
    arm.advance(Math.max(0, ms - t));
    arm.pulse(us);
    t = ms;
  }
  arm.advance(Math.max(0, runner.nowMs - t));
  arm.lastMs = runner.nowMs;
  timeline.add(log, runner.nowMs, arm.angle);
  buzzer.play(log.edges, runner.config.pins.buzzer, frameStart, speed);
  if (log.serial) {
    appendSerial(log.serial);
    readFirmwareLines(log.serial);
  }
}

// What the firmware printed about cards and events. This is how the Uno reports: there is no
// network, so the serial log is the event log.
function readFirmwareLines(text) {
  const lines = (eventPartial + text).split("\n");
  eventPartial = lines.pop();
  const cardFor = (prefix) => CARDS.find((c) => c.ref.startsWith(prefix));
  for (const line of lines) {
    const ev = line.match(/^\[event\] t\+(\d+)s (\w+) \((\w+)\)\s*(.*)$/);
    if (ev) {
      events.push({ at: Number(ev[1]), type: ev[2], severity: ev[3], details: ev[4] });
      if (events.length > 200) events.shift();
      cardsDirty = true;
      if (ev[2] === "ACCESS_GRANTED" || ev[2] === "ACCESS_DENIED") {
        const prefix = ev[4].match(/card=([0-9a-f]{12})/)?.[1];
        lastResult = { kind: "access", card: prefix ? cardFor(prefix) : null, allowed: ev[2] === "ACCESS_GRANTED",
          reason: ev[4].match(/reason=(\w+)/)?.[1] };
        if (tap) tap.acted = (tap.acted || 0) + 1;
      }
      continue;
    }
    const cm = line.match(/^\[cards\] ([0-9a-f]{12})\.\.\. (ENROLLED|was already enrolled|NOT added|wasn't enrolled|REMOVED)/);
    if (cm) {
      const kind = { ENROLLED: "enrolled", "was already enrolled": "already", "NOT added": "full", "wasn't enrolled": "notEnrolled", REMOVED: "removed" }[cm[2]];
      lastResult = { kind, card: cardFor(cm[1]) };
      if (tap) tap.acted = (tap.acted || 0) + 1;
      cardsDirty = true;
    }
  }
}

/** Restarts the firmware (reset button, watchdog, or a `reboot` command). */
async function reboot(reason) {
  paused = true;
  buzzer.silence();
  if (tap && !tap.hold) { runner.card(null); tap = null; }
  try {
    await runner.boot(reason);
  } finally {
    paused = $("#pause").dataset.paused === "1";
  }
}

/** Updates the 3D rack for this frame: LEDs, wires, servo, I2C activity. */
function sceneFrame(s, now) {
  for (const [key, count] of [["mpu", s.i2c.mpu], ["pn", s.i2c.pn532]]) {
    if (count !== busy[key].n) { busy[key].n = count; busy[key].at = now; }
  }
  return {
    green: s.feedback.green, red: s.feedback.red, buzzer: s.feedback.buzzer,
    sway: { x: physics.x, z: physics.z }, lean: physics.lean,
    servoAngle: arm.angle, latchOpen: Math.max(servoLatchOpen(), shackle.cam), shackleOut: shackle.out + shackle.rattle,
    unlocked: s.lock.unlocked, servoAttached: s.lock.servoAttached, servoPowered: arm.powered,
    mpuBusy: now - busy.mpu.at < 250 && s.accel.linked, pnBusy: now - busy.pn.at < 250 && s.reader.linked,
    mpuLinked: s.accel.linked, pnLinked: s.reader.linked, cardNear: s.reader.cardPresent,
  };
}

// ---------------------------------------------------------------- inputs
function wireControls() {
  const pick = $("#card-pick");
  for (const c of CARDS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.textContent = c.name;
    b.dataset.card = c.id;
    b.addEventListener("click", () => { pickedCard = c; syncCardPick(); });
    pick.append(b);
  }
  syncCardPick();
  $("#tap").addEventListener("click", tapCard);
  $("#hold").addEventListener("change", () => {
    if (!$("#hold").checked && tap?.hold) { runner.card(null); tap = null; }
    syncTapButton();
  });
  $("#knock").addEventListener("click", () => physics.knock(runner.worldMs + 1));
  $("#shackle").addEventListener("click", useShackle);
  for (const b of document.querySelectorAll("#option button")) b.addEventListener("click", () => setOption(b.dataset.option));
  $("#shake").addEventListener("click", () => physics.shake(runner.worldMs + 1, 2000));
  $("#lean").addEventListener("input", (e) => {
    physics.setLean(Number(e.target.value));
    $("#lean-out").textContent = e.target.value + "°";
  });
  $("#link-pn").addEventListener("change", (e) => runner.link(0, e.target.checked));
  $("#link-mpu").addEventListener("change", (e) => runner.link(1, e.target.checked));
  $("#servo-power").addEventListener("change", (e) => { arm.powered = e.target.checked; });

  for (const b of document.querySelectorAll("#speed button")) {
    b.addEventListener("click", () => {
      speed = Number(b.dataset.speed);
      for (const o of document.querySelectorAll("#speed button")) o.setAttribute("aria-checked", String(o === b));
    });
  }
  $("#pause").addEventListener("click", () => {
    const p = $("#pause").dataset.paused !== "1";
    $("#pause").dataset.paused = p ? "1" : "0";
    $("#pause").textContent = p ? "Resume" : "Pause";
    paused = p;
    if (p) buzzer.silence();
  });
  $("#power").addEventListener("click", () => reboot(RESET.POWER_ON));
  $("#sound").addEventListener("change", (e) => buzzer.enable(e.target.checked));

  for (const b of document.querySelectorAll("#view button")) {
    b.addEventListener("click", () => setView(b.dataset.view === "inside"));
  }
  for (const b of document.querySelectorAll("#camera button")) b.addEventListener("click", () => scene?.focus(b.dataset.cam));

  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll(".tabs button")) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        $("#" + t.getAttribute("aria-controls")).hidden = !on;
      }
      if (tab.id === "t-serial") scrollSerial(true);
      if (tab.id === "t-cards") cardsDirty = true;
    });
  }

  $("#serial-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#serial-in").value.trim();
    if (!text) return;
    sendSerial(text);
    $("#serial-in").value = "";
  });
  for (const cmd of ["status", "list", "enroll", "i2c-scan", "accel", "reboot"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = cmd;
    b.addEventListener("click", () => sendSerial(cmd));
    $("#serial-chips").append(b);
  }
  $("#serial-note").innerHTML = `The same console as <code>pio device monitor</code> at ${runner.config.seen.baud} baud. Every line comes from the firmware's Serial.print, and it's the rack's only event log.`;
}

/** Switches between the rack design options (a, b, c), remembered in the address. */
function setOption(key) {
  option = key;
  for (const b of document.querySelectorAll("#option button")) b.setAttribute("aria-checked", String(b.dataset.option === key));
  if (scene && scene.opt.key !== key) scene.setOption(key);
  const url = new URL(location.href);
  if (key === "a") url.searchParams.delete("option"); else url.searchParams.set("option", key);
  history.replaceState(null, "", url);
  if (sceneLib) {
    const o = sceneLib.OPTIONS[key], R = sceneLib.makeRack(o);
    const mm = (m) => Math.round(m * 1000);
    $("#option-note").textContent = `${mm(R.headTop)} mm tall, ${mm(R.width)} mm wide, ${mm(R.postW)} mm posts, ${mm(o.head.w)} mm head. ${o.note}`;
  }
  if (selected) renderPartCard(selected, lastState);
  renderBuildOptions();
}

/** Marks which card is picked. */
function syncCardPick() {
  for (const b of document.querySelectorAll("#card-pick button")) b.setAttribute("aria-checked", String(b.dataset.card === pickedCard.id));
}

/** Tap Card, or Take Card Away while one is held on the reader. */
function syncTapButton() {
  $("#tap").textContent = tap?.hold ? "Take Card Away" : "Tap Card";
}

/** Tap Card: puts the picked card on the reader briefly (or takes away a held one). */
function tapCard() {
  if (tap?.hold) {
    runner.card(null);
    tap = null;
    syncTapButton();
    return;
  }
  const hold = $("#hold").checked;
  const s = runner.state();
  tap = { card: pickedCard, hold, releaseAt: runner.nowMs + TAP_MS, readsBefore: s.reader.reads, at: runner.nowMs, acted: 0 };
  lastResult = null;
  runner.card(pickedCard.uid);
  syncTapButton();
}

/** Types a line into the firmware's serial input, and shows it in the console. */
function sendSerial(text) {
  appendSerial("> " + text + "\n", "me");
  runner.serial(text + "\n");
  cardsDirty = true;
}

/** Outside view, or inside the lock module (the wiring). */
function setView(inside) {
  for (const o of document.querySelectorAll("#view button")) o.setAttribute("aria-checked", String((o.dataset.view === "inside") === inside));
  scene?.setView(inside);
}

/** A part was clicked in the 3D view or the parts list: tap, select, or describe it. */
function pickFromScene(id, fromCanvas) {
  if (fromCanvas && id === "reader") { tapCard(); return; }
  if (fromCanvas && id === "post") { selectPart("post"); return; }
  selectPart(id);
  const internal = ["board", "pn532", "mpu", "servo", "latch", "buzzer", "parts", "cap", "supply", "usb"].includes(id);
  if (internal && !scene.inside) setView(true);
  scene?.focusPart(id);
}

// ---------------------------------------------------------------- shackle and spring latch
// How far the servo has pulled the latch open, 0..1, from where the horn really is.
function servoLatchOpen() {
  if (arm.angle === null) return 0;
  const lockedDeg = values.HBR_SERVO_LOCKED_DEG, openDeg = values.HBR_SERVO_UNLOCKED_DEG;
  return Math.max(0, Math.min(1, (arm.angle - lockedDeg) / (openDeg - lockedDeg)));
}

/** Push Shackle In / Pull Shackle Out (only comes out while the servo holds the latch open). */
function useShackle() {
  if (shackle.target === 1) {
    // Push it in. Works whether or not the latch is open: the ramps push the latch aside.
    shackle.target = 0;
    const latched = servoLatchOpen() < 0.9;
    shackle.note = latched
      ? "Pushed in. The ramps pushed the latch aside and it snapped into the grooves: locked, with no card and no power."
      : "Pushed in. The latch is still held open; it closes on the grooves when the unlock time is up.";
    physics.knock(runner.worldMs + SHACKLE_MS, 0.03, "z");  // the bump of it seating
  } else if (servoLatchOpen() > 0.9) {
    shackle.target = 1;
    shackle.note = "Pulled out. The servo is holding the latch open.";
  } else {
    // Locked: it moves a few millimetres and stops. Yanking it shakes the post.
    shackle.rattle = 0.03;
    shackle.note = "The latch held. Yanking a locked shackle shakes the post, so the tamper sensor feels it.";
    physics.knock(runner.worldMs + 1, 0.1, "z");
  }
  shackle.noteAt = performance.now();
  syncShackleButton();
}

/** Moves the shackle toward where it's going, `ms` worth of travel. */
function moveShackle(ms) {
  if (ms <= 0) return;
  const step = ms / SHACKLE_MS;
  const before = shackle.out;
  shackle.out += Math.max(-step, Math.min(step, shackle.target - shackle.out));
  // While a leg goes in past the closed latch, its ramp pushes the latch aside, then it snaps back.
  const passing = shackle.target === 0 && before > 0 && shackle.out < 0.25 && servoLatchOpen() < 0.9;
  shackle.cam = passing ? Math.min(1, shackle.cam + step * 6) : Math.max(0, shackle.cam - step * 12);
  shackle.rattle = Math.max(0, shackle.rattle - step * 0.15);
  if (before !== shackle.out) syncShackleButton();
}

/** The shackle button's label, and its note for a few seconds. */
function syncShackleButton() {
  $("#shackle").textContent = shackle.target === 1 ? "Push Shackle In" : "Pull Shackle Out";
  const fresh = shackle.note && performance.now() - shackle.noteAt < 4000;
  $("#shackle-readout").textContent = fresh ? shackle.note : shackleText();
}

/** One sentence on where the shackle is and why. */
function shackleText() {
  if (shackle.out > 0.99) {
    return servoLatchOpen() > 0.9 ? "Out. The servo is holding the latch open."
      : "Out. The latch has closed again. Push the shackle in and it still locks.";
  }
  if (shackle.out > 0.01) return "Moving.";
  return servoLatchOpen() > 0.9 ? "In, latch held open by the servo." : "In and latched.";
}

// ---------------------------------------------------------------- live readout
function notReady(s) {
  if (!s.cards.keySet) return "no card key";
  if (!s.cards.count) return "no cards enrolled";
  if (!s.reader.healthy) return "reader not answering";
  return "";
}

/** The live readout: lock, lights, sensors, cards, uptime, from the firmware's state. */
function renderLive(s) {
  const rows = [];
  const seen = runner.config.seen;
  const cmdDeg = Math.round((s.lock.servoUs - seen.servoMinUs) / (seen.servoMaxUs - seen.servoMinUs) * 180);

  rows.push(["Lock", s.lock.unlocked
    ? `<span class="is-on">Open</span><span class="sub">Re-locks in ${secs(s.lock.leftMs)}</span>`
    : "Locked"]);
  const armText = arm.angle === null ? "" : ` · horn at ${Math.round(arm.angle)}°`;
  const mismatch = arm.angle !== null && Math.abs(arm.angle - cmdDeg) > 8 && !arm.powered;
  rows.push(["Servo", `${s.lock.servoUs} µs = ${cmdDeg}° commanded${armText}` +
    (mismatch ? `<span class="sub is-warn">No 5 V: the horn isn't moving, and the firmware can't tell.</span>` : "")]);
  const on = (v, name, cls) => (v ? `<span class="${cls}">${name}</span>` : `<span class="off">${name}</span>`);
  const pattern = s.feedback.pattern === "None" ? `Idle, ${s.feedback.ready ? "green" : "red"} blip every ${values.kIdleBlipEveryMs / 1000} s` : PATTERN_NAMES[s.feedback.pattern];
  rows.push(["Lights", `${on(s.feedback.green, "Green", "is-on")} · ${on(s.feedback.red, "Red", "is-bad")} · ${on(s.feedback.buzzer, "Buzzer", "is-warn")}<span class="sub">${esc(pattern)}</span>`]);

  const th = values.thresholdG;
  const pct = Math.min(100, s.tamper.deviationG / (th * 2) * 100);
  let tState;
  if (!s.accel.healthy) tState = `<span class="is-bad">Accelerometer not answering</span>`;
  else if (s.tamper.alarm) {
    tState = s.tamper.alarmMs < values.HBR_TAMPER_ALARM_MS
      ? `<span class="is-bad">Alarm. At least ${secs(s.tamper.alarmLeftMs)} more</span>`
      : `<span class="is-bad">Alarm. Stops after ${secs(values.HBR_TAMPER_ALARM_QUIET_MS)} still: ${secs(s.tamper.alarmLeftMs)} to go</span>`;
  }
  else if (s.tamper.warmingUp) tState = "Learning the baseline";
  else if (!s.tamper.armed) {
    const left = s.lock.unlocked ? s.lock.leftMs + values.HBR_TAMPER_GRACE_MS : values.HBR_UNLOCK_DURATION_MS + values.HBR_TAMPER_GRACE_MS - s.lock.sinceUnlockMs;
    tState = `Ignoring jolts for ${secs(Math.max(0, left))}: someone just unlocked`;
  } else if (s.tamper.cooldownLeftMs > 0) tState = `<span class="is-warn">Warning given. Next jolt counts in ${secs(s.tamper.cooldownLeftMs)}</span>`;
  else if (s.tamper.escalateLeftMs > 0) tState = `<span class="is-warn">Another jolt in ${secs(s.tamper.escalateLeftMs)} sounds the alarm</span>`;
  else tState = "Armed";
  rows.push(["Tamper", `${s.tamper.deviationG.toFixed(2)} g of ${th} g · jolt ${s.tamper.over} of ${values.samplesToTrigger}` +
    `<span class="meter"><i></i><b></b></span><span class="sub">${tState}</span>`]);

  const c = s.cards;
  let cardSub;
  if (c.mode !== "check") cardSub = `<span class="sub is-warn">Waiting for a tap to ${c.mode === "enroll" ? "add" : "remove"}: ${secs(Math.max(0, c.modeLeftMs))} left</span>`;
  else {
    const why = notReady(s);
    cardSub = `<span class="sub ${why ? "is-warn" : "is-on"}">${why ? "Not ready: " + why : "Ready for cards"}</span>`;
  }
  rows.push(["Cards", `${c.count} of ${c.capacity} enrolled, in EEPROM${cardSub}`]);
  const w = s.watchdog;
  rows.push(["Watchdog", w.on
    ? `Fed ${w.sinceKickMs} ms ago<span class="sub">Restarts the Uno, locked, after ${secs(w.timeoutMs)} without</span>`
    : `<span class="off">Off</span>`]);

  $("#live").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  // set through the DOM: the site's security policy blocks style="" attributes
  const fill = $("#live .meter i");
  if (fill) fill.style.width = pct.toFixed(1) + "%";
}

/** What the last card tap did (granted, denied and why). */
function renderCardReadout(s) {
  const el = $("#card-readout");
  if (!tap && !lastResult) return;
  if (lastResult) {
    const who = esc(lastResult.card ? lastResult.card.name : "That card");
    let text;
    switch (lastResult.kind) {
      case "enrolled": text = `<b>${who}: enrolled.</b> Saved in EEPROM; tap it again and the lock opens.`; break;
      case "already": text = `<b>${who} was already enrolled.</b> Nothing changed.`; break;
      case "full": text = `<b>${who} wasn't added:</b> all ${s.cards.capacity} slots are used. Remove a card first.`; break;
      case "removed": text = `<b>${who}: removed.</b> It no longer opens the rack.`; break;
      case "notEnrolled": text = `<b>${who} wasn't enrolled,</b> so there was nothing to remove.`; break;
      default:
        text = lastResult.allowed
          ? `<b>${who}: allowed.</b> The lock opens for ${secs(values.HBR_UNLOCK_DURATION_MS)}.`
          : `<b>${who}: denied</b>, ${DENY_TEXT[lastResult.reason] || esc(lastResult.reason || "")}`;
    }
    if (tap?.hold) {
      const reads = s.reader.reads - tap.readsBefore;
      text += ` The reader has read it ${reads} time${reads === 1 ? "" : "s"}; the firmware acted ${tap.acted || 1} time${(tap.acted || 1) === 1 ? "" : "s"}. The same card is ignored until it's been gone ${values.debouncer / 1000} s.`;
    }
    el.innerHTML = text;
  } else if (tap && s.ms - tap.at > 1200) {
    el.innerHTML = !s.reader.healthy ? "<b>Nothing happened:</b> the reader isn't answering, so the firmware can't see the card."
      : "<b>Nothing happened yet.</b> If you tapped the same card a moment ago, it's still being ignored.";
  }
}

// ---------------------------------------------------------------- part card
function selectPart(id) {
  selected = id;
  for (const l of scene?.labels || []) l.el.setAttribute("aria-pressed", String(l.id === id));
  renderPartCard(id, lastState);
}

// Part text that depends on the build option.
const OPTION_INFO = {
  board: {
    uno: "Arduino Uno R3 (ATmega328P, 16 MHz, 2 KB RAM, 32 KB flash, 1 KB EEPROM), standing in the post with its USB plug pointing down. One core and no operating system: loop() takes care of cards, tamper, lock and lights in turn. Allowed cards live in the EEPROM.",
    nano: "Arduino Nano, the same ATmega328P chip as the Uno on an 18 × 45 mm board, standing in the post. The firmware is identical: build it with pio run -e nano. Get one with the new (Optiboot) bootloader, or turn the watchdog off.",
  },
  servo: {
    mg90s: "MG90S micro servo. 50 Hz signal from pin 9 (the Servo library uses Timer1), power from the separate 5 V supply. It has no position feedback.",
    submicro: "Sub-micro servo, 3.7 g class (about 20 × 9 × 17 mm). Same signal and code as the MG90S, but much weaker: use a light spring on the latch. Fine for a model, not for a real rack.",
  },
};

/** What a part is, for the part card. */
function partWhat(id) {
  const o = scene?.opt;
  if (id === "board") return OPTION_INFO.board[o?.board || "uno"];
  if (id === "servo") return OPTION_INFO.servo[o?.servo || "mg90s"];
  if (o && id === "buzzer") return `${o.buzzer.name}: one fixed pitch, on or off. Switched by an NPN transistor, 1 kohm to its base.`;
  if (o && id === "cap") return `${o.cap.name} electrolytic across the servo's 5 V, close to the servo. It covers the current spike when the servo starts moving.`;
  return PART_INFO[id]?.what;
}

/** The card about the selected part: what it is and what it's doing now. */
function renderPartCard(id, s) {
  const card = $("#part-card");
  const info = PART_INFO[id];
  if (!info || !s) { card.hidden = true; return; }
  const pins = runner.config.pins;
  const wired = (info.pins || []).map((p) => `${PIN_NAMES[p]}: ${pinLabel(pins[p])}`).join("<br>");
  const files = info.files.map((f) => `<code>${esc(f)}</code>`).join("<br>");
  card.hidden = false;
  const html = `<h2>${esc(nameOf(id))}</h2><button type="button" class="btn btn-small close" id="close-part">Close</button>
    <p>${esc(partWhat(id))}</p>
    ${wired || files ? `<dl>${wired ? `<dt>Wired to</dt><dd>${wired}</dd>` : ""}${files ? `<dt>Code</dt><dd>${files}</dd>` : ""}</dl>` : ""}
    <p class="now">${partNow(id, s)}</p>`;
  if (card.dataset.html !== html) {
    card.innerHTML = html;
    card.dataset.html = html;
    $("#close-part").addEventListener("click", () => { selected = null; card.hidden = true; selectPart(null); });
  }
}

/** A part's display name. */
function nameOf(id) {
  if (scene) return scene.partName(id);
  return { post: "Post", shackle: "Shackle", reader: "Reader Window", lights: "Lights", vents: "Buzzer Vents", board: "Arduino Uno R3",
    pn532: "PN532 Reader", mpu: "MPU-6050", servo: "MG90S Servo", latch: "Latch", buzzer: "Buzzer", parts: "Resistors and Transistor",
    cap: "Capacitor", tubing: "Light Tubing", supply: "5 V Supply", usb: "USB Cable" }[id] || id;
}

/** What a part is doing right now, from the firmware's state. */
function partNow(id, s) {
  const seen = runner.config.seen;
  switch (id) {
    case "board": return `${s.cards.count} card${s.cards.count === 1 ? "" : "s"} in EEPROM (${s.cards.eepromWrites} bytes written since power-on). Watchdog fed ${s.watchdog.sinceKickMs} ms ago.`;
    case "pn532": return s.reader.healthy
      ? `Answering. The firmware asks "card there?" every ${s.reader.pollGapMs} ms (kPollEveryMs is ${values.kPollEveryMs}). Card IDs read so far: ${s.reader.reads}.`
      : `<span class="is-bad">Not answering.</span> card_reader.cpp retries every ${secs(values.kRetryInitEveryMs)}.`;
    case "mpu": return s.accel.healthy
      ? `Read every ${s.accel.readGapMs} ms. Raw counts x ${s.accel.raw[0]}, y ${s.accel.raw[1]}, z ${s.accel.raw[2]}; the firmware set ±${2 << ((seen.mpuAccelConfig >> 3) & 3)} g, so that's ${s.accel.g.map((v) => v.toFixed(3)).join(", ")} g.`
      : `<span class="is-bad">Not answering.</span> tamper_sensor.cpp retries every 10 s.`;
    case "servo": case "latch": {
      const cmd = Math.round((s.lock.servoUs - seen.servoMinUs) / (seen.servoMaxUs - seen.servoMinUs) * 180);
      const open = arm.angle !== null && Math.abs(arm.angle - values.HBR_SERVO_UNLOCKED_DEG) < 5;
      return `Pulse ${s.lock.servoUs} µs at ${seen.servoHz} Hz on ${pinLabel(seen.servoPin)}, which is ${cmd}°. Horn at ${arm.angle === null ? "?" : Math.round(arm.angle)}°, latch ${open ? "open" : "closed"}.${arm.powered ? "" : ' <span class="is-warn">5 V supply off.</span>'}`;
    }
    case "lights": return `Green ${s.feedback.green ? "on" : "off"}, red ${s.feedback.red ? "on" : "off"}. Pattern: ${PATTERN_NAMES[s.feedback.pattern]}.`;
    case "buzzer": case "vents": return `${pinLabel(runner.config.pins.buzzer)} is ${s.feedback.buzzer ? "high: beeping" : "low: quiet"}.`;
    case "reader": return s.reader.cardPresent ? "A card is on the reader." : `Picked card: ${esc(pickedCard.name)}. Click the window to tap it.`;
    case "post": return `Tamper deviation ${s.tamper.deviationG.toFixed(2)} g. The sensor is ${Math.round((scene?.R.mpuY ?? POST.sensorHeight) * 1000)} mm up the post.`;
    case "shackle": return shackleText();
    case "tubing": return s.feedback.green && s.feedback.red ? "Amber: both LEDs on." : s.feedback.green ? "Green." : s.feedback.red ? "Red." : "Dark.";
    case "supply": case "cap": return arm.powered ? "5 V on." : '<span class="is-warn">Supply off: the servo can\'t move.</span>';
    case "usb": return `Serial at ${seen.baud} baud. ${events.length} event${events.length === 1 ? "" : "s"} printed so far.`;
    default: return "";
  }
}

// ---------------------------------------------------------------- cards tab
function renderCards(s) {
  const el = $("#tab-cards");
  if (el.hidden) return;
  const c = s.cards;
  const name = (ref) => CARDS.find((k) => k.ref === ref)?.name || `Card ${ref.slice(0, 8)}`;
  const list = c.refs.map((ref, i) => `<div class="item"><div class="item-main"><b>${esc(name(ref))}</b><span>Slot ${i} · ${ref.slice(0, 12)}…</span></div><button type="button" class="btn btn-small" data-cmd="remove ${i}">Remove</button></div>`).join("");
  const mode = c.mode === "check" ? ""
    : `<p class="readout is-warn">Waiting for a tap to ${c.mode === "enroll" ? "add" : "remove"}: ${secs(Math.max(0, c.modeLeftMs))} left. Tap a card on the Try It tab or click the reader window.</p>`;
  const evs = events.slice(-14).reverse().map((e) => `<div class="item"><div class="item-main"><b>${esc(e.type)}</b><span>${esc(e.severity)} · ${e.at} s after power-on${e.details ? " · " + esc(e.details) : ""}</span></div></div>`).join("");
  const html = `<h2>Cards in EEPROM</h2>
    <p class="note">The Uno keeps up to ${c.capacity} card references in its 1 KB EEPROM, and they survive Power Cycle. Each button types the same serial command you would type at the rack.</p>
    <div class="row"><button type="button" class="btn btn-primary" data-cmd="enroll">Enroll Next Tap</button><button type="button" class="btn" data-cmd="unenroll">Unenroll Next Tap</button></div>
    ${mode}
    <h3>Cards That Work Here</h3>
    <div class="list">${list || '<p class="empty">None. Press Enroll Next Tap, then tap a card.</p>'}</div>
    <p class="note">${c.count} of ${c.capacity} slots used. ${c.eepromWrites} EEPROM bytes written since power-on; each byte lasts about 100,000 writes, and a tap only reads.</p>
    <div class="row"><button type="button" class="btn btn-small" data-cmd="wipe-cards yes">Remove All Cards</button></div>
    <h3>Event Log</h3>
    <p class="note">Printed to the serial monitor, newest first. The Uno has no network, so a laptop on USB is the only place these go.</p>
    <div class="list">${evs || '<p class="empty">None yet.</p>'}</div>`;
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
  el.querySelectorAll("[data-cmd]").forEach((btn) => btn.addEventListener("click", () => sendSerial(btn.dataset.cmd)));
}

// ---------------------------------------------------------------- values tab
function renderValues() {
  const cfg = runner.config;
  const loc = manifest?.locations || {};
  const groups = {};
  for (const v of cfg.values) (groups[v.group] ||= []).push(v);
  const fmt = (v) => {
    if (v.unit === "ms" && v.value >= 1000) return `${v.value / 1000} s`;
    if (v.unit === "Hz" && v.value >= 1000) return `${v.value / 1000} kHz`;
    const n = Number.isInteger(v.value) ? v.value : +v.value.toFixed(4);
    const unit = { deg: "°", us: " µs", "": "" }[v.unit] ?? " " + v.unit;
    return n + unit;
  };
  let html = `<h2>Values From the Firmware</h2>
    <p class="note">Read from the compiled code when it starts, not typed into this page. Change one in the C++, run <code>node tools/model/build.mjs</code>, and the model follows.</p>`;
  for (const [group, list] of Object.entries(groups)) {
    html += `<h3>${esc(group)}</h3><div class="values">` + list.map((v) => {
      const l = loc[v.id];
      return `<div class="value"><b><code>${esc(v.id)}</code></b><span class="v">${esc(fmt(v))}</span><span class="what">${esc(v.what)}</span>` +
        (l ? `<span class="src">${esc(l.file)}:${l.line}<code>${esc(l.code)}</code></span>` : "") + "</div>";
    }).join("") + "</div>";
  }
  html += `<h3>Light and Buzzer Patterns</h3><p class="note">From <code>FeedbackPlayer::stepsFor()</code> in lib/hbr_logic/src/feedback_player.cpp. Rows: red, green, buzzer.</p><div class="values" id="patterns"></div>`;
  const setUp = (k) => {
    if (k === "sda" || k === "scl") return `I2C at ${cfg.seen.i2cHz / 1000} kHz, ${cfg.seen.i2cTimeoutUs / 1000} ms timeout`;
    if (k === "servo") return `${cfg.seen.servoHz} Hz, ${cfg.seen.servoMinUs}–${cfg.seen.servoMaxUs} µs`;
    if (k === "pnIrq") return "Input (wiring optional)";
    if (k === "pnReset") return "Output (wiring optional)";
    return "Output";
  };
  html += `<h3>Pins</h3><table class="pins"><thead><tr><th>Pin</th><th>Part</th><th>Set up as</th></tr></thead><tbody>` +
    Object.entries(cfg.pins).map(([k, g]) => `<tr><td>${pinLabel(g)}</td><td>${PIN_NAMES[k]}</td><td>${setUp(k)}</td></tr>`).join("") +
    `</tbody></table><p class="note">From include/pins.h (I2C is fixed to A4/A5 on the Uno). "Set up as" is what setup() actually did, read back from the emulated chips.` +
    (cfg.seen.badPins.length ? ` <span class="is-bad">The firmware touched pins the Uno doesn't have: ${cfg.seen.badPins.join(", ")}. On a real Uno that writes to random memory.</span>` : "") + `</p>`;
  const as = cfg.assumptions;
  html += `<h3>Build Options</h3><p class="note">Pick one with A, B or C above the 3D view. The frame scales; the parts are drawn at their real size, so you can see whether they fit. The firmware is the same for all three.</p><div id="build-options"></div>`;
  html += `<h3>Model Assumptions</h3><p class="note">Physics and other people's chips, not our code. These are guesses until the bench test measures them.</p><div class="values">` + [
    ["PN532 notices a card", `${as.pn532DetectMs} ms`],
    ["MPU-6050 noise", `${as.mpuNoiseG} g`],
    ["MG90S speed", `${as.servoDegPerS / 10}° per 0.1 s`],
    ["MG90S pulse for 0° and 180°", `${as.servoUs0} and ${as.servoUs180} µs`],
    ["EEPROM byte write", "3.3 ms (datasheet)"],
    ["Post sway", `${POST.naturalHz} Hz, drawn 2.5 times larger`],
    ["Free RAM in status", "Meaningless here: the browser has no 2 KB limit. The real figure is in the pio run output"],
  ].map(([k, v]) => `<div class="value"><b>${esc(k)}</b><span class="v">${esc(v)}</span></div>`).join("") + "</div>";
  if (manifest) {
    html += `<h3>Build</h3><div class="values"><div class="value"><b>Built</b><span class="v">${esc(manifest.builtAt.slice(0, 16).replace("T", " "))} UTC</span>
      <span class="what">${esc("Emscripten " + (manifest.toolchain.match(/\d+\.\d+\.\d+/)?.[0] || ""))} · ${manifest.files.length} source files${manifest.localConfig ? " · servo angles from your config.h" : ""}</span>
      <span class="src">Check it is current: <code>node tools/model/build.mjs --check</code></span></div></div>`;
  }
  $("#tab-values").innerHTML = html;
  drawPatterns(cfg.patterns);
  renderBuildOptions();
}

/** The table comparing the three rack designs. */
function renderBuildOptions() {
  const host = $("#build-options");
  if (!host || !sceneLib) return;
  const mm = (m) => `${Math.round(m * 1000)} mm`;
  const cols = ["a", "b", "c"].map((k) => {
    const o = sceneLib.OPTIONS[k];
    return { k, o, R: sceneLib.makeRack(o) };
  });
  const rows = [
    ["Height", (c) => mm(c.R.headTop)],
    ["Width", (c) => mm(c.R.width)],
    ["Posts", (c) => `${mm(c.R.postW)}, ${mm(c.R.inner)} inside`],
    ["Head", (c) => mm(c.o.head.w)],
    ["Board", (c) => `${c.R.board.name.replace("Arduino ", "")}, ${Math.round(c.R.board.w * 1000)} mm wide, in the post`],
    ["Servo", (c) => c.R.servo.name.replace(" Servo", "")],
    ["Buzzer", (c) => c.o.buzzer.name.replace(" active buzzer", "")],
    ["Capacitor", (c) => c.o.cap.name],
    ["Shackle bar", (c) => `${mm(c.R.barR * 2)}, sticks out ${mm(c.R.shackleDepth)}`],
    ["Holds a bike", (c) => c.R.s >= 1 ? "Yes" : c.R.s >= 0.75 ? "Yes, a little low" : "No, tabletop model"],
    ["Firmware", (c) => c.o.board === "nano" ? "Same code: pio run -e nano" : "pio run -e uno"],
  ];
  host.innerHTML = `<table class="pins options"><thead><tr><th></th>${cols.map((c) => `<th${c.k === option ? ' class="is-picked"' : ""}>${esc(c.o.label)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map(([name, f]) => `<tr><td>${name}</td>${cols.map((c) => `<td${c.k === option ? ' class="is-picked"' : ""}>${esc(f(c))}</td>`).join("")}</tr>`).join("") +
    "</tbody></table>";
}

/** Draws each light/sound pattern as a strip (from the firmware's own step lists). */
function drawPatterns(patterns) {
  const host = $("#patterns");
  for (const [name, steps] of Object.entries(patterns)) {
    const total = steps.reduce((a, s) => a + s[0], 0);
    const item = document.createElement("div");
    item.className = "pattern";
    const repeat = name === "TamperAlarm"
      ? `, repeated for at least ${values.HBR_TAMPER_ALARM_MS / 1000} s, until the post has been still ${values.HBR_TAMPER_ALARM_QUIET_MS / 1000} s` : "";
    item.innerHTML = `<div class="row spread"><b>${PATTERN_NAMES[name]}</b><span class="note">${total} ms${repeat}</span></div>`;
    const canvas = document.createElement("canvas");
    item.append(canvas);
    host.append(item);
    requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 360, h = 46;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const g = canvas.getContext("2d");
      g.scale(dpr, dpr);
      const colors = ["#ff8f8f", "#5fd39a", "#b48cff"];
      for (let row = 0; row < 3; row++) {
        g.fillStyle = "#2c212f";
        g.fillRect(0, row * 15 + 2, w, 12);
        let t = 0;
        g.fillStyle = colors[row];
        for (const s of steps) {
          if (s[row + 1]) g.fillRect(t / total * w, row * 15 + 2, Math.max(1, s[0] / total * w), 12);
          t += s[0];
        }
      }
    });
  }
}

// ---------------------------------------------------------------- serial monitor
function appendSerial(text, cls = "") {
  const out = $("#serial-out");
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 30;
  const parts = (serialPartial + text).split("\n");
  serialPartial = parts.pop();
  const frag = document.createDocumentFragment();
  for (const line of parts) {
    const div = document.createElement("div");
    const kind = cls || (/ACCESS_GRANTED|ENROLLED|is back|siren off|RECOVERED/.test(line) ? "ok"
      : /DENIED|ALARM|FAULT|not found|stopped|REMOVED|NOT added/i.test(line) ? "bad"
      : /WARNING|SIMULATED/.test(line) ? "warn" : /^\[event\]/.test(line) ? "net" : "");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = `${(runner?.nowMs / 1000 || 0).toFixed(2).padStart(7)}  `;
    const body = document.createElement("span");
    if (kind) body.className = kind;
    body.textContent = line;
    div.append(t, body);
    frag.append(div);
    serialLines++;
  }
  out.append(frag);
  while (serialLines > 1500) { out.firstChild.remove(); serialLines--; }
  scrollSerial(atBottom);
}

/** Keeps the serial console scrolled to the newest line. */
function scrollSerial(force) {
  const out = $("#serial-out");
  if (force) out.scrollTop = out.scrollHeight;
}

// ---------------------------------------------------------------- helpers
function fatal(message, e) {
  console.error(e);
  $("#bar-note").textContent = message;
  const m = $("#stage-message");
  m.hidden = false;
  m.textContent = message;
  throw e;
}

window.__model = { runner, physics, events, get state() { return lastState; }, tapCard, selectPart, setView, sendSerial, get scene() { return scene; } };
