// Small UI helpers shared by every page.
//
// h("button", { class: "x", onClick: fn }, "Save") builds a real DOM element.
// All text goes in with textContent/append, NEVER innerHTML, so a card label
// like "<script>" shows up as text instead of running. (That's how we avoid
// cross-site scripting, XSS.)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value") el.value = value;
    else if (key === "checked") el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
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

// ---------- formatting ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeSecFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `Today ${timeSecFmt.format(d)}` : timeFmt.format(d);
}

export function relativeTime(iso) {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** First characters of a credential reference: enough to recognise, not the whole thing. */
export function shortRef(ref) {
  return ref ? `${ref.slice(0, 10)}…` : "—";
}

export const EVENT_NAMES = {
  ACCESS_GRANTED: "Access granted",
  ACCESS_DENIED: "Access denied",
  TAMPER_WARNING: "Tamper warning",
  TAMPER_ALARM: "Tamper ALARM",
  SENSOR_FAULT: "Sensor problem",
  DEVICE_BOOT: "Device started",
};

export const DENY_REASONS = {
  NOT_LISTED: "card not registered here",
  NO_SNAPSHOT: "rack has no card list yet",
  CLOCK_NOT_SET: "rack clock not set yet",
  SNAPSHOT_EXPIRED: "rack offline over 72 h",
};

/** One-line human summary of an event's details. */
export function eventSummary(e) {
  const d = e.details || {};
  switch (e.eventType) {
    case "ACCESS_DENIED": return DENY_REASONS[d.reason] || d.reason || "";
    case "TAMPER_WARNING":
    case "TAMPER_ALARM": return d.deviationG != null ? `jolt ${Number(d.deviationG).toFixed(2)} g` : "";
    case "SENSOR_FAULT": return [d.sensor, (d.state || "").replaceAll("_", " ").toLowerCase()].filter(Boolean).join(": ");
    case "DEVICE_BOOT": return d.resetReason ? `reset: ${d.resetReason.replaceAll("_", " ").toLowerCase()}` : "";
    default: return "";
  }
}

export function eventName(type) {
  return EVENT_NAMES[type] || type.replaceAll("_", " ").toLowerCase();
}

// ---------- small components ----------

export function badge(text, kind = "neutral") {
  return h("span", { class: `badge badge-${kind}` }, text);
}

export function severityBadge(severity) {
  const kind = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warn", LOW: "info", INFO: "neutral" }[severity] || "neutral";
  return badge(severity, kind);
}

export function statusBadge(status) {
  const kind = { ONLINE: "ok", OFFLINE: "muted", WARNING: "warn", UNKNOWN: "muted",
    ACTIVE: "ok", REVOKED: "danger", DISABLED: "muted", EXPIRED: "muted", NOT_YET_VALID: "info" }[status] || "neutral";
  return badge(status.replaceAll("_", " "), kind);
}

export function toast(message, kind = "info") {
  const el = h("div", { class: `toast toast-${kind}`, role: "status" }, message);
  document.querySelector("#toasts").append(el);
  setTimeout(() => el.classList.add("leaving"), 3500);
  setTimeout(() => el.remove(), 4000);
}

/** A panel with a heading row (title + optional actions) and body. */
export function panel(title, subtitle, actions, ...body) {
  return h("section", { class: "panel" },
    h("div", { class: "panel-heading" },
      h("div", {}, h("h2", {}, title), subtitle ? h("p", {}, subtitle) : null),
      actions ? h("div", { class: "panel-actions" }, actions) : null),
    ...body);
}

export function emptyRow(colspan, text) {
  return h("tr", {}, h("td", { colspan, class: "empty" }, text));
}

export function loading(text = "Loading…") {
  return h("p", { class: "loading" }, text);
}

export function errorBox(err, retry) {
  return h("div", { class: "error-box", role: "alert" },
    h("strong", {}, "Something went wrong. "), err.message || String(err),
    retry ? h("button", { class: "ghost small", type: "button", onClick: retry }, "Try again") : null);
}

/**
 * Modal dialog. Returns { close, root }. Closes on Escape or the backdrop.
 * `body` can be any nodes; `actions` a list of buttons.
 */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const previouslyFocused = document.activeElement;
  const close = () => {
    root.remove();
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const dialog = h("div", { class: `modal${wide ? " modal-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-head" }, h("h2", {}, title),
      h("button", { class: "ghost icon", type: "button", "aria-label": "Close", onClick: close }, "✕")),
    h("div", { class: "modal-body" }, body),
    actions.length ? h("div", { class: "modal-actions" }, actions) : null);
  const root = h("div", { class: "backdrop", onClick: (e) => { if (e.target === root) close(); } }, dialog);
  document.body.append(root);
  document.addEventListener("keydown", onKey);
  const focusable = dialog.querySelector("input, select, textarea, button:not(.icon)");
  (focusable || dialog.querySelector("button")).focus();
  return { close, root };
}

export function confirmDialog(title, message, confirmLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title,
      body: h("p", {}, message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        h("button", { class: "ghost", type: "button", onClick: () => m.close() }, "Cancel"),
        h("button", { class: danger ? "danger" : "", type: "button",
          onClick: () => { answered = true; m.close(); resolve(true); } }, confirmLabel),
      ],
    });
  });
}

/** Copy text to the clipboard with a fallback for older browsers / http pages. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { class: "offscreen" }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied", "ok");
}
