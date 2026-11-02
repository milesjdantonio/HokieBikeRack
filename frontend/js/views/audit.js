// Audit log page: every admin change, newest first.
import { api } from "../api.js";
import { clear, emptyRow, errorBox, formatTime, h, loading, panel } from "../ui.js";

function describe(details) {
  if (!details) return "";
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length + " item(s)" : v}`)
    .join(" · ");
}

export function render(container, ctx) {
  const body = h("div", {}, loading());
  const pager = h("div", { class: "pager" });
  let page = 0;
  const size = 50;

  async function load() {
    try {
      const data = await api("/audit-log", { query: { page, size } });
      clear(body).append(h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Time", "Who", "Action", "Target", "Details"].map((t) => h("th", {}, t)))),
        h("tbody", {}, data.items.length ? data.items.map((a) => h("tr", {},
          h("td", { title: a.createdAt }, formatTime(a.createdAt)),
          h("td", {}, a.actor),
          h("td", {}, h("code", {}, a.action)),
          h("td", {}, a.targetType ? `${a.targetType.toLowerCase()} ${String(a.targetId || "").slice(0, 8)}` : "—"),
          h("td", { class: "muted small-text wrap" }, describe(a.details))))
          : emptyRow(5, "No admin changes yet.")))));
      const pages = Math.max(1, Math.ceil(data.total / size));
      clear(pager).append(
        h("button", { class: "ghost small", type: "button", disabled: page === 0, onClick: () => { page--; load(); } }, "← Newer"),
        h("span", { class: "muted" }, `Page ${page + 1} of ${pages}`),
        h("button", { class: "ghost small", type: "button", disabled: page + 1 >= pages, onClick: () => { page++; load(); } }, "Older →"));
      ctx.markUpdated();
    } catch (err) {
      clear(body).append(errorBox(err, load));
    }
  }
  container.append(panel("Audit log", "Who changed racks, devices and cards. Written by the backend; can't be edited from here.", null, body, pager));
  load();
  return null;
}
