// Events page: filterable, paged list of everything the racks reported.
import { api } from "../api.js";
import { badge, clear, emptyRow, errorBox, eventName, eventSummary, formatTime, h, loading, panel,
  relativeTime, severityBadge, shortRef, toast } from "../ui.js";
import { openRegisterDialog } from "./cards.js";

/** One table row for an event. Used here and on the Overview page. */
export function eventRow(e, ctx, onChange) {
  const isAlert = ["MEDIUM", "HIGH", "CRITICAL"].includes(e.severity);
  const unknownCard = e.eventType === "ACCESS_DENIED" && e.credentialReference && !e.credentialId;

  let cardCell = "—";
  if (e.credentialLabel) cardCell = h("span", { title: e.credentialReference }, e.credentialLabel);
  else if (e.credentialReference) cardCell = h("code", { title: e.credentialReference }, shortRef(e.credentialReference));

  const actions = [];
  if (unknownCard && ctx.canEdit) {
    actions.push(h("button", { class: "small", type: "button",
      onClick: () => openRegisterDialog(ctx, { credentialReference: e.credentialReference, rackId: e.rackId }, onChange) },
    "Register card"));
  }
  if (isAlert && !e.acknowledgedAt && ctx.canEdit) {
    actions.push(h("button", { class: "small secondary", type: "button", onClick: async () => {
      try {
        await api(`/events/${e.id}/acknowledge`, { method: "POST" });
        toast("Marked as handled", "ok");
        onChange();
      } catch (err) { toast(err.message, "error"); }
    } }, "Acknowledge"));
  }
  let status;
  if (e.acknowledgedAt) status = h("span", { class: "muted", title: `by ${e.acknowledgedBy}` }, "handled");
  else if (isAlert) status = badge("needs review", "warn");
  else status = h("span", { class: "muted" }, "recorded");

  return h("tr", { class: isAlert && !e.acknowledgedAt ? "row-alert" : "" },
    h("td", { title: `${e.occurredAt}${e.timeSource === "SERVER" ? " (rack clock not set: server receive time)" : ""}` },
      formatTime(e.occurredAt), e.timeSource === "SERVER" ? h("span", { class: "muted" }, " *") : null),
    h("td", {}, e.rackName || "—"),
    h("td", {}, h("strong", {}, eventName(e.eventType)), e.simulated ? badge("SIM", "info") : null,
      h("div", { class: "muted small-text" }, eventSummary(e))),
    h("td", {}, severityBadge(e.severity)),
    h("td", {}, cardCell),
    h("td", {}, status),
    h("td", { class: "actions-cell" }, actions));
}

export function eventTable(items, ctx, onChange) {
  return h("div", { class: "table-wrap" },
    h("table", {},
      h("thead", {}, h("tr", {}, ["Time", "Rack", "Event", "Severity", "Card", "Status", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, items.length ? items.map((e) => eventRow(e, ctx, onChange))
        : emptyRow(7, "No events yet. Tap a card on a rack, or run tools/device_simulator.py."))));
}

export function render(container, ctx) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const filters = { rackId: params.get("rackId") || "", severity: "", type: params.get("type") || "", unacknowledged: false };
  let page = 0;
  const size = 50;
  let timer = null;

  const rackSelect = h("select", { "aria-label": "Rack" }, h("option", { value: "" }, "All racks"));
  const severitySelect = h("select", { "aria-label": "Severity" },
    h("option", { value: "" }, "Any severity"),
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => h("option", { value: s }, s)));
  const typeSelect = h("select", { "aria-label": "Event type" },
    h("option", { value: "" }, "All types"),
    h("option", { value: "ACCESS" }, "Access (granted + denied)"),
    h("option", { value: "ACCESS_DENIED" }, "Access denied"),
    h("option", { value: "TAMPER" }, "Tamper"),
    h("option", { value: "SENSOR" }, "Sensor problems"),
    h("option", { value: "DEVICE" }, "Device starts"));
  typeSelect.value = filters.type;
  const unackBox = h("input", { type: "checkbox" });
  const body = h("div", {}, loading());
  const pager = h("div", { class: "pager" });

  api("/racks").then((racks) => {
    for (const r of racks) rackSelect.append(h("option", { value: r.id }, r.name));
    rackSelect.value = filters.rackId;
  }).catch(() => {});

  const onFilter = () => {
    filters.rackId = rackSelect.value;
    filters.severity = severitySelect.value;
    filters.type = typeSelect.value;
    filters.unacknowledged = unackBox.checked;
    page = 0;
    load();
  };
  for (const el of [rackSelect, severitySelect, typeSelect, unackBox]) el.addEventListener("change", onFilter);

  async function load() {
    try {
      const data = await api("/events", { query: {
        rackId: filters.rackId, severity: filters.severity, type: filters.type,
        unacknowledged: filters.unacknowledged || undefined, page, size } });
      clear(body).append(eventTable(data.items, ctx, load));
      const pages = Math.max(1, Math.ceil(data.total / size));
      clear(pager).append(
        h("button", { class: "ghost small", type: "button", disabled: page === 0, onClick: () => { page--; load(); } }, "← Newer"),
        h("span", { class: "muted" }, `Page ${page + 1} of ${pages} · ${data.total} events`),
        h("button", { class: "ghost small", type: "button", disabled: page + 1 >= pages, onClick: () => { page++; load(); } }, "Older →"));
      ctx.markUpdated();
    } catch (err) {
      ctx.markError();
      clear(body).append(errorBox(err, load));
    }
  }

  container.append(panel("Security events", "Everything the racks reported. * = rack clock wasn't set, so the time is when the server received it.",
    null,
    h("div", { class: "filters" },
      rackSelect, severitySelect, typeSelect,
      h("label", { class: "checkbox" }, unackBox, " Needs review only")),
    body, pager));
  load();
  // Refresh every 10 s, but only on the first page (so paging doesn't jump).
  timer = setInterval(() => { if (page === 0 && document.visibilityState === "visible") load(); }, 10000);
  return { cleanup: () => clearInterval(timer) };
}

export { relativeTime };
