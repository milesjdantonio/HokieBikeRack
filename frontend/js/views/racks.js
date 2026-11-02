// Racks page: create racks, add ESP32 devices (get their token), see device health.
import { api } from "../api.js";
import { riveIcon } from "../rive.js";
import { badge, clear, confirmDialog, copyText, emptyRow, errorBox, h, loading, modal, panel, relativeTime,
  statusBadge, toast } from "../ui.js";

function showDeviceToken(result, title) {
  const snippet = result.configSnippet;
  modal({
    title,
    wide: true,
    body: [
      h("p", {}, h("strong", {}, "Copy this now. "), "The token is shown only once; the server keeps just a hash of it. ",
        "If you lose it, use “New token”."),
      h("pre", { class: "snippet" }, snippet),
      h("p", { class: "muted small-text" },
        "Paste into firmware/include/config.h (copy config.example.h first). Never commit config.h."),
    ],
    actions: [h("button", { type: "button", onClick: () => copyText(snippet) }, "Copy snippet")],
  });
}

function heartbeatFacts(hb) {
  if (!hb) return h("span", { class: "muted" }, "no heartbeat yet");
  const ok = (v) => (v === false ? badge("FAULT", "danger") : badge("OK", "ok"));
  return h("div", { class: "hb" },
    h("span", { class: "lock-cell", title: "What the lock was last told to do (from the heartbeat)" },
      riveIcon("lock", { size: 26, inputs: { unlocked: Boolean(hb.lockUnlocked) } }).el, hb.lockUnlocked ? "unlocked" : "locked"),
    hb.alarmActive ? h("span", { class: "lock-cell" }, riveIcon("alarm", { size: 26, inputs: { active: true } }).el, "alarm") : null,
    h("span", {}, "Reader ", ok(hb.readerOk)),
    h("span", {}, "Accel ", ok(hb.accelOk)),
    h("span", {}, "Servo ", hb.servoEnabled ? badge("REAL", "warn") : badge("simulated", "muted")),
    h("span", {}, "Clock ", hb.clockSynced ? badge("set", "ok") : badge("not set", "danger")),
    hb.wifiRssi != null ? h("span", { class: "muted" }, `Wi-Fi ${hb.wifiRssi} dBm`) : null,
    hb.queueDepth != null ? h("span", { class: "muted" }, `queue ${hb.queueDepth}`) : null,
    hb.snapshotCardCount != null ? h("span", { class: "muted" }, `${hb.snapshotCardCount} cards on device`) : null);
}

