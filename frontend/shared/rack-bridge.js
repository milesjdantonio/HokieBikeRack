// Connects a rack plugged into this computer (shared/rack-link.js) to its rack on the dashboard.
// The Uno has no Wi-Fi, so this page does the talking for it: every event the rack prints
// ("[event] t+3s TAMPER_ALARM (HIGH) ...") goes to the backend as that rack's lock module, and a
// heartbeat every 30 s keeps it Online. Close the tab or unplug, and it goes Offline within 3 min,
// like a Wi-Fi rack that lost its signal.
//
// The lock module's token never leaves this browser: it's kept in localStorage, per lock module.
import { link } from "./rack-link.js";

const HEARTBEAT_MS = 30000;
const TOKEN_KEY = (deviceId) => `hbr-usb-token:${deviceId}`;

let bound = null;      // { rackId, deviceId, token }
let queue = [];
let flushing = false;
let beatTimer = 0;
const health = { readerOk: null, accelOk: null, servoEnabled: null };
const changeFns = new Set();

export const bridge = {
  get rackId() { return bound && link.connected ? bound.rackId : null; },
  onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },

  savedToken(deviceId) { try { return localStorage.getItem(TOKEN_KEY(deviceId)); } catch (e) { return null; } },
  saveToken(deviceId, token) { try { localStorage.setItem(TOKEN_KEY(deviceId), token); } catch (e) { /* private mode */ } },

  /** Start forwarding this (already connected) rack to the dashboard rack `rackId`. */
  start({ rackId, deviceId, token }) {
    bound = { rackId, deviceId, token };
    queue = [];
    clearInterval(beatTimer);
    beatTimer = setInterval(beat, HEARTBEAT_MS);
    beat();
    changed();
  },

  stop() {
    bound = null;
    queue = [];
    clearInterval(beatTimer);
    changed();
  },
};

function changed() { for (const fn of changeFns) { try { fn(bridge); } catch (e) { console.error(e); } } }

link.onChange(() => { if (!link.connected && bound) bridge.stop(); else changed(); });

link.onLine((line, info) => {
  if (!bound || info.sent) return;
  const m = line.match(/^\[event\] t\+(\d+)s ([A-Z][A-Z0-9_]+) \((INFO|LOW|MEDIUM|HIGH|CRITICAL)\)(.*)$/);
  if (!m) return;
  const [, secs, eventType, severity, rest] = m;
  const details = parseDetails(eventType, rest);
  // From a Testing panel command, not a real card or jolt: `tap` makes card events, `shake` tamper ones.
  if ((info.sim === "tap" && eventType.startsWith("ACCESS_")) || (info.sim === "shake" && eventType.startsWith("TAMPER_"))) details.simulated = true;
  queue.push({
    id: crypto.randomUUID(), eventType, severity, occurredAt: new Date().toISOString(),
    uptimeMs: Number(secs) * 1000, details, firmwareVersion: link.firmware || null,
  });
  flush();
});

function parseDetails(type, rest) {
  const d = {};
  let m;
  if ((m = rest.match(/ ref=([0-9a-f]{64})/))) d.credentialReference = m[1];
  if ((m = rest.match(/ reason=([A-Z_]+)/))) d.reason = m[1];
  if ((m = rest.match(/ deviation=([\d.]+) g/))) d.deviationG = Number(m[1]);
  if ((m = rest.match(/ threshold=([\d.]+) g/))) d.thresholdG = Number(m[1]);
  if (type === "DEVICE_BOOT") {
    health.readerOk = / reader=OK/.test(rest);
    health.accelOk = / accel=OK/.test(rest);
    health.servoEnabled = / servo=REAL/.test(rest);
    Object.assign(d, health);
    setTimeout(beat, 500); // tell the dashboard about the new state straight away
  }
  if (type === "SENSOR_FAULT" && (m = rest.match(/ sensor=(\S+) state=(\S+)/))) {
    d.sensor = m[1];
    d.state = m[2];
    const ok = m[2] === "RECOVERED";
    if (m[1] === "PN532") health.readerOk = ok;
    if (m[1] === "MPU6050") health.accelOk = ok;
  }
  return d;
}

async function post(path, body) {
  const res = await fetch(`/api/v1/devices/${bound.deviceId}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bound.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Events are sent in order; if the backend is unreachable they wait here and go with the next try.
async function flush() {
  if (flushing || !bound || !queue.length) return;
  flushing = true;
  try {
    while (bound && queue.length) {
      const batch = queue.slice(0, 50);
      await post("/events", { events: batch });
      queue.splice(0, batch.length);
    }
  } catch (err) {
    console.warn("rack bridge: events not sent yet", err);
  } finally {
    flushing = false;
  }
}

async function beat() {
  if (!bound || !link.connected) return;
  try {
    await post("/heartbeat", {
      link: "usb", firmwareVersion: link.firmware || null, queueDepth: queue.length,
      readerOk: health.readerOk, accelOk: health.accelOk, servoEnabled: health.servoEnabled,
    });
  } catch (err) {
    console.warn("rack bridge: heartbeat failed", err);
  }
  flush();
}
