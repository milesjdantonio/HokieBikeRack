// "App preview": what HokieBikeRack could look like as a phone app.
// Two modes: Rider (students) and Admin (staff on the go).
// Uses LIVE data from the same API. Things the backend can't know yet (rider
// accounts) are clearly marked: you pick which registered card "you" are.
// No fake bike occupancy: there is no bike-present sensor.
import { api } from "./api.js";
import { badge, clear, eventName, eventSummary, h, relativeTime, shortRef, toast } from "./ui.js";
import { openRegisterDialog, revokeCard } from "./views/cards.js";

const RIDER_STATUS = {
  ONLINE: { text: "Ready", hint: "Tap your card on the reader to unlock.", kind: "ok" },
  WARNING: { text: "Alert", hint: "Something unusual happened here recently.", kind: "warn" },
  OFFLINE: { text: "Offline", hint: "Still works with saved cards for up to 72 h.", kind: "muted" },
  UNKNOWN: { text: "Coming soon", hint: "No lock installed yet.", kind: "muted" },
};

export function openAppPreview(ctx) {
  const state = { mode: "rider", tab: "racks", cardId: sessionStorage.getItem("hbr.previewCard") || "", rackId: null };
  const screen = h("div", { class: "phone-screen" });
  const modeButtons = {
    rider: h("button", { type: "button", class: "seg", onClick: () => setMode("rider") }, "Rider app"),
    admin: h("button", { type: "button", class: "seg", onClick: () => setMode("admin") }, "Admin app"),
  };
  const close = () => { clearInterval(timer); document.removeEventListener("keydown", onKey); root.remove(); };
  const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".modal")) close(); };
  const root = h("div", { class: "backdrop preview-backdrop", onClick: (e) => { if (e.target === root) close(); } },
    h("div", { class: "preview-wrap" },
      h("div", { class: "preview-toolbar" },
        h("div", { class: "segmented", role: "tablist" }, modeButtons.rider, modeButtons.admin),
        h("button", { type: "button", class: "ghost light", onClick: close }, "Close preview ✕")),
      h("div", { class: "phone" }, h("div", { class: "phone-notch" }), screen),
      h("p", { class: "preview-note" }, "Preview · live data from this backend. Rider accounts don't exist yet, so in Rider mode you choose which registered card is “you”.")));
  document.body.append(root);
  document.addEventListener("keydown", onKey);

  function setMode(mode) {
    state.mode = mode;
    state.tab = mode === "rider" ? "racks" : "status";
    state.rackId = null;
    draw();
  }
  function setTab(tab) {
    state.tab = tab;
    state.rackId = null;
    draw();
  }

  async function draw() {
    for (const [m, b] of Object.entries(modeButtons)) b.classList.toggle("active", m === state.mode);
    try {
      const content = state.mode === "rider" ? await riderScreen() : await adminScreen();
      clear(screen).append(content);
    } catch (err) {
      clear(screen).append(h("div", { class: "app-body" }, h("p", { class: "app-error" }, err.message)));
    }
  }

  function appShell(title, subtitle, body, tabs) {
    return [
      h("div", { class: "app-status-bar" }, h("span", {}, new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })), h("span", {}, "●●● 5G")),
      h("header", { class: "app-header" }, h("p", { class: "app-eyebrow" }, "HOKIEBIKERACK"), h("h2", {}, title), subtitle ? h("p", {}, subtitle) : null),
      h("div", { class: "app-body" }, body),
      h("nav", { class: "app-tabs" }, tabs.map(([key, icon, label]) =>
        h("button", { type: "button", class: state.tab === key ? "active" : "", onClick: () => setTab(key) },
          h("span", { class: "app-tab-icon" }, icon), h("span", {}, label)))),
    ];
  }

  // ---------------- Rider ----------------

  async function riderScreen() {
    const tabs = [["racks", "🚲", "Racks"], ["card", "💳", "My card"], ["alerts", "🔔", "Alerts"]];
    if (state.tab === "racks") {
      const racks = await api("/racks");
      if (state.rackId) {
        const rack = racks.find((r) => r.id === state.rackId);
        if (rack) return appShell(rack.name, rack.locationDescription || "", await riderRackDetail(rack), tabs);
      }
      return appShell("Find a rack", "Live lock status", h("ul", { class: "app-list" }, racks.length ? racks.map((r) => {
        const s = RIDER_STATUS[r.status] || RIDER_STATUS.UNKNOWN;
        return h("li", {}, h("button", { type: "button", class: "app-row", onClick: () => { state.rackId = r.id; draw(); } },
          h("span", { class: `dot dot-${s.kind}` }),
          h("span", { class: "app-row-main" }, h("strong", {}, r.name), h("small", {}, r.locationDescription || s.hint)),
          h("span", { class: "app-row-side" }, badge(s.text, s.kind), h("small", {}, relativeTime(r.lastSeenAt)))));
      }) : h("li", { class: "app-empty" }, "No racks yet.")), tabs);
    }
    if (state.tab === "card") return appShell("My card", null, await riderCard(), tabs);
    return appShell("Alerts", "Tamper alerts at racks you use", await riderAlerts(), tabs);
  }

  async function riderRackDetail(rack) {
    const s = RIDER_STATUS[rack.status] || RIDER_STATUS.UNKNOWN;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [unlocks, tamper] = await Promise.all([
      api("/events", { query: { rackId: rack.id, type: "ACCESS_GRANTED", from: since, size: 1 } }),
      api("/events", { query: { rackId: rack.id, type: "TAMPER", from: since, size: 3 } })]);
    return [
      h("button", { type: "button", class: "app-back", onClick: () => { state.rackId = null; draw(); } }, "‹ All racks"),
      h("div", { class: `app-hero hero-${s.kind}` }, h("p", { class: "app-hero-title" }, s.text), h("p", {}, s.hint)),
      h("div", { class: "app-card" }, h("h3", {}, "How to unlock"),
        h("ol", {}, h("li", {}, "Hold your card flat on the reader."),
          h("li", {}, "Green light + beep = unlocked for 5 seconds."),
          h("li", {}, "Red light + two beeps = not allowed here. Check “My card”."))),
      h("div", { class: "app-card" }, h("h3", {}, "Last 24 hours"),
        h("p", {}, `${unlocks.total} unlock(s)`),
        tamper.total ? h("p", { class: "warn-text" }, `${tamper.total} tamper alert(s), last ${relativeTime(tamper.items[0].occurredAt)}`)
          : h("p", { class: "muted" }, "No tamper alerts")),
      h("p", { class: "app-fine" }, `Rack last checked in ${relativeTime(rack.lastSeenAt)}.`),
    ];
  }

  async function cardPicker(cards) {
    const select = h("select", { class: "app-select", "aria-label": "Act as card",
      onChange: (e) => { state.cardId = e.target.value; sessionStorage.setItem("hbr.previewCard", state.cardId); draw(); } },
    h("option", { value: "" }, "Choose a card to act as…"),
    cards.map((c) => h("option", { value: c.id }, `${c.displayLabel} (${c.status.toLowerCase()})`)));
    select.value = state.cardId;
    return h("label", { class: "app-picker" }, h("span", { class: "app-sample" }, "PREVIEW ONLY"), select);
  }

  async function riderCard() {
    const [cards, racks] = await Promise.all([api("/credentials"), api("/racks")]);
    const picker = await cardPicker(cards);
    const card = cards.find((c) => c.id === state.cardId);
    if (!card) return [picker, h("p", { class: "app-empty" }, cards.length ? "Pick a card above to see what a rider would see." : "No cards registered yet.")];
    const rackName = Object.fromEntries(racks.map((r) => [r.id, r.name]));
    const history = await api("/events", { query: { credentialReference: card.credentialReference, size: 8 } });
    const good = card.status === "ACTIVE";
    return [
      picker,
      h("div", { class: `app-id-card ${good ? "" : "id-bad"}` },
        h("p", { class: "app-eyebrow" }, "VIRGINIA TECH · BIKE ACCESS"),
        h("p", { class: "app-id-name" }, card.displayLabel),
        h("p", {}, good ? "Active" : card.status.replaceAll("_", " ").toLowerCase()),
        h("p", { class: "mono small-text" }, shortRef(card.credentialReference))),
      h("div", { class: "app-card" }, h("h3", {}, "Where it works"),
        h("p", {}, card.allRacks ? "Every rack" : (card.rackIds.map((id) => rackName[id]).filter(Boolean).join(", ") || "No racks yet")),
        card.validUntil ? h("p", { class: "muted" }, `Until ${new Date(card.validUntil).toLocaleDateString()}`) : null),
      h("div", { class: "app-card" }, h("h3", {}, "Recent activity"),
        history.items.length ? h("ul", { class: "app-mini-list" }, history.items.map((e) =>
          h("li", {}, h("span", {}, e.eventType === "ACCESS_GRANTED" ? "🔓 " : "⛔ ", eventName(e.eventType)),
            h("small", {}, `${e.rackName || ""} · ${relativeTime(e.occurredAt)}`))))
          : h("p", { class: "muted" }, "Not used yet.")),
      h("button", { type: "button", class: "app-button", disabled: true, title: "Sample feature" }, "Report lost card (sample)"),
    ];
  }

  async function riderAlerts() {
    const [cards, tamper] = await Promise.all([api("/credentials"), api("/events", { query: { type: "TAMPER", size: 20 } })]);
    const card = cards.find((c) => c.id === state.cardId);
    let items = tamper.items;
    let note = "Showing all racks (pick a card on “My card” to see only your racks).";
    if (card && !card.allRacks) {
      items = items.filter((e) => card.rackIds.includes(e.rackId));
      note = `Racks where ${card.displayLabel} is allowed.`;
    }
    return [h("p", { class: "app-fine" }, note),
      items.length ? h("ul", { class: "app-list" }, items.map((e) => h("li", { class: "app-alert" },
        h("span", { class: `dot dot-${e.eventType === "TAMPER_ALARM" ? "danger" : "warn"}` }),
        h("span", { class: "app-row-main" }, h("strong", {}, e.eventType === "TAMPER_ALARM" ? "Alarm: rack being tampered with" : "Rack was bumped"),
          h("small", {}, `${e.rackName} · ${relativeTime(e.occurredAt)}`)))))
        : h("p", { class: "app-empty" }, "No tamper alerts. 👍")];
  }

  // ---------------- Admin ----------------

  async function adminScreen() {
    const tabs = [["status", "📊", "Status"], ["alerts", "🚨", "Alerts"], ["cards", "💳", "Cards"]];
    if (state.tab === "status") {
      const racks = await api("/racks");
      const counts = { ONLINE: 0, WARNING: 0, OFFLINE: 0, UNKNOWN: 0 };
      for (const r of racks) counts[r.status]++;
      return appShell("Rack health", `${racks.length} rack(s)`, [
        h("div", { class: "app-stats" },
          h("div", { class: "stat ok" }, h("b", {}, String(counts.ONLINE)), h("small", {}, "online")),
          h("div", { class: "stat warn" }, h("b", {}, String(counts.WARNING)), h("small", {}, "warning")),
          h("div", { class: "stat muted" }, h("b", {}, String(counts.OFFLINE + counts.UNKNOWN)), h("small", {}, "offline"))),
        h("ul", { class: "app-list" }, racks.map((r) => {
          const kind = { ONLINE: "ok", WARNING: "warn" }[r.status] || "muted";
          return h("li", { class: "app-row" }, h("span", { class: `dot dot-${kind}` }),
            h("span", { class: "app-row-main" }, h("strong", {}, r.name), h("small", {}, `${r.onlineDeviceCount}/${r.deviceCount} devices · ${relativeTime(r.lastSeenAt)}`)),
            r.openAlerts ? badge(`${r.openAlerts} alert`, "warn") : null);
        })),
      ], tabs);
    }
    if (state.tab === "alerts") {
      const alerts = await api("/events", { query: { unacknowledged: true, size: 30 } });
      const items = alerts.items.filter((e) => ["MEDIUM", "HIGH", "CRITICAL"].includes(e.severity));
      return appShell("Live alerts", `${items.length} need review`, items.length ? h("ul", { class: "app-list" }, items.map((e) =>
        h("li", { class: "app-alert" },
          h("span", { class: `dot dot-${e.severity === "MEDIUM" ? "warn" : "danger"}` }),
          h("span", { class: "app-row-main" }, h("strong", {}, eventName(e.eventType)), h("small", {}, `${e.rackName} · ${relativeTime(e.occurredAt)} · ${eventSummary(e)}`)),
          ctx.canEdit ? h("button", { type: "button", class: "app-chip-button", onClick: async () => {
            try { await api(`/events/${e.id}/acknowledge`, { method: "POST" }); toast("Handled", "ok"); draw(); } catch (err) { toast(err.message, "error"); }
          } }, "✓") : null)))
        : h("p", { class: "app-empty" }, "All clear. ✅"), tabs);
    }
    const [unknown, cards] = await Promise.all([api("/credentials/unknown"), api("/credentials")]);
    return appShell("Cards", `${cards.filter((c) => c.status === "ACTIVE").length} active`, [
      unknown.length ? h("div", { class: "app-card" }, h("h3", {}, "Tapped, not registered"),
        h("ul", { class: "app-mini-list" }, unknown.map((u) => h("li", {},
          h("span", { class: "mono" }, shortRef(u.credentialReference)),
          ctx.canEdit ? h("button", { type: "button", class: "app-chip-button",
            onClick: () => openRegisterDialog(ctx, { credentialReference: u.credentialReference, rackId: u.lastRackId }, draw) }, "Register")
            : h("small", {}, relativeTime(u.lastSeenAt)))))) : null,
      h("ul", { class: "app-list" }, cards.filter((c) => c.status !== "REVOKED").map((c) => h("li", { class: "app-row" },
        h("span", { class: `dot dot-${c.status === "ACTIVE" ? "ok" : "muted"}` }),
        h("span", { class: "app-row-main" }, h("strong", {}, c.displayLabel), h("small", {}, `last used ${relativeTime(c.lastUsedAt)}`)),
        ctx.canEdit ? h("button", { type: "button", class: "app-chip-button danger", onClick: () => revokeCard(c, draw) }, "Revoke") : null))),
    ], tabs);
  }

  draw();
  const timer = setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector(".modal")) draw(); }, 10000);
}
