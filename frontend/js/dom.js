// Small DOM and formatting helpers shared by the admin terminal and the customer app.
//
// h("button", { class: "x", onClick: fn }, "Save") builds a real element. Text always goes in as
// text (append), never as HTML, so a card named "<script>" is shown, not run (no XSS).

const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** Same as h() for SVG elements (icons). */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value") el.value = value;
    else if (key === "checked") el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Replaces an element's children only if the content changed (avoids flicker on refresh). */
export function renderIfChanged(el, signature, build) {
  if (el.dataset.sig === signature) return false;
  el.dataset.sig = signature;
  el.replaceChildren(...[build()].flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  return true;
}

// ---------- time ----------

export function ago(iso) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "Today 4:31 PM" / "Nov 1, 4:31 PM". */
export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `Today ${time}`;
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** 24-hour clock for the terminal: "16:31:02". */
export function clock(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "11-02 16:31" for terminal tables. */
export function stamp(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** First characters of a credential reference: enough to recognise, not the whole thing. */
export function shortRef(ref, n = 10) {
  return ref ? ref.slice(0, n) : "";
}

export const DENY_REASONS = {
  NOT_LISTED: "not registered here",
  NO_SNAPSHOT: "rack had no card list yet",
  CLOCK_NOT_SET: "rack clock not set",
  SNAPSHOT_EXPIRED: "rack offline too long",
};
