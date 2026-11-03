// Staff screens: Health (map + racks), Alerts (to handle), Cards (register taps, turn cards off).
// Forms and confirmations open inline, under the row they belong to (no pop-ups).
import { api } from "../../js/api.js";
import { ago, h, renderIfChanged, shortRef, when } from "../../js/dom.js";
import { rackMap } from "./map.js";
import { placementPanel } from "./placer.js";
import { statusIcon } from "./rider.js";
import { STATUS_CLASS, STATUS_WORD, button, icon, row } from "./ui.js";

// ---------- Health ----------

export function health(el, ctx) {
  const lede = h("p", { class: "lede" });
  const mapEl = h("div");
  const list = h("div", { class: "list" }, h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
  const adding = h("div");
  let placer = null;

  // Add a rack: name it, then click the map where it stands (TerraSim-style).
  function openAdd() {
    const name = h("input", { class: "input", required: true, maxlength: 120, placeholder: "Torgersen Hall North", autocomplete: "off" });
    const where = h("input", { class: "input", maxlength: 255, placeholder: "By the bridge entrance", autocomplete: "off" });
    placer = placementPanel({
      saveLabel: "Add Rack",
      fields: [
        h("h2", { class: "title" }, "New Rack"),
        h("label", { class: "field" }, h("span", {}, "Name"), name),
        h("label", { class: "field" }, h("span", {}, "Description for riders"), where),
      ],
      onSave: async (p) => {
        if (!name.value.trim()) { name.focus(); throw new Error("Give the rack a name first."); }
        const res = await api("/racks", { method: "POST", body: { name: name.value.trim(), locationDescription: where.value.trim() || null, ...p } });
        closeAdd();
        ctx.toast("Rack added. Add its lock module in the admin console.");
        ctx.go(`#rack/${res.rack.id}`);
      },
      onCancel: closeAdd,
    });
    adding.replaceChildren(placer.el);
    addBtn.hidden = true;
    setTimeout(() => name.focus(), 0);
  }
  function closeAdd() {
    if (placer) placer.destroy();
    placer = null;
    adding.replaceChildren();
    addBtn.hidden = false;
  }
  const addBtn = ctx.canEdit ? button("Add Rack", openAdd, { small: true }) : h("span");
  addBtn.classList.add("add-rack");
  el.append(h("div", { class: "heading-row" }, h("h1", { class: "display" }, "Rack Health"), addBtn), lede, adding,
    h("div", { class: "split" }, mapEl, list));
  const map = rackMap(mapEl, { onSelect: (r) => ctx.go(`#rack/${r.id}`) });

  async function refresh() {
    const racks = await api("/racks");
    const attention = racks.filter((r) => r.status !== "ONLINE").length;
    const alerts = racks.reduce((n, r) => n + r.openAlerts, 0);
    ctx.setCount(alerts);
    lede.textContent = !racks.length ? "" : attention
      ? `${attention} of ${racks.length} ${racks.length === 1 ? "rack needs" : "racks need"} attention.`
      : `All ${racks.length} racks are online.`;
    renderIfChanged(list, JSON.stringify(racks), () => racks.length ? racks.map((r) => {
      const parts = [`${r.onlineDeviceCount} of ${r.deviceCount} online`];
      if (r.openAlerts) parts.push(`${r.openAlerts} open ${r.openAlerts === 1 ? "alert" : "alerts"}`);
      if (r.sensorFault) parts.push("a sensor isn't responding");
      if (r.latitude == null) parts.push("not on the map");
      return row({
        lead: statusIcon(r.status),
        title: r.name,
        sub: parts.join(", "),
        side: h("span", { class: STATUS_CLASS[r.status] }, r.status === "WARNING" ? "Needs Attention" : r.status === "UNCONFIRMED" ? "Confirm Online" : STATUS_WORD[r.status]),
        sideSub: r.lastSeenAt ? ago(r.lastSeenAt) : "Never",
        onClick: () => ctx.go(`#rack/${r.id}`),
      });
    }) : h("p", { class: "empty" }, ctx.canEdit ? "No racks yet. Use Add Rack to name one and click where it stands." : "No racks yet."));
    map.setRacks(racks);
  }
  refresh().catch((e) => list.replaceChildren(h("p", { class: "empty" }, e.message)));
  return { refresh, destroy: () => { map.destroy(); if (placer) placer.destroy(); } };
}

// ---------- Alerts ----------

const ALERT_TITLE = {
  TAMPER_ALARM: "Tamper alarm",
  TAMPER_WARNING: "Rack bumped",
  SENSOR_FAULT: "Sensor problem",
  DEVICE_BOOT: "Lock module restarted",
};

function alertDetail(e) {
  const d = e.details || {};
  if (e.eventType === "SENSOR_FAULT") {
    const what = d.sensor === "PN532" ? "Card reader" : d.sensor === "MPU6050" ? "Motion sensor" : "A sensor";
    return `${what} ${String(d.state || "").toLowerCase().replaceAll("_", " ")}`;
  }
  if (e.eventType === "DEVICE_BOOT" && d.resetReason === "BROWNOUT") return "Power dipped. Check the servo supply.";
  if (d.deviationG != null) return `Jolt of ${Number(d.deviationG).toFixed(2)} g`;
  return "";
}

export function alerts(el, ctx) {
  const lede = h("p", { class: "lede" });
  const list = h("div", { class: "list" }, h("div", { class: "skeleton" }));
  let items = [];
  const all = ctx.canEdit ? button("Mark All Handled", async () => {
    all.disabled = true;
    try {
      // The API marks a whole rack at a time; every rack with open alerts gets one call.
      const racks = [...new Set(items.map((e) => e.rackId).filter(Boolean))];
      await Promise.all(racks.map((id) => api(`/events/acknowledge-rack/${id}`, { method: "POST" })));
      ctx.toast(`${items.length} marked handled`);
      await refresh();
    } catch (e) { ctx.toast(e.message); }
    all.disabled = false;
  }, { kind: "primary", small: true, iconName: "check" }) : h("span");
  all.hidden = true;
  el.append(h("div", { class: "heading-row" }, h("h1", { class: "display" }, "Alerts"), all), lede, list);

  async function refresh() {
    const data = await api("/events", { query: { unacknowledged: true, size: 60 } });
    items = data.items.filter((e) => ["MEDIUM", "HIGH", "CRITICAL"].includes(e.severity));
    ctx.setCount(items.length);
    all.hidden = items.length < 2;
    lede.textContent = items.length ? `${items.length} to look at.` : "";
    renderIfChanged(list, JSON.stringify([items.map((e) => e.id), ctx.canEdit]), () => items.length ? items.map((e) => {
      const high = e.severity !== "MEDIUM";
      const handle = ctx.canEdit ? button("Handled", async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await api(`/events/${e.id}/acknowledge`, { method: "POST" });
          ctx.toast("Marked handled");
          refresh();
        } catch (err) { ctx.toast(err.message); }
      }, { small: true, iconName: "check" }) : null;
      return row({
        lead: h("span", { class: `row-icon ${high ? "negative" : "warning"}` }, icon(e.eventType.startsWith("TAMPER") ? "siren" : "signal")),
        title: ALERT_TITLE[e.eventType] || e.eventType,
        sub: [e.rackName || "Unknown rack", when(e.occurredAt), alertDetail(e)].filter(Boolean).join(", "),
        side: handle || h("span", { class: "small muted" }, ago(e.occurredAt)),
      });
    }) : h("p", { class: "empty" }, "Nothing to look at. Tamper alarms and sensor problems show up here."));
  }
  refresh().catch((e) => list.replaceChildren(h("p", { class: "empty" }, e.message)));
  return { refresh };
}

