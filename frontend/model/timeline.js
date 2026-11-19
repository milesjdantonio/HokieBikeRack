// The strip chart under the model: the last few seconds of what the firmware did, drawn from
// its own logs (every GPIO edge, every servo pulse change, every tamper sample), so even a
// 30 ms blip shows up no matter how fast the page is running.
const C = {
  ink: "#f4eef0", muted: "#c9bcc2", faint: "#9e8f97", grid: "#2c212f", lane: "#211823",
  green: "#5fd39a", red: "#ff8f8f", buzz: "#b48cff", accent: "#e5751f", warn: "#ffc46b",
};
const ROWS = [
  { id: "events", label: "Events", h: 22 },
  { id: "green", label: "Green LED", h: 14 },
  { id: "red", label: "Red LED", h: 14 },
  { id: "buzzer", label: "Buzzer", h: 14 },
  { id: "servo", label: "Servo", h: 34 },
  { id: "tamper", label: "Tamper", h: 46 },
];
const EVENT_NAMES = {
  DEVICE_BOOT: "Boot", ACCESS_GRANTED: "Granted", ACCESS_DENIED: "Denied", TAMPER_WARNING: "Warning",
  TAMPER_ALARM: "Alarm", SENSOR_FAULT: "Sensor fault",
};

export class Timeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.window = 12000;
    this.reset();
  }

  reset() {
    this.levels = {};    // pin -> [[ms, level], ...]
    this.servo = [];     // [ms, degrees commanded]
    this.arm = [];       // [ms, degrees the horn really is at]
    this.samples = [];   // [ms, deviation g, over count, armed]
    this.events = [];    // { ms, text }
    this.partial = "";   // a serial line that hasn't ended yet
  }

  setup(config) {
    this.pins = config.pins;
    this.seen = config.seen;
    const v = Object.fromEntries(config.values.map((x) => [x.id, x.value]));
    this.threshold = v.thresholdG;
  }

  add(log, nowMs, armAngle) {
    for (const [ms, pin, level] of log.edges) (this.levels[pin] ||= []).push([ms, level]);
    const { servoMinUs: lo, servoMaxUs: hi } = this.seen;
    for (const [ms, us] of log.servo) this.servo.push([ms, (us - lo) / (hi - lo) * 180]);
    this.samples.push(...log.samples);
    // The Uno prints its events: "[event] t+12s ACCESS_DENIED (LOW) card=... reason=NOT_LISTED".
    // The line only has whole seconds, so it's placed at the end of the step that printed it
    // (at most one animation frame late).
    const lines = (this.partial + (log.serial || "")).split("\n");
    this.partial = lines.pop();
    for (const line of lines) {
      const m = line.match(/^\[event\] t\+\d+s (\w+) \(\w+\)(.*)$/);
      if (!m) continue;
      const reason = m[2].match(/reason=(\w+)/)?.[1];
      this.events.push({ ms: nowMs, text: (EVENT_NAMES[m[1]] || m[1]) + (reason ? ` ${reason}` : ""), type: m[1] });
    }
    if (armAngle !== null) this.arm.push([nowMs, armAngle]);
    const cut = nowMs - this.window * 2;
    for (const k of Object.keys(this.levels)) prune(this.levels[k], cut, true);
    prune(this.servo, cut, true);
    prune(this.arm, cut);
    prune(this.samples, cut);
    this.events = this.events.filter((e) => e.ms >= cut);
  }

  draw(now) {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || !this.pins) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const left = 86, right = w - 12;
    const t0 = now - this.window;
    const X = (ms) => left + (ms - t0) / this.window * (right - left);
    g.font = "500 11px Hanken Grotesk, system-ui, sans-serif";
    g.textBaseline = "middle";

    // second ticks
    g.fillStyle = C.grid;
    for (let s = Math.ceil(t0 / 1000) * 1000; s <= now; s += 1000) g.fillRect(X(s), 6, 1, h - 12);

    let y = 6;
    const lanes = {};
    for (const r of ROWS) {
      lanes[r.id] = { y, h: r.h };
      g.fillStyle = C.muted;
      g.textAlign = "left";
      g.fillText(r.label, 8, y + r.h / 2);
      if (r.id !== "events") {
        g.fillStyle = C.lane;
        g.fillRect(left, y, right - left, r.h);
      }
      y += r.h + 6;
    }

    // GPIO pins: filled where the pin is high
    const pinRow = (id, pin, color) => {
      const L = lanes[id], pts = this.levels[pin] || [];
      g.fillStyle = color;
      let level = 0, from = t0;
      for (const [ms, lv] of pts) {
        if (ms > now) break;
        if (level && ms > t0) g.fillRect(X(Math.max(from, t0)), L.y + 2, Math.max(1, X(ms) - X(Math.max(from, t0))), L.h - 4);
        level = lv;
        from = ms;
      }
      if (level) g.fillRect(X(Math.max(from, t0)), L.y + 2, Math.max(1, X(now) - X(Math.max(from, t0))), L.h - 4);
    };
    pinRow("green", this.pins.green, C.green);
    pinRow("red", this.pins.red, C.red);
    pinRow("buzzer", this.pins.buzzer, C.buzz);

    // Servo: commanded angle (solid) and where the horn really is (dotted)
    const S = lanes.servo;
    const sy = (deg) => S.y + S.h - 3 - (deg / 180) * (S.h - 6);
    stepLine(g, this.servo, t0, now, X, sy, C.accent, 2);
    g.setLineDash([2, 3]);
    line(g, this.arm, t0, X, sy, C.ink, 1.2);
    g.setLineDash([]);

    // Tamper: deviation from the baseline vs the threshold; hatched while disarmed
    const T = lanes.tamper, top = Math.max(1, this.threshold * 2.2);
    const ty = (v) => T.y + T.h - 2 - Math.min(1, v / top) * (T.h - 4);
    g.fillStyle = "rgba(158,143,151,0.18)";
    let start = null;
    for (const [ms, , , armed] of this.samples) {
      if (ms < t0) continue;
      if (!armed && start === null) start = ms;
      if (armed && start !== null) { g.fillRect(X(start), T.y, X(ms) - X(start), T.h); start = null; }
    }
    if (start !== null) g.fillRect(X(start), T.y, X(now) - X(start), T.h);
    g.strokeStyle = C.warn;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(left, ty(this.threshold));
    g.lineTo(right, ty(this.threshold));
    g.stroke();
    g.setLineDash([]);
    line(g, this.samples, t0, X, ty, C.ink, 1.3);

    // Events, newest on top where they overlap
    const E = lanes.events;
    g.textAlign = "left";
    let lastX = -1e9;
    for (const e of this.events) {
      if (e.ms < t0 || e.ms > now) continue;
      const x = X(e.ms);
      const color = e.type === "TAMPER_ALARM" || e.type === "ACCESS_DENIED" ? C.red
        : e.type === "TAMPER_WARNING" || e.type === "SENSOR_FAULT" ? C.warn : e.type === "ACCESS_GRANTED" ? C.green : C.muted;
      g.fillStyle = color;
      g.fillRect(x, E.y + 2, 2, h - E.y - 8);
      if (x - lastX > 60) {
        g.fillText(e.text, x + 5, E.y + E.h / 2);
        lastX = x + g.measureText(e.text).width;
      }
    }
  }
}

/** Drops points older than `cut` (optionally keeping the last one before it). */
function prune(list, cut, keepOneBefore = false) {
  let i = 0;
  while (i < list.length && list[i][0] < cut) i++;
  if (keepOneBefore && i > 0) i--;  // the value in force at the start of the window
  if (i > 0) list.splice(0, i);
}

/** Draws on/off or level values as a step line (holds each value until the next). */
function stepLine(g, pts, t0, now, X, Y, color, width) {
  if (!pts.length) return;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  let started = false, last = null;
  for (const [ms, v] of pts) {
    if (ms > now) break;
    const x = X(Math.max(ms, t0));
    if (!started) { g.moveTo(x, Y(v)); started = true; } else { g.lineTo(x, Y(last)); g.lineTo(x, Y(v)); }
    last = v;
  }
  if (started) g.lineTo(X(now), Y(last));
  g.stroke();
}

/** Draws values as a plain line through the points (servo horn angle, accelerometer samples). */
function line(g, pts, t0, X, Y, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  let started = false;
  for (const p of pts) {
    if (p[0] < t0) continue;
    if (!started) { g.moveTo(X(p[0]), Y(p[1])); started = true; } else g.lineTo(X(p[0]), Y(p[1]));
  }
  g.stroke();
}
