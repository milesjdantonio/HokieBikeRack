// Reports page: counts over the last N days, drawn as simple CSS bars.
import { api } from "../api.js";
import { clear, DENY_REASONS, emptyRow, errorBox, eventName, h, loading, panel } from "../ui.js";

/** Horizontal bar list: [{label, value}] -> rows with a bar scaled to the max. */
function bars(rows, kind = "") {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return h("p", { class: "muted" }, "No data in this period.");
  return h("ul", { class: "bars" }, rows.map((r) => {
    const fill = h("span", { class: `bar-fill ${kind}` });
    fill.style.width = `${Math.round((r.value / max) * 100)}%`;  // CSSOM style is allowed by our CSP
    return h("li", {}, h("span", { class: "bar-label" }, r.label), h("span", { class: "bar-track" }, fill),
      h("span", { class: "bar-value" }, String(r.value)));
  }));
}

export function render(container, ctx) {
  const daysSelect = h("select", { "aria-label": "Period" },
    h("option", { value: "1" }, "Last 24 hours"), h("option", { value: "7" }, "Last 7 days"), h("option", { value: "30" }, "Last 30 days"));
  daysSelect.value = "7";
  const body = h("div", {}, loading());

  async function load() {
    try {
      const r = await api("/reports/summary", { query: { days: daysSelect.value } });
      const total = Object.values(r.byType).reduce((a, b) => a + b, 0);
      clear(body).append(
        h("section", { class: "summary" },
          h("article", { class: "metric-card" }, h("h3", {}, "Events"), h("p", { class: "metric" }, String(total))),
          h("article", { class: "metric-card" }, h("h3", {}, "Unlocks"), h("p", { class: "metric" }, String(r.byType.ACCESS_GRANTED || 0))),
          h("article", { class: "metric-card" }, h("h3", {}, "Denied taps"), h("p", { class: "metric" }, String(r.byType.ACCESS_DENIED || 0))),
          h("article", { class: "metric-card" }, h("h3", {}, "Tamper events"),
            h("p", { class: "metric" }, String((r.byType.TAMPER_WARNING || 0) + (r.byType.TAMPER_ALARM || 0))))),
        h("div", { class: "two-col" },
          panel("By event type", null, null, bars(Object.entries(r.byType).map(([k, v]) => ({ label: eventName(k), value: v })))),
          panel("Why taps were denied", null, null,
            bars(Object.entries(r.deniedReasons).map(([k, v]) => ({ label: DENY_REASONS[k] || k, value: v })), "bar-warn"))),
        panel("Per day", `Days in ${r.timeZone} time.`, null, h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ["Day", "Unlocks", "Denied", "Tamper"].map((t) => h("th", {}, t)))),
          h("tbody", {}, r.byDay.length ? r.byDay.map((d) => h("tr", {},
            h("td", {}, d.day), h("td", {}, String(d.granted)), h("td", {}, String(d.denied)), h("td", {}, String(d.tamper))))
            : emptyRow(4, "No events in this period."))))),
        panel("Per rack", null, null, h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ["Rack", "Unlocks", "Denied", "Tamper", "Sensor problems"].map((t) => h("th", {}, t)))),
          h("tbody", {}, r.byRack.length ? r.byRack.map((x) => h("tr", {},
            h("td", {}, x.rackName), h("td", {}, String(x.granted)), h("td", {}, String(x.denied)),
            h("td", {}, String(x.tamper)), h("td", {}, String(x.faults))))
            : emptyRow(5, "No racks."))))));
      ctx.markUpdated();
    } catch (err) {
      clear(body).append(errorBox(err, load));
    }
  }
  daysSelect.addEventListener("change", load);
  container.append(h("section", { class: "intro row-between" }, h("h2", {}, "Reports"), daysSelect), body);
  load();
  return null;
}
