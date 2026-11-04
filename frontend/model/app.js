// Rack Model page (docs/notes/firmware-model.md). Runs the compiled firmware, feeds it the world
// (cards, post motion, wires, Wi-Fi) and shows what it does: the 3D rack, the timeline, a live
// readout, the serial console and the model server. Every behaviour you see comes from the C++.
import { Buzzer } from "./buzzer.js";
import { Physics, ServoArm, POST } from "./physics.js";
import { FirmwareRunner, RESET } from "./runner.js";
import { ModelServer, iso } from "./server.js";
import { Timeline } from "./timeline.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const secs = (ms) => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";

// Cards the model knows. The kit card starts registered, like after the bench test's step 3.
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
  lights: { what: "Green and red 5 mm LEDs, each through a 220 to 330 ohm resistor. They also light the tubing around the post.", pins: ["green", "red"], files: ["src/feedback.cpp", "lib/hbr_logic/src/feedback_player.cpp"] },
  vents: { what: "Slots so the buzzer inside can be heard.", files: [] },
  esp32: { what: "ESP32 DevKit with an ESP32-WROOM-32. loop() runs on core 1: cards, tamper sensor, lock timer, lights. The network task runs on core 0.", files: ["src/main.cpp", "src/backend_sync.cpp"] },
  pn532: { what: "PN532 NFC reader in I2C mode at address 0x24, powered from 3.3 V.", pins: ["sda", "scl"], files: ["src/card_reader.cpp"] },
  mpu: { what: "MPU-6050 accelerometer on a GY-521 board at I2C address 0x68, glued inside the post on its side, so gravity reads on its y axis.", pins: ["sda", "scl"], files: ["src/tamper_sensor.cpp", "lib/hbr_logic/src/tamper_detector.cpp"] },
  servo: { what: "MG90S micro servo. 50 Hz signal from the ESP32, power from the separate 5 V supply. It has no position feedback.", pins: ["servo"], files: ["src/lock.cpp", "lib/hbr_logic/src/lock_controller.h"] },
  latch: { what: "Spring latch. A spring holds the plate in the shackle's grooves. The servo pulls it aside through a slotted link, so it can open the latch but never holds it shut. A shackle pushed in later shoves the plate aside on its ramp and the plate snaps back: locked without a card or power.", pins: ["servo"], files: ["src/lock.cpp"] },
  buzzer: { what: "Active buzzer: one fixed pitch, on or off. Switched by an NPN transistor, 1 kohm to its base.", pins: ["buzzer"], files: ["src/feedback.cpp", "lib/hbr_logic/src/feedback_player.cpp"] },
  parts: { what: "The LED resistors, the 1 kohm base resistor and the NPN transistor for the buzzer.", pins: ["green", "red", "buzzer"], files: [] },
  cap: { what: "100 to 1000 uF electrolytic across the servo's 5 V, close to the servo. It covers the current spike when the servo starts moving.", files: [] },
  supply: { what: "Separate 5 V supply for the servo. Only its ground is joined to the ESP32's.", files: [] },
  usb: { what: "USB from the laptop: powers the ESP32 and carries the serial console.", files: ["src/main.cpp"] },
};
const PIN_NAMES = { sda: "I2C SDA", scl: "I2C SCL", servo: "Servo signal", green: "Green LED", red: "Red LED", buzzer: "Buzzer transistor" };
const PATTERN_NAMES = { None: "Idle", Boot: "Boot flash", Granted: "Granted", Denied: "Denied", TamperWarning: "Tamper warning", TamperAlarm: "Siren" };
const DENY_TEXT = {
  NOT_LISTED: "it isn't on the card list. Register it on the Server tab.",
  NO_SNAPSHOT: "the rack has no card list yet.",
  CLOCK_NOT_SET: "the rack's clock isn't set, so it can't check the list's expiry. It needs Wi-Fi once after power-on.",
  SNAPSHOT_EXPIRED: "the card list is older than its lifetime.",
};