// ---------- Cards ----------

export function cards(el, ctx) {
  const waiting = h("div");
  const registered = h("div");
  const state = { registering: null, open: null, confirming: null, filter: "" };
  const filter = h("input", { class: "input filter-input", type: "search", placeholder: "Find a card by name", "aria-label": "Find a card by name",
    autocomplete: "off", onInput: () => { state.filter = filter.value.trim().toLowerCase(); refresh(); } });
  filter.hidden = true;
  el.append(h("h1", { class: "display" }, "Cards"),
    h("div", { class: "block" }, h("h2", {}, "Waiting to Register"), waiting),
    h("div", { class: "block" }, h("h2", {}, "Registered"), filter, registered));
  let racks = [];

  function registerForm(u) {
    const name = h("input", { class: "input", required: true, maxlength: 120, placeholder: "Name on the card", autocomplete: "off" });
    const all = h("input", { type: "checkbox" });
    const picks = racks.map((r) => ({ r, box: h("input", { type: "checkbox", checked: r.id === u.lastRackId }) }));
    const err = h("p", { class: "form-error", role: "alert" });
    const form = h("form", { class: "form", onSubmit: async (e) => {
      e.preventDefault();
      try {
        await api("/credentials", { method: "POST", body: {
          credentialReference: u.credentialReference, displayLabel: name.value.trim(), allRacks: all.checked,
          rackIds: picks.filter((p) => p.box.checked).map((p) => p.r.id),
        } });
        state.registering = null;
        ctx.toast(`${name.value.trim()} can use it within a minute`);
        refresh();
      } catch (ex) { err.textContent = ex.message; }
    } },
    h("label", { class: "field" }, h("span", {}, "Name"), name),
    h("div", { class: "field" }, h("span", {}, "Works at"), h("div", { class: "choices" },
      h("label", { class: "choice" }, all, h("span", {}, "Every Rack")),
      picks.map((p) => h("label", { class: "choice" }, p.box, h("span", {}, p.r.name))))),
    err,
    h("div", { class: "btn-row" },
      button("Register", null, { kind: "primary", type: "submit" }),
      button("Cancel", () => { state.registering = null; refresh(); }, { kind: "quiet" })));
    setTimeout(() => name.focus(), 0);
    return form;
  }

  function cardActions(c) {
    if (state.confirming === c.id) {
      return h("div", { class: "confirm" },
        h("p", {}, `Turn off ${c.displayLabel}'s card? It stops working at every rack within a minute. This can't be undone.`),
        h("div", { class: "btn-row" },
          button("Turn Off", async () => {
            try {
              await api(`/credentials/${c.id}/revoke`, { method: "POST" });
              state.confirming = state.open = null;
              ctx.toast("Card turned off");
              refresh();
            } catch (e) { ctx.toast(e.message); }
          }, { kind: "primary" }),
          button("Keep It", () => { state.confirming = null; refresh(); }, { kind: "quiet" })));
    }
    return h("div", { class: "confirm" },
      h("p", { class: "muted" }, `Reference ${shortRef(c.credentialReference, 16)}. Used ${c.grantedCount} ${c.grantedCount === 1 ? "time" : "times"}, last ${ago(c.lastUsedAt)}.`),
      ctx.canEdit ? h("div", { class: "btn-row" },
        button("Turn Off Card", () => { state.confirming = c.id; refresh(); }, { kind: "quiet", small: true })) : null);
  }

  async function refresh() {
    const [unknown, creds, rackList] = await Promise.all([api("/credentials/unknown"), api("/credentials"), api("/racks")]);
    racks = rackList;
    const rackName = Object.fromEntries(rackList.map((r) => [r.id, r.name]));
    renderIfChanged(waiting, JSON.stringify([unknown, state.registering, ctx.canEdit, rackList.length]), () => unknown.length
      ? h("div", { class: "list" }, unknown.map((u) => [
        row({
          lead: h("span", { class: "row-icon warning" }, icon("card")),
          title: `Card ${shortRef(u.credentialReference, 8)}`,
          sub: `Tapped ${u.attempts} ${u.attempts === 1 ? "time" : "times"} at ${u.lastRackName || "a rack"}, ${ago(u.lastSeenAt)}`,
          side: ctx.canEdit && state.registering !== u.credentialReference
            ? button("Register", () => { state.registering = u.credentialReference; refresh(); }, { small: true }) : undefined,
        }),
        state.registering === u.credentialReference ? registerForm(u) : null,
      ]))
      : h("p", { class: "empty" }, "No new cards. When someone taps an unregistered card, it shows up here."));
    const active = creds.filter((c) => c.status !== "REVOKED");
    filter.hidden = active.length < 6 && !state.filter;
    const visible = active.filter((c) => !state.filter || c.displayLabel.toLowerCase().includes(state.filter));
    renderIfChanged(registered, JSON.stringify([visible, state.open, state.confirming, rackList.length, state.filter]), () => visible.length
      ? h("div", { class: "list" }, visible.map((c) => [
        row({
          lead: h("span", { class: `row-icon ${c.status === "ACTIVE" ? "positive" : "faint"}` }, icon("card")),
          title: c.displayLabel,
          sub: c.allRacks ? "Every rack" : (c.rackIds.map((id) => rackName[id]).filter(Boolean).join(", ") || "No racks"),
          side: h("span", { class: c.status === "ACTIVE" ? "positive" : "faint" },
            c.status === "ACTIVE" ? "Active" : c.status.charAt(0) + c.status.slice(1).toLowerCase().replaceAll("_", " ")),
          sideSub: c.lastUsedAt ? `Used ${ago(c.lastUsedAt)}` : "Not used yet",
          selected: state.open === c.id,
          onClick: () => { state.open = state.open === c.id ? null : c.id; state.confirming = null; refresh(); },
        }),
        state.open === c.id ? cardActions(c) : null,
      ]))
      : h("p", { class: "empty" }, state.filter ? "No card with that name." : "No cards registered yet. They show up under Waiting to Register after someone taps one."));
  }
  refresh().catch((e) => waiting.replaceChildren(h("p", { class: "empty" }, e.message)));
  return { refresh };
}

