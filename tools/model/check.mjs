#!/usr/bin/env node
// Runs the firmware model (frontend/model/firmware.js) through the bench-test scenarios in Node
// and checks what the REAL firmware does. Expected numbers come from the compiled firmware's
// own config, never typed in here, so changing a timing in src/ cannot make this lie.
//
//   node tools/model/check.mjs
//
// Also a cheap way to try a firmware change before the ESP32 is on the bench.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL = path.join(ROOT, "frontend", "model");
const load = (f) => import(pathToFileURL(path.join(MODEL, f)).href);
const { FirmwareRunner, RESET } = await load("runner.js");
const { ModelServer } = await load("server.js");
const { Physics } = await load("physics.js");

const modelConfig = fs.readFileSync(path.join(ROOT, "firmware", "model", "config.h"), "utf8");
const define = (name) => modelConfig.match(new RegExp(`#define ${name} "([^"]*)"`))[1];

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${!ok && detail ? `\n         ${detail}` : ""}`);
  if (!ok) failures++;
}

function fresh() {
  const t = {};
  t.physics = new Physics();
  t.server = new ModelServer({
    deviceId: define("HBR_DEVICE_ID"), token: define("HBR_DEVICE_TOKEN"), validityHours: 72,
    nowEpoch: () => t.runner.worldEpoch(),
  });
  t.runner = new FirmwareRunner({ physics: t.physics, server: t.server });
  t.serial = "";
  t.logs = [];
  t.run = (ms) => {
    const step = 50;
    for (let done = 0; done < ms; done += step) {
      const log = t.runner.run(Math.min(step, ms - done));
      log.at = t.runner.nowMs;
      t.serial += log.serial;
      t.logs.push(log);
    }
  };
  t.edges = (pin) => t.logs.flatMap((l) => l.edges).filter((e) => e[1] === pin);
  t.servo = () => t.logs.flatMap((l) => l.servo);
  t.mark = () => { t.serial = ""; t.logs = []; };
  return t;
}

const t = fresh();
await t.runner.boot(RESET.POWER_ON);
const cfg = t.runner.config;
const val = Object.fromEntries(cfg.values.map((v) => [v.id, v.value]));
const pulseFor = (deg) => Math.round(cfg.seen.servoMinUs + deg / 180 * (cfg.seen.servoMaxUs - cfg.seen.servoMinUs));

console.log("Boot");
t.run(5000);
check("prints the firmware banner", t.serial.includes(`HokieBikeRack firmware ${cfg.firmwareVersion} starting`));
check("finds the PN532", t.serial.includes("[nfc] PN532 firmware 1.6"));
check("finds the MPU-6050", t.serial.includes("[accel] WHO_AM_I = 0x68"));
check("joins Wi-Fi and downloads the card list", t.serial.includes("[net] Wi-Fi connected") && t.runner.state().access.loaded);
check("sets the clock from NTP", t.runner.state().epoch > 1735689600);
check("uploads DEVICE_BOOT", t.server.events.some((e) => e.eventType === "DEVICE_BOOT"));
const pulses = t.servo().map((s) => s[1]);
check("servo starts at the library's 1500 us, then goes to LOCKED", pulses[0] === 1500 && pulses[1] === pulseFor(val.HBR_SERVO_LOCKED_DEG),
  JSON.stringify(pulses));
check("MPU set to +/-4 g by the firmware", (cfg.seen.mpuAccelConfig >> 3 & 3) === 1, String(cfg.seen.mpuAccelConfig));
check("I2C runs at pins.h speed", cfg.seen.i2cHz === 100000 && cfg.seen.i2cSda === cfg.pins.sda);

console.log("Unknown card, then registered");
const unknownUid = "04a224b27c5e80";
t.mark();
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(1500);
check("denied NOT_LISTED", t.serial.includes("DENIED (NOT_LISTED)"));
const redOn = t.edges(cfg.pins.red).filter((e) => e[2] === 1).length;
const deniedBeeps = cfg.patterns.Denied.filter((s) => s[3]).length;
const beeps = t.edges(cfg.pins.buzzer).filter((e) => e[2] === 1).length;
check(`buzzer beeps ${deniedBeeps}x (Denied pattern)`, beeps === deniedBeeps, `beeps ${beeps}`);
check("red LED on for the Denied pattern", redOn >= 1);
const ref = t.runner.cardRef(unknownUid);
const hmac = crypto.createHmac("sha256", define("HBR_CARD_KEY")).update("hbr-card-v1:" + unknownUid).digest("hex");
check("credential reference is HMAC-SHA256 (matches Node's crypto)", ref === hmac);
check("server lists it under unknown cards", t.server.unknown.has(ref));
t.server.register(ref, "Your HokieP");
t.runner.serial("sync\n");
t.run(1000);
t.mark();
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(500);
check("now ALLOWED", t.serial.includes("ALLOWED"));
check("servo -> UNLOCKED pulse", t.servo().some((s) => s[1] === pulseFor(val.HBR_SERVO_UNLOCKED_DEG)));
check("lock reports open", t.runner.state().lock.unlocked);
t.run(val.HBR_UNLOCK_DURATION_MS);
check(`re-locks by itself after ${val.HBR_UNLOCK_DURATION_MS} ms`, !t.runner.state().lock.unlocked &&
  t.servo().at(-1)[1] === pulseFor(val.HBR_SERVO_LOCKED_DEG));

console.log("Holding a card on the reader");
t.run(val.debouncer + 500);
t.mark();
const readsBefore = t.runner.state().reader.reads;
const grantedBefore = t.server.events.filter((e) => e.eventType === "ACCESS_GRANTED").length;
t.runner.card(unknownUid);
t.run(4000);
t.runner.card(null);
t.run(1000);
const reads = t.runner.state().reader.reads - readsBefore;
const granted = t.server.events.filter((e) => e.eventType === "ACCESS_GRANTED").length - grantedBefore;
check("the reader reads it many times, the firmware acts once", reads > 3 && granted === 1, `reads ${reads}, granted ${granted}`);

console.log("Tamper");
t.run(val.HBR_UNLOCK_DURATION_MS + val.HBR_TAMPER_GRACE_MS);
t.mark();
t.physics.knock(t.runner.worldMs);
t.run(2000);
check("a light knock is not a jolt", !t.serial.includes("[tamper]"));
t.physics.shake(t.runner.worldMs, 1500);
t.run(2500);
check("a shake gives a WARNING", t.serial.includes("[tamper] WARNING"));
t.run(val.cooldownMs);
t.physics.shake(t.runner.worldMs, 1500);
t.run(2000);
check("shaking again soon gives the ALARM", t.serial.includes("[tamper] ALARM") && t.runner.state().tamper.alarm);
check("siren is sounding", t.edges(cfg.pins.buzzer).length > 10);
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(300);
check("an allowed card stops the alarm", !t.runner.state().tamper.alarm);
check("tamper never moved the lock", t.servo().filter((s) => s[1] === pulseFor(val.HBR_SERVO_UNLOCKED_DEG)).length === 1);

console.log("Offline");
t.run(val.HBR_UNLOCK_DURATION_MS + 1000);
t.runner.hotspot(false);
t.run(3000);
t.mark();
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(1000);
check("hotspot off: registered card still works", t.serial.includes("ALLOWED"));
check("events wait in flash", t.runner.state().queue > 0);
t.runner.hotspot(true);
t.run(val.kWifiRetryEveryMs + 6000);
check("hotspot back: backlog uploads", t.runner.state().queue === 0 && t.serial.includes("uploaded"));

console.log("Power cycle with the hotspot off (KNOWNBUGS #3)");
t.run(val.debouncer + 500);
t.runner.hotspot(false);
t.mark();
await t.runner.boot(RESET.POWER_ON);
t.run(3000);
check("card list survives in flash", t.serial.includes("[access] loaded saved card list"));
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(500);
check("no clock -> DENIED (CLOCK_NOT_SET)", t.serial.includes("DENIED (CLOCK_NOT_SET)"));
t.runner.hotspot(true);
t.run(val.kWifiRetryEveryMs + 5000);
t.mark();
t.runner.card(unknownUid);
t.run(300);
t.runner.card(null);
t.run(500);
check("hotspot back -> allowed again", t.serial.includes("ALLOWED"));

console.log("Unplugging the PN532");
t.mark();
t.runner.link(0, false);
t.run(3000);
check("reader stopped answering", t.serial.includes("[nfc] reader stopped answering"));
t.runner.link(0, true);
t.run(val.kRetryInitEveryMs + 1000);
check("reader is back", t.serial.includes("[nfc] reader is back"));

console.log("Serial console");
t.mark();
t.runner.serial("i2c-scan\n");
t.run(500);
check("i2c-scan finds 0x24 and 0x68", t.serial.includes("found 0x24 (PN532)") && t.serial.includes("found 0x68 (MPU-6050)"));

console.log("Alarm keeps going while the post is shaken");
const a = fresh();
await a.runner.boot(RESET.POWER_ON);
a.run(5000);
a.physics.shake(a.runner.worldMs, 1000);
a.run(val.cooldownMs + 1000);
a.physics.shake(a.runner.worldMs, 1000);
a.run(1200);
check("second shake starts the alarm", a.runner.state().tamper.alarm);
const shakenFor = val.HBR_TAMPER_ALARM_MS + 6000;  // shaken well past the minimum
for (let done = 0; done < shakenFor; done += 2000) {
  a.physics.shake(a.runner.worldMs, 1000);
  a.run(2000);
}
check("still sounding while shaken past the minimum", a.runner.state().tamper.alarm);
a.run(val.HBR_TAMPER_ALARM_QUIET_MS - 1500);
check("still sounding just before the quiet time is up", a.runner.state().tamper.alarm);
a.mark();
a.run(2500);
check("stops once the post has been still long enough", !a.runner.state().tamper.alarm && a.serial.includes("[tamper] siren off"));
a.run(1000);
check("the buzzer is quiet after it stops", a.edges(cfg.pins.buzzer).every((e, i, all) => i < all.length - 1 || e[2] === 0));
a.run(val.escalationWindowMs - 8000);
a.mark();
a.physics.shake(a.runner.worldMs, 1000);
a.run(1500);
check("a jolt inside the window after it stops is an alarm again", a.serial.includes("[tamper] ALARM"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