// ---------------------------------------------------------------- set up
const manifest = await fetch("firmware.json").then((r) => r.json()).catch(() => null);
let runner;
const server = new ModelServer({
  deviceId: "model-rack-a", token: "model-device-token",
  validityHours: manifest?.backend?.snapshotValidityHours ?? 72, nowEpoch: () => runner.worldEpoch(),
});
const physics = new Physics();
let arm = null;
let values = {};
const timeline = new Timeline($("#timeline"));
const buzzer = new Buzzer();
let scene = null;
let sceneLib = null;  // scene.js exports (OPTIONS, makeRack), once loaded
// Build option: A standard, B 0.75x, C 0.5x with mini parts. Kept in the address (?option=b).
let option = new URLSearchParams(location.search).get("option") || "a";
if (!["a", "b", "c"].includes(option)) option = "a";
let pickedCard = CARDS[0];
let selected = null;
let speed = 1, paused = false;
let lastState = null;
let tap = null;           // { card, releaseAt, readsBefore, at }
let lastResult = null;
let serverDirty = true;
let serialLines = 0, serialPartial = "";
let lastReal = performance.now(), lastDom = 0, lastServer = 0;
const busy = { mpu: { n: 0, at: -1e9 }, pn: { n: 0, at: -1e9 } };
// The shackle and spring latch are mechanics: the firmware can't see them (no sensor).
const shackle = { out: 0, target: 0, cam: 0, rattle: 0, note: "" };
const SHACKLE_MS = 450;  // how long pulling it out or pushing it in takes

runner = new FirmwareRunner({
  physics, server,
  onBoot: (reason) => {
    timeline.reset();
    timeline.setup(runner.config);
    values = Object.fromEntries(runner.config.values.map((v) => [v.id, v.value]));
    if (!arm) arm = new ServoArm(runner.config.assumptions);
    arm.target = null;     // the horn stays where it is until the new boot sends a pulse
    arm.lastMs = 0;
    appendSerial(`\n— ${reason === RESET.POWER_ON ? "power on" : "restart"} —\n`, "me");
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
server.register(CARDS.find((c) => c.id === "kit").ref, "Kit Card");
server.changed = () => (serverDirty = true);

$("#bar-note").textContent = `Firmware ${runner.config.firmwareVersion}, compiled from firmware/src and lib/hbr_logic, running in your browser. Nothing here touches the real rack or server.`;

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
    if (serverDirty || nowReal - lastServer > 1000) {
      serverDirty = false;
      lastServer = nowReal;
      renderServer();
    }
  } catch (e) {
    console.error(e);  // one bad frame must never stop the model
  }
}

function step(ms) {
  const frameStart = runner.nowMs;
  if (tap && !tap.hold && !tap.released && runner.nowMs + ms >= tap.releaseAt) {
    // Run up to the moment the card leaves the field, then take it away.
    process(runner.run(Math.max(0, tap.releaseAt - runner.nowMs)), frameStart);
    runner.card(null);
    tap.released = true;
    ms = Math.max(0, frameStart + ms - runner.nowMs);
  }
  if (ms > 0) process(runner.run(ms), frameStart);
  moveShackle(runner.nowMs - frameStart);
  if (runner.restartRequested) reboot(RESET.SOFTWARE);
}

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
  if (log.serial) appendSerial(log.serial);
  for (const line of log.events) {
    try {
      const e = JSON.parse(line);
      if (e.eventType === "ACCESS_GRANTED" || e.eventType === "ACCESS_DENIED") {
        const card = CARDS.find((c) => c.ref === e.details?.credentialReference);
        lastResult = { card, allowed: e.eventType === "ACCESS_GRANTED", reason: e.details?.reason, at: e.uptimeMs };
        if (tap) tap.acted = (tap.acted || 0) + 1;
      }
    } catch { /* partial line */ }
  }
}

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

function sceneFrame(s, now) {
  for (const [key, count] of [["mpu", s.i2c.mpu], ["pn", s.i2c.pn532]]) {
    if (count !== busy[key].n) { busy[key].n = count; busy[key].at = now; }
  }
  const lockedDeg = values.HBR_SERVO_LOCKED_DEG, openDeg = values.HBR_SERVO_UNLOCKED_DEG;
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
  $("#hotspot").addEventListener("change", (e) => runner.hotspot(e.target.checked));
  $("#server-up").addEventListener("change", (e) => { server.running = e.target.checked; serverDirty = true; });

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
    });
  }

  $("#serial-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#serial-in").value.trim();
    if (!text) return;
    sendSerial(text);
    $("#serial-in").value = "";
  });
  for (const cmd of ["status", "i2c-scan", "accel", "sync", "reboot"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = cmd;
    b.addEventListener("click", () => sendSerial(cmd));
    $("#serial-chips").append(b);
  }
  $("#serial-note").innerHTML = `The same console as <code>pio device monitor</code> at ${runner.config.seen.baud} baud. Every line comes from the firmware's Serial.printf.`;
}

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

