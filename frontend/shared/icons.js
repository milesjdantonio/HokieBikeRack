// Drawn icons for every version: authored SVG paths, one stroke weight (no emoji or Unicode glyphs).
// icon("racks") is a bike (Miles: racks show as a bike).
import { s } from "../js/dom.js";

const PATHS = {
  // A bike (Miles: rack icons should be a bike): two wheels, frame, saddle, bars.
  racks: ["M2 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0", "M15 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0",
    "M5.5 16.5 9.5 9.5h6l3 7", "M5.5 16.5H12l3.5-7", "M9.5 9.5 12 16.5", "M8 7.5h3.5", "M15.5 9.5 15 7h2.5"],
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