function rackDetail(rackId, ctx, onChanged) {
  const box = h("div", {}, loading());
  async function load() {
    try {
      const [detail, revision] = await Promise.all([api(`/racks/${rackId}`), api("/credentials/revision")]);
      const { rack, devices } = detail;
      const rows = devices.map((d) => {
        const upToDate = d.authorizationRevision >= revision.revision;
        return h("tr", { class: d.active ? "" : "row-muted" },
          h("td", {}, h("strong", {}, d.label), h("div", { class: "muted small-text mono" }, d.id)),
          h("td", {}, h("span", { class: "lock-cell" },
            riveIcon("pulse", { size: 20, inputs: { status: d.active && d.online ? 1 : 0 } }).el,
            d.active ? (d.online ? "online" : "offline") : "disabled")),
          h("td", {}, d.firmwareVersion || "—"),
          h("td", { title: d.lastSeenAt || "" }, relativeTime(d.lastSeenAt)),
          h("td", {}, d.lastSeenAt ? (upToDate ? badge("up to date", "ok") : badge("syncing…", "info")) : "—"),
          h("td", {}, heartbeatFacts(d.lastHeartbeat)),
          h("td", { class: "actions-cell" }, ctx.canEdit ? [
            h("button", { class: "small ghost", type: "button", onClick: async () => {
              if (!(await confirmDialog("New device token?", `The old token for “${d.label}” stops working immediately. You'll need to re-flash the ESP32 with the new one.`, "Make new token", true))) return;
              try {
                const r = await api(`/racks/${rackId}/devices/${d.id}/rotate-token`, { method: "POST" });
                showDeviceToken(r, `New token for ${d.label}`);
                load();
              } catch (err) { toast(err.message, "error"); }
            } }, "New token"),
            h("button", { class: "small ghost", type: "button", onClick: async () => {
              try {
                await api(`/racks/${rackId}/devices/${d.id}`, { method: "PATCH", body: { active: !d.active } });
                toast(d.active ? "Device disabled" : "Device enabled", "ok");
                load();
              } catch (err) { toast(err.message, "error"); }
            } }, d.active ? "Disable" : "Enable"),
          ] : null));
      });

      const addForm = h("form", { class: "inline-form", onSubmit: async (e) => {
        e.preventDefault();
        const label = e.target.elements.label.value.trim();
        try {
          const r = await api(`/racks/${rackId}/devices`, { method: "POST", body: { label } });
          e.target.reset();
          showDeviceToken(r, `Device “${label}” added`);
          load();
          onChanged();
        } catch (err) { toast(err.message, "error"); }
      } },
      h("input", { name: "label", placeholder: "Device label, e.g. ESP32 #1", required: true, maxlength: 120 }),
      h("button", { type: "submit" }, "Add device"));

      const editForm = h("form", { class: "inline-form", onSubmit: async (e) => {
        e.preventDefault();
        try {
          await api(`/racks/${rackId}`, { method: "PATCH", body: {
            name: e.target.elements.name.value.trim(), locationDescription: e.target.elements.loc.value.trim() } });
          toast("Rack saved", "ok");
          onChanged();
          load();
        } catch (err) { toast(err.message, "error"); }
      } },
      h("input", { name: "name", value: rack.name, required: true, maxlength: 120, "aria-label": "Rack name" }),
      h("input", { name: "loc", value: rack.locationDescription || "", placeholder: "Location", maxlength: 255, "aria-label": "Location" }),
      h("button", { type: "submit", class: "secondary" }, "Save"));

      clear(box).append(panel(rack.name, rack.locationDescription || "No location set", statusBadge(rack.status),
        ctx.canEdit ? editForm : null,
        h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ["Device", "State", "Firmware", "Last heard", "Card list", "Health", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows.length ? rows : emptyRow(7, "No devices yet. Add one, then paste its config into the ESP32 firmware.")))),
        ctx.canEdit ? addForm : null));
      ctx.markUpdated();
    } catch (err) {
      clear(box).append(errorBox(err, load));
    }
  }
  load();
  return { box, load };
}

export function render(container, ctx) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  let selected = params.get("rackId");
  const listBox = h("div", {}, loading());
  const detailBox = h("div", {});
  let detail = null;

  async function loadList() {
    try {
      const racks = await api("/racks");
      if (!selected && racks.length) selected = racks[0].id;
      clear(listBox).append(h("ul", { class: "rack-list" }, racks.length ? racks.map((r) =>
        h("li", {}, h("button", { type: "button", class: `rack-pick${r.id === selected ? " selected" : ""}`,
          onClick: () => { selected = r.id; loadList(); showDetail(); } },
        h("span", {}, r.name), statusBadge(r.status)))) : h("li", { class: "muted" }, "No racks yet.")));
    } catch (err) {
      clear(listBox).append(errorBox(err, loadList));
    }
  }

  function showDetail() {
    clear(detailBox);
    if (!selected) return;
    detail = rackDetail(selected, ctx, loadList);
    detailBox.append(detail.box);
  }

  const createForm = h("form", { class: "stack-form", onSubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await api("/racks", { method: "POST", body: {
        name: e.target.elements.name.value.trim(), locationDescription: e.target.elements.loc.value.trim() || null } });
      e.target.reset();
      toast("Rack created", "ok");
      selected = r.rack.id;
      loadList();
      showDetail();
    } catch (err) { toast(err.message, "error"); }
  } },
  h("input", { name: "name", placeholder: "Rack name, e.g. Torgersen Hall A", required: true, maxlength: 120, "aria-label": "Rack name" }),
  h("input", { name: "loc", placeholder: "Location (optional)", maxlength: 255, "aria-label": "Location" }),
  h("button", { type: "submit" }, "Create rack"));

  container.append(h("div", { class: "split" },
    h("aside", {}, panel("Racks", null, null, listBox, ctx.canEdit ? h("div", { class: "spaced" }, h("h3", {}, "New rack"), createForm) : null)),
    detailBox));
  loadList().then(showDetail);
  const timer = setInterval(() => { if (document.visibilityState === "visible" && detail) detail.load(); }, 15000);
  return { cleanup: () => clearInterval(timer) };
}