function syncCardPick() {
  for (const b of document.querySelectorAll("#card-pick button")) b.setAttribute("aria-checked", String(b.dataset.card === pickedCard.id));
}

function syncTapButton() {
  $("#tap").textContent = tap?.hold ? "Take Card Away" : "Tap Card";
}

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

function sendSerial(text) {
  appendSerial("> " + text + "\n", "me");
  runner.serial(text + "\n");
}

function setView(inside) {
  for (const o of document.querySelectorAll("#view button")) o.setAttribute("aria-checked", String((o.dataset.view === "inside") === inside));
  scene?.setView(inside);
}

function pickFromScene(id, fromCanvas) {
  if (fromCanvas && id === "reader") { tapCard(); return; }
  if (fromCanvas && id === "post") { selectPart("post"); return; }
  selectPart(id);
  const internal = ["esp32", "pn532", "mpu", "servo", "latch", "buzzer", "parts", "cap", "supply", "usb"].includes(id);
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

function syncShackleButton() {
  $("#shackle").textContent = shackle.target === 1 ? "Push Shackle In" : "Pull Shackle Out";
  const fresh = shackle.note && performance.now() - shackle.noteAt < 4000;
  $("#shackle-readout").textContent = fresh ? shackle.note : shackleText();
}

function shackleText() {
  if (shackle.out > 0.99) {
    return servoLatchOpen() > 0.9 ? "Out. The servo is holding the latch open."
      : "Out. The latch has closed again. Push the shackle in and it still locks.";
  }
  if (shackle.out > 0.01) return "Moving.";
  return servoLatchOpen() > 0.9 ? "In, latch held open by the servo." : "In and latched.";
}

// ---------------------------------------------------------------- live readout
function renderLive(s) {
  const now = s.ms;
  const rows = [];
  const lockedDeg = values.HBR_SERVO_LOCKED_DEG, openDeg = values.HBR_SERVO_UNLOCKED_DEG;
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

  const a = s.access;
  let list = a.loaded ? `Revision …${String(a.revision).slice(-5)}, ${a.cards} card${a.cards === 1 ? "" : "s"}` : "None yet";
  if (a.loaded) list += `<span class="sub">Valid until ${fmtTime(a.validUntil)}</span>`;
  const why = !a.keySet ? "no card key" : !a.loaded ? "no card list" : !s.epoch ? "clock not set" : s.epoch >= a.validUntil ? "list expired" : !s.reader.healthy ? "reader not answering" : "";
  rows.push(["Card List", list + `<span class="sub ${why ? "is-warn" : "is-on"}">${why ? "Not ready: " + why : "Ready for cards"}</span>`]);
  rows.push(["Clock", s.epoch ? fmtTime(s.epoch) + " UTC" : `<span class="is-warn">Not set</span><span class="sub">No internet time since power-on</span>`]);
  const net = s.net.wifi ? `<span class="is-on">Wi-Fi connected</span>` : s.net.hotspot ? "Joining Wi-Fi" : `<span class="is-warn">Offline</span>`;
  rows.push(["Network", `${net} · ${s.queue} event${s.queue === 1 ? "" : "s"} waiting<span class="sub">${s.net.wifi ? (s.net.lastSyncOk ? "Last request to the server worked" : "Server not answering") : "Cards still work from the saved list"}</span>`]);

  $("#live").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  // set through the DOM: the site's security policy blocks style="" attributes
  const fill = $("#live .meter i");
  if (fill) fill.style.width = pct.toFixed(1) + "%";
}

function renderCardReadout(s) {
  const el = $("#card-readout");
  if (!tap && !lastResult) return;
  if (lastResult) {
    const who = lastResult.card ? lastResult.card.name : "That card";
    let text = lastResult.allowed
      ? `<b>${esc(who)}: allowed.</b> The lock opens for ${secs(values.HBR_UNLOCK_DURATION_MS)}.`
      : `<b>${esc(who)}: denied</b>, ${DENY_TEXT[lastResult.reason] || lastResult.reason}`;
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
  esp32: {
    head: "ESP32 DevKit with an ESP32-WROOM-32, lying on the floor of the head. loop() runs on core 1: cards, tamper sensor, lock timer, lights. The network task runs on core 0.",
    devkit: "ESP32 DevKit with an ESP32-WROOM-32, standing in the post with its USB plug pointing down, so the smaller head only has to hold the reader, lights and buzzer. Wires run up the side wall. Same board and firmware as option A.",
    mini: "A mini board with the same classic ESP32 chip (TinyPICO, M5Stamp Pico or similar, about 18 × 32 mm), standing in the post. Same firmware: only pins.h changes if the board doesn't have GPIO 13, 21, 22, 25, 26 and 27.",
  },
  servo: {
    mg90s: "MG90S micro servo. 50 Hz signal from the ESP32, power from the separate 5 V supply. It has no position feedback.",
    submicro: "Sub-micro servo, 3.7 g class (about 20 × 9 × 17 mm). Same signal and code as the MG90S, but much weaker: use a light spring on the latch. Fine for a model, not for a real rack.",
  },
};

function partWhat(id) {
  const o = scene?.opt;
  if (o && id === "esp32") return OPTION_INFO.esp32[o.espIn === "head" ? "head" : o.board];
  if (o && id === "servo") return OPTION_INFO.servo[o.servo];
  if (o && id === "buzzer") return `${o.buzzer.name}: one fixed pitch, on or off. Switched by an NPN transistor, 1 kohm to its base.`;
  if (o && id === "cap") return `${o.cap.name} electrolytic across the servo's 5 V, close to the servo. It covers the current spike when the servo starts moving.`;
  if (o && id === "usb" && o.espIn !== "head") return "USB from the laptop, up through the bottom of the post to the board: powers the ESP32 and carries the serial console.";
  return PART_INFO[id]?.what;
}

function renderPartCard(id, s) {
  const card = $("#part-card");
  const info = PART_INFO[id];
  if (!info || !s) { card.hidden = true; return; }
  const pins = runner.config.pins;
  const wired = (info.pins || []).map((p) => `${PIN_NAMES[p]}: GPIO ${pins[p]}`).join("<br>");
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

function nameOf(id) {
  if (scene) return scene.partName(id);
  return { post: "Post", shackle: "Shackle", reader: "Reader Window", lights: "Lights", vents: "Buzzer Vents", esp32: "ESP32 DevKit",
    pn532: "PN532 Reader", mpu: "MPU-6050", servo: "MG90S Servo", latch: "Latch", buzzer: "Buzzer", parts: "Resistors and Transistor",
    cap: "Capacitor", tubing: "Light Tubing", supply: "5 V Supply", usb: "USB Cable" }[id] || id;
}

function partNow(id, s) {
  const seen = runner.config.seen;
  switch (id) {
    case "esp32": return `loop() and the network task "${esc(s.net.taskName)}" on core ${s.net.taskCore}. The task has run ${s.net.taskRuns} times; it wakes every ${values.kTaskTickMs} ms.`;
    case "pn532": return s.reader.healthy
      ? `Answering. The firmware asks "card there?" every ${s.reader.pollGapMs} ms (kPollEveryMs is ${values.kPollEveryMs}). Card IDs read so far: ${s.reader.reads}.`
      : `<span class="is-bad">Not answering.</span> card_reader.cpp retries every ${secs(values.kRetryInitEveryMs)}.`;
    case "mpu": return s.accel.healthy
      ? `Read every ${s.accel.readGapMs} ms. Raw counts x ${s.accel.raw[0]}, y ${s.accel.raw[1]}, z ${s.accel.raw[2]}; the firmware set ±${2 << ((seen.mpuAccelConfig >> 3) & 3)} g, so that's ${s.accel.g.map((v) => v.toFixed(3)).join(", ")} g.`
      : `<span class="is-bad">Not answering.</span> tamper_sensor.cpp retries every 10 s.`;
    case "servo": case "latch": {
      const cmd = Math.round((s.lock.servoUs - seen.servoMinUs) / (seen.servoMaxUs - seen.servoMinUs) * 180);
      const open = arm.angle !== null && Math.abs(arm.angle - values.HBR_SERVO_UNLOCKED_DEG) < 5;
      return `Pulse ${s.lock.servoUs} µs at ${seen.servoHz} Hz on GPIO ${seen.servoPin}, which is ${cmd}°. Horn at ${arm.angle === null ? "?" : Math.round(arm.angle)}°, latch ${open ? "open" : "closed"}.${arm.powered ? "" : ' <span class="is-warn">5 V supply off.</span>'}`;
    }
    case "lights": return `Green ${s.feedback.green ? "on" : "off"}, red ${s.feedback.red ? "on" : "off"}. Pattern: ${PATTERN_NAMES[s.feedback.pattern]}.`;
    case "buzzer": case "vents": return `GPIO ${runner.config.pins.buzzer} is ${s.feedback.buzzer ? "high: beeping" : "low: quiet"}.`;
    case "reader": return s.reader.cardPresent ? "A card is on the reader." : `Picked card: ${esc(pickedCard.name)}. Click the window to tap it.`;
    case "post": return `Tamper deviation ${s.tamper.deviationG.toFixed(2)} g. The sensor is ${Math.round((scene?.R.mpuY ?? POST.sensorHeight) * 1000)} mm up the post.`;
    case "shackle": return shackleText();
    case "tubing": return s.feedback.green && s.feedback.red ? "Amber: both LEDs on." : s.feedback.green ? "Green." : s.feedback.red ? "Red." : "Dark.";
    case "supply": case "cap": return arm.powered ? "5 V on." : '<span class="is-warn">Supply off: the servo can\'t move.</span>';
    case "usb": return `Serial at ${seen.baud} baud, ${s.net.http} requests sent to the server so far.`;
    default: return "";
  }
}

// ---------------------------------------------------------------- server tab
function renderServer() {
  const el = $("#tab-server");
  if (el.hidden && !serverDirty) return;
  const now = runner.worldEpoch();
  const name = (ref) => CARDS.find((c) => c.ref === ref)?.name || `Card ${ref.slice(0, 8)}`;
  const hb = server.lastHeartbeat ? `${Math.max(0, now - server.lastHeartbeat.epoch)} s ago` : "None yet";
  const b = manifest?.backend;
  const cards = [...server.cards].map(([ref, c]) => `<div class="item"><div class="item-main"><b>${esc(c.label)}</b><span>${ref.slice(0, 16)}…</span></div><button type="button" class="btn btn-small" data-revoke="${ref}">Revoke</button></div>`).join("");
  const unknown = [...server.unknown].map(([ref, u]) => `<div class="item"><div class="item-main"><b>${esc(name(ref))}</b><span>Tapped ${u.count} time${u.count === 1 ? "" : "s"} · ${ref.slice(0, 16)}…</span></div><button type="button" class="btn btn-small" data-register="${ref}">Register</button></div>`).join("");
  const events = server.events.slice(0, 14).map((e) => `<div class="item"><div class="item-main"><b>${esc(e.eventType)}</b><span>${esc(e.severity)} · ${e.occurredAt ? esc(e.occurredAt.slice(11, 19)) + " UTC" : "no clock yet"}${e.details?.reason ? " · " + esc(e.details.reason) : ""}${e.details?.deviationG !== undefined ? " · " + e.details.deviationG + " g" : ""}</span></div></div>`).join("");
  const html = `<h2>Laptop Server</h2>
    <p class="note">Stands in for the Spring backend's device API, so you can watch the network task work. It never talks to the real one.</p>
    <div class="list">
      <div class="item"><div class="item-main"><b>${server.running ? "Running" : "Stopped"}</b><span>${server.requests} requests answered · last heartbeat ${hb}</span></div></div>
      <div class="item"><div class="item-main"><b>Card list revision …${String(server.revision).slice(-5)}</b><span>Valid for ${server.validityHours} h after each download${b ? ` · <code>${esc(b.file)}:${b.line}</code>` : ""}</span></div><button type="button" class="btn btn-small" data-sync="1">Sync Now</button></div>
    </div>
    <h3>Cards That Work Here</h3>
    <div class="list">${cards || '<p class="empty">None.</p>'}</div>
    <h3>Unknown Cards Tapped</h3>
    <div class="list">${unknown || '<p class="empty">Tap a card that isn\'t registered and it shows up here.</p>'}</div>
    <p class="note">After you register or revoke, the rack picks the change up on its next download, within ${values.kSnapshotEveryMs / 1000} s, or right away with Sync Now.</p>
    <h3>Events Received</h3>
    <div class="list">${events || '<p class="empty">None yet.</p>'}</div>`;
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
  el.querySelectorAll("[data-register]").forEach((btn) => btn.addEventListener("click", () => server.register(btn.dataset.register, name(btn.dataset.register))));
  el.querySelectorAll("[data-revoke]").forEach((btn) => btn.addEventListener("click", () => server.revoke(btn.dataset.revoke)));
  el.querySelectorAll("[data-sync]").forEach((btn) => btn.addEventListener("click", () => sendSerial("sync")));
}

// ---------------------------------------------------------------- values tab
function renderValues() {
  const cfg = runner.config;
  const loc = manifest?.locations || {};
  const groups = {};
  for (const v of cfg.values) (groups[v.group] ||= []).push(v);
  const fmt = (v) => {
    if (v.unit === "ms" && v.value >= 1000) return `${v.value / 1000} s`;
    if (v.id === "kEarliestPlausibleEpoch") return iso(v.value).slice(0, 10);
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
  html += `<h3>Pins</h3><table class="pins"><thead><tr><th>GPIO</th><th>Part</th><th>Set up as</th></tr></thead><tbody>` +
    Object.entries(cfg.pins).map(([k, g]) => `<tr><td>${g}</td><td>${PIN_NAMES[k]}</td><td>${k === "sda" || k === "scl" ? `I2C at ${cfg.seen.i2cHz / 1000} kHz` : k === "servo" ? `${cfg.seen.servoHz} Hz, ${cfg.seen.servoMinUs}–${cfg.seen.servoMaxUs} µs` : "Output"}</td></tr>`).join("") +
    `</tbody></table><p class="note">From include/pins.h. "Set up as" is what setup() actually did, read back from the emulated chips.</p>`;
  const as = cfg.assumptions;
  html += `<h3>Build Options</h3><p class="note">Pick one with A, B or C above the 3D view. The frame scales; the parts are drawn at their real size, so you can see whether they fit. The firmware is the same for all three.</p><div id="build-options"></div>`;
  html += `<h3>Model Assumptions</h3><p class="note">Physics and other people's chips, not our code. These are guesses until the bench test measures them.</p><div class="values">` + [
    ["ESP32 joins the hotspot", `${as.wifiConnectMs / 1000} s`],
    ["First internet time answer", `${as.ntpDelayMs / 1000} s`],
    ["PN532 notices a card", `${as.pn532DetectMs} ms`],
    ["MPU-6050 noise", `${as.mpuNoiseG} g`],
    ["MG90S speed", `${as.servoDegPerS / 10}° per 0.1 s`],
    ["MG90S pulse for 0° and 180°", `${as.servoUs0} and ${as.servoUs180} µs`],
    ["Post sway", `${POST.naturalHz} Hz, drawn 2.5 times larger`],
    ["Server and Wi-Fi requests", "Instant"],
    ["Free heap in status", "The model's memory, not the ESP32's"],
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
    ["ESP32", (c) => c.o.board === "mini" ? "Mini board, in the post" : c.o.espIn === "head" ? "DevKit, in the head" : "DevKit, in the post"],
    ["Servo", (c) => c.R.servo.name.replace(" Servo", "")],
    ["Buzzer", (c) => c.o.buzzer.name.replace(" active buzzer", "")],
    ["Capacitor", (c) => c.o.cap.name],
    ["Shackle bar", (c) => `${mm(c.R.barR * 2)}, sticks out ${mm(c.R.shackleDepth)}`],
    ["Holds a bike", (c) => c.R.s >= 1 ? "Yes" : c.R.s >= 0.75 ? "Yes, a little low" : "No, tabletop model"],
    ["Firmware", (c) => c.o.board === "mini" ? "pins.h only, if needed" : "Unchanged"],
  ];
  host.innerHTML = `<table class="pins options"><thead><tr><th></th>${cols.map((c) => `<th${c.k === option ? ' class="is-picked"' : ""}>${esc(c.o.label)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map(([name, f]) => `<tr><td>${name}</td>${cols.map((c) => `<td${c.k === option ? ' class="is-picked"' : ""}>${esc(f(c))}</td>`).join("")}</tr>`).join("") +
    "</tbody></table>";
}

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
    const kind = cls || (/ALLOWED|connected|is back|uploaded|new card list/.test(line) ? "ok"
      : /DENIED|ALARM|FAULT|not found|stopped|failed|rejected/i.test(line) ? "bad"
      : /WARNING|SIMULATED/.test(line) ? "warn" : /^\[net\]/.test(line) ? "net" : "");
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

function scrollSerial(force) {
  const out = $("#serial-out");
  if (force) out.scrollTop = out.scrollHeight;
}

// ---------------------------------------------------------------- helpers
function fmtTime(epoch) {
  return iso(epoch).replace("T", " ").replace("Z", "");
}

function fatal(message, e) {
  console.error(e);
  $("#bar-note").textContent = message;
  const m = $("#stage-message");
  m.hidden = false;
  m.textContent = message;
  throw e;
}

window.__model = { runner, server, physics, get state() { return lastState; }, tapCard, selectPart, setView, get scene() { return scene; } };
