// Customer app building blocks: drawn icons, buttons, list rows, toast, sound.
import { h, s } from "../../js/dom.js";

// ---------- icons: authored SVG, one stroke weight (no emoji, no Unicode glyphs) ----------

const PATHS = {
  racks: ["M4.5 19v-7.5a3.25 3.25 0 0 1 6.5 0V19", "M13 19v-7.5a3.25 3.25 0 0 1 6.5 0V19", "M2.5 19h19"],
  card: ["M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z", "M3 10.5h18", "M7 15h4"],
  alerts: ["M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2.2H4.2z", "M9.8 21a2.4 2.4 0 0 0 4.4 0", "M12 3v2"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  health: ["M3 12h4l2.5-6 5 12 2.5-6H21"],
  back: ["M15 5l-7 7 7 7"],
  unlock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 6.6-1.6"],
  blocked: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", "M6 6l12 12"],
  siren: ["M7 17v-4.5a5 5 0 0 1 10 0V17", "M5 17h14v3.5H5z", "M12 2.5v2", "M4.6 6l1.4 1.4", "M19.4 6l-1.4 1.4"],
  check: ["M5 12.5l4.2 4.2L19 7"],
  tap: ["M7 4h10v16H7z", "M10 17h4", "M19.5 8.5a6 6 0 0 1 0 7", "M21.8 6.5a9 9 0 0 1 0 11"],
  signal: ["M5 19V15", "M10 19v-7", "M15 19V9", "M20 19V5"],
  person: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20a7.5 7.5 0 0 1 15 0"],
};

export function icon(name, label) {
  return s("svg", {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75",
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": label ? null : "true", role: label ? "img" : null, "aria-label": label || null,
  }, (PATHS[name] || []).map((d) => s("path", { d })));
}

// ---------- controls ----------

export function button(label, onClick, { kind = "", small = false, iconName, disabled, type = "button" } = {}) {
  return h("button", { type, class: `btn${kind ? ` btn-${kind}` : ""}${small ? " btn-small" : ""}`, onClick, disabled },
    iconName ? icon(iconName) : null, label);
}

/** A list row. `onClick` makes it a button. */
export function row({ lead, title, sub, side, sideSub, onClick, selected, label }) {
  const tag = onClick ? "button" : "div";
  return h(tag, { class: `row${selected ? " selected" : ""}`, type: onClick ? "button" : null, onClick, "aria-label": label || null },
    lead || h("span"),
    h("span", { class: "row-main" }, h("span", { class: "title" }, title), sub ? h("span", { class: "small muted" }, sub) : null),
    side !== undefined || sideSub ? h("span", { class: "row-side" }, side, sideSub ? h("span", { class: "small faint" }, sideSub) : null) : h("span"));
}

export function switchControl(label, checked, onChange) {
  const el = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(checked), onClick: () => {
    const next = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", String(next));
    onChange(next);
  } }, h("span", {}, label), h("span", { class: "switch-track", "aria-hidden": "true" }));
  return el;
}

let toastTimer = null;
export function toast(text) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = h("div", { class: "toast", role: "status" }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 240); }, 2600);
}

// ---------- sound: tiny chirps that mirror the rack's buzzer ----------

let ctx = null;
const soundOn = () => localStorage.getItem("hbr.app.sound") !== "off";
export const sound = {
  get enabled() { return soundOn(); },
  set enabled(v) { localStorage.setItem("hbr.app.sound", v ? "on" : "off"); },
  beep(times, freq, ms) {
    if (!soundOn()) return;
    try {
      ctx = ctx || new AudioContext();
      const now = ctx.currentTime;
      for (let i = 0; i < times; i++) {
        const t = now + i * (ms + 90) / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        // Short attack and release so it clicks less than a raw square buzzer.
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.16, t + 0.008);
        gain.gain.setValueAtTime(0.16, t + ms / 1000 - 0.03);
        gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + ms / 1000 + 0.02);
      }
    } catch { /* no audio: stay silent */ }
  },
  granted() { this.beep(1, 1568, 130); },   // one short high beep, like the rack
  denied() { this.beep(2, 440, 150); },     // two low beeps
};

// ---------- words ----------

export const STATUS_WORD = { ONLINE: "Ready", WARNING: "Alert", OFFLINE: "Offline", UNKNOWN: "Not Installed" };
export const STATUS_CLASS = { ONLINE: "positive", WARNING: "warning", OFFLINE: "faint", UNKNOWN: "faint" };

/** Rack status -> rack.riv state: 0 idle, 3 alarm, 4 offline. */
export function sceneState(rack, devices = []) {
  if (rack.status === "OFFLINE" || rack.status === "UNKNOWN") return 4;
  if (devices.some((d) => d.online && d.lastHeartbeat && d.lastHeartbeat.alarmActive)) return 3;
  return 0;
}
