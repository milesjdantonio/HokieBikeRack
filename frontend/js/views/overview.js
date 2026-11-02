// Overview page: the "is everything OK?" screen. Auto-refreshes every 10 s.
import { api } from "../api.js";
import { badge, clear, errorBox, formatTime, h, loading, panel, relativeTime, shortRef, statusBadge,
  toast } from "../ui.js";
import { openRegisterDialog } from "./cards.js";
import { eventTable } from "./events.js";
import { pulseStatus, riveIcon } from "../rive.js";

function metric(label, value, hint, kind = "") {
  return h("article", { class: `metric-card ${kind}` },
    h("h3", {}, label), h("p", { class: "metric" }, String(value)), hint ? h("p", { class: "muted small-text" }, hint) : null);
}

function rackCard(rack, ctx, refresh) {
  return h("article", { class: `rack-card status-${rack.status.toLowerCase()}` },
    h("div", { class: "rack-card-head" },
      h("h3", { class: "rack-card-title" },
        riveIcon("pulse", { size: 22, inputs: { status: pulseStatus(rack.status) }, label: rack.status.toLowerCase() }).el,
        h("a", { href: `#racks?rackId=${rack.id}` }, rack.name)),
      h("span", { class: "rack-card-badges" },
        rack.openAlerts ? riveIcon("alarm", { size: 30, inputs: { active: true }, label: "open tamper or sensor alerts" }).el : null,
        statusBadge(rack.status))),
    h("p", { class: "muted small-text" }, rack.locationDescription || "No location set"),
    h("dl", { class: "facts" },
      h("dt", {}, "Devices online"), h("dd", {}, `${rack.onlineDeviceCount} / ${rack.deviceCount}`),
      h("dt", {}, "Last heard"), h("dd", {}, relativeTime(rack.lastSeenAt)),
      h("dt", {}, "Open alerts"), h("dd", {}, rack.openAlerts ? badge(String(rack.openAlerts), "warn") : "0")),
    rack.sensorFault ? h("p", { class: "warn-text small-text" }, "A sensor on this rack isn't responding.") : null,
    h("div", { class: "rack-card-actions" },
      h("a", { class: "button-link ghost small", href: `#events?rackId=${rack.id}` }, "Events"),
      rack.openAlerts && ctx.canEdit ? h("button", { class: "small secondary", type: "button", onClick: async () => {
        try {
          const r = await api(`/events/acknowledge-rack/${rack.id}`, { method: "POST" });
          toast(`${r.acknowledged} alert(s) marked handled`, "ok");
          refresh();
        } catch (err) { toast(err.message, "error"); }
      } }, "Acknowledge alerts") : null));
}

export function render(container, ctx) {
  const metrics = h("section", { class: "summary" }, loading());
  const racksBox = h("div", { class: "rack-grid" });
  const unknownBox = h("div", {});
  const eventsBox = h("div", {}, loading());

  container.append(
    h("section", { class: "intro" }, h("h2", {}, "Rack overview"),
      h("p", { class: "muted" }, "Live status of every rack. Updates every 10 seconds.")),
    metrics,
    panel("Racks", "Green = online, amber = needs attention, grey = no recent contact.",
      ctx.canEdit ? h("a", { class: "button-link small", href: "#racks" }, "Manage racks") : null, racksBox),
    unknownBox,
    panel("Recent events", "Newest first.", h("a", { class: "button-link ghost small", href: "#events" }, "All events"), eventsBox));

  async function load() {
    try {
      const [racks, events, unknown, credentials] = await Promise.all([
        api("/racks"), api("/events", { query: { size: 12 } }), api("/credentials/unknown"), api("/credentials")]);
      const online = racks.reduce((n, r) => n + r.onlineDeviceCount, 0);
      const devices = racks.reduce((n, r) => n + r.deviceCount, 0);
      const alerts = racks.reduce((n, r) => n + r.openAlerts, 0);
      const activeCards = credentials.filter((c) => c.status === "ACTIVE").length;
      clear(metrics).append(
        metric("Racks", racks.length, `${racks.filter((r) => r.status === "ONLINE").length} fully OK`),
        metric("Devices online", `${online}/${devices}`, devices ? "heard from in the last 3 min" : "add a device on the Racks page"),
        metric("Open alerts", alerts, "tamper + sensor, last 24 h", alerts ? "metric-warn" : ""),
        metric("Active cards", activeCards, `${unknown.length} unknown tap(s) waiting`));

      clear(racksBox).append(...(racks.length ? racks.map((r) => rackCard(r, ctx, load))
        : [h("p", { class: "muted" }, "No racks yet. ", ctx.canEdit ? h("a", { href: "#racks" }, "Create the first one.") : "")]));

      clear(unknownBox);
      if (unknown.length) {
        unknownBox.append(panel("Unknown cards tapped", "Someone tapped a card that isn't registered. Register it to let it in.", null,
          h("ul", { class: "unknown-list" }, unknown.map((u) => h("li", {},
            h("div", {}, h("code", { title: u.credentialReference }, shortRef(u.credentialReference)),
              h("span", { class: "muted" }, ` · ${u.attempts} tap(s) · last ${relativeTime(u.lastSeenAt)} at ${u.lastRackName || "?"}`)),
            ctx.canEdit ? h("button", { class: "small", type: "button",
              onClick: () => openRegisterDialog(ctx, { credentialReference: u.credentialReference, rackId: u.lastRackId }, load) },
            "Register") : null)))));
      }
      clear(eventsBox).append(eventTable(events.items, ctx, load));
      ctx.markUpdated();
    } catch (err) {
      ctx.markError();
      clear(eventsBox).append(errorBox(err, load));
    }
  }

  load();
  const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 10000);
  return { cleanup: () => clearInterval(timer) };
}

export { formatTime };
