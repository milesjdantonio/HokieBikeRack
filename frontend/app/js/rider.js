// Rider screens: Racks (map + list), one rack (the lit scene), My Card, Alerts.
// The rack screen is also used by the staff app (with a Devices block added).
import { api } from "../../js/api.js";
import { DENY_REASONS, ago, h, renderIfChanged, shortRef, when } from "../../js/dom.js";
import { riveIcon } from "../../js/rive.js";
import { rackMap } from "./map.js";
import { placementPanel } from "./placer.js";
import { STATUS_CLASS, STATUS_WORD, button, icon, row, sceneState, sound } from "./ui.js";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** The rack icon, coloured by status (still; nothing pulses). */
export function statusIcon(status) {
  return h("span", { class: `row-icon ${STATUS_CLASS[status] || "faint"}` }, icon("racks"));
}

/** Straight-line distance in metres (haversine). */
function metres(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}
function distanceText(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m away`;
  return `${(m / 1609.34).toFixed(1)} mi away`;
}

function rackRow(r, ctx, extraSub, distance) {
  return row({
    lead: statusIcon(r.status),
    title: r.name,
    sub: extraSub || r.locationDescription || "No description yet",
    side: h("span", { class: STATUS_CLASS[r.status] }, STATUS_WORD[r.status] || r.status),
    sideSub: distance != null ? h("span", { class: "near" }, distanceText(distance)) : r.lastSeenAt ? ago(r.lastSeenAt) : null,
    onClick: () => ctx.go(`#rack/${r.id}`),
    label: `${r.name}, ${STATUS_WORD[r.status]}`,
  });
}

// ---------- Racks ----------

export function racks(el, ctx) {
  const lede = h("p", { class: "lede" });
  const mapEl = h("div");
  const list = h("div", { class: "list" }, h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
  let me = null;   // the rider's position, only if they asked (never leaves this device)
  let data = [];
  const near = button("Find Nearest", () => locate(), { small: true });
  near.classList.add("find-near");
  if (!("geolocation" in navigator)) near.hidden = true;
  el.append(h("div", { class: "heading-row" }, h("h1", { class: "display" }, "Racks"), near), lede, h("div", { class: "split" }, mapEl, list));
  const map = rackMap(mapEl, { onSelect: (r) => ctx.go(`#rack/${r.id}`) });

  function locate() {
    near.disabled = true;
    near.lastChild.textContent = "Finding You";
    navigator.geolocation.getCurrentPosition((pos) => {
      me = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      near.disabled = false;
      near.lastChild.textContent = "Find Nearest";
      draw();
      const closest = sorted()[0];
      if (closest && closest.latitude != null) map.select(closest.id);
    }, (err) => {
      near.disabled = false;
      near.lastChild.textContent = "Find Nearest";
      ctx.toast(err.code === 1 ? "Location is off for this site. Turn it on in your browser to find the nearest rack." : "Couldn't find your location. Try again outside.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /** Nearest first once we know where the rider is; otherwise ready racks first. */
  function sorted() {
    const placed = (r) => r.latitude != null;
    if (me) return [...data].sort((a, b) => (placed(a) ? metres(me, a) : 1e12) - (placed(b) ? metres(me, b) : 1e12));
    const rank = { ONLINE: 0, WARNING: 1, OFFLINE: 2, UNKNOWN: 3 };
    return [...data].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  }

  function draw() {
    renderIfChanged(list, JSON.stringify([data, me]), () => data.length
      ? sorted().map((r) => rackRow(r, ctx, null, me && r.latitude != null ? metres(me, r) : null))
      : h("p", { class: "empty" }, "No racks yet. Once staff add one, it shows up here and on the map."));
  }

  async function refresh() {
    data = await api("/racks");
    const ready = data.filter((r) => r.status === "ONLINE" || r.status === "WARNING").length;
    lede.textContent = data.length ? `${ready} of ${data.length} ${data.length === 1 ? "rack is" : "racks are"} taking cards.` : "";
    draw();
    map.setRacks(data);
  }
  refresh().catch((e) => { list.replaceChildren(h("p", { class: "empty" }, `Couldn't load racks: ${e.message}`)); });
  return { refresh, destroy: () => map.destroy() };
}

// ---------- One rack ----------

function sentence(rack, devices, lastTamper) {
  const alarm = devices.some((d) => d.online && d.lastHeartbeat && d.lastHeartbeat.alarmActive);
  if (rack.status === "UNKNOWN") return [h("strong", {}, "Not installed yet."), " This rack has no lock module."];
  if (rack.status === "OFFLINE") {
    return [h("strong", {}, "Offline."), ` Registered cards still work for up to 72 hours. Last check-in ${ago(rack.lastSeenAt)}.`];
  }
  if (alarm) return [h("strong", {}, "Alarm."), " Someone is tampering with this rack right now. Staff have been alerted."];
  if (rack.status === "WARNING" && lastTamper) {
    return [h("strong", {}, "Ready."), ` Someone bumped or tampered with this rack ${ago(lastTamper.occurredAt)}. Staff have been alerted.`];
  }
  return [h("strong", {}, "Ready."), " Hold your card flat on the reader. A green light and one beep means it's open for 5 seconds."];
}

export function rack(el, ctx, id, action) {
  const back = h("button", { type: "button", class: "back", onClick: () => ctx.back() },
    icon("back"), ctx.mode === "staff" ? "Health" : "Racks");
  const scene = riveIcon("rack", { size: 600, height: 400, fluid: true, inputs: { state: 0 }, label: "The rack, its lock and reader" });
  const caption = h("p", { class: "stage-caption", "aria-live": "polite" });
  const stage = h("figure", { class: "stage" }, scene.el, h("div", { class: "stage-fallback" }, icon("racks")), caption);
  const title = h("h1", { class: "display" }, h("span", { class: "faint" }, "Loading"));
  const status = h("p", { class: "status-sentence" });
  const facts = h("dl", { class: "facts" });
  const where = h("div", { class: "block" });
  const devicesBlock = h("div", { class: "block" });
  let baseState = 0;
  let demoTimer = null;
  let demoActive = false;
  let map = null;
  let data = null;

  const tapBtn = button("Try a Tap", () => demo(1), { kind: "primary", iconName: "tap" });
  tapBtn.classList.add("try-tap");
  const tryNote = h("p", { class: "small faint" }, "A preview of what the rack does. Nothing unlocks.");
  const activity = h("div", { class: "block" });
  const unknownBtn = button("Try an Unknown Card", () => demo(2), { kind: "quiet" });
  function demo(state) {
    clearTimeout(demoTimer);
    demoActive = true;
    scene.set("state", state);
    if (state === 1) { sound.granted(); caption.textContent = "Accepted. Open for 5 seconds."; caption.className = "stage-caption positive"; }
    else { sound.denied(); caption.textContent = "Not recognised. It stays locked."; caption.className = "stage-caption negative"; }
    tapBtn.disabled = unknownBtn.disabled = true;
    demoTimer = setTimeout(() => {
      scene.set("state", baseState);
      caption.textContent = "";
      caption.className = "stage-caption";
      tapBtn.disabled = unknownBtn.disabled = false;
      demoActive = false;
    }, state === 1 ? 5000 : 2400);
  }

  el.append(back, h("div", { class: "rack-layout" }, stage, h("div", {},
    title, status,
    h("div", { class: "block" }, h("div", { class: "btn-row" }, tapBtn, unknownBtn), tryNote),
    h("div", { class: "block" }, h("h2", {}, "Today"), facts),
    devicesBlock, activity, where)));

  async function refresh() {
    const since = startOfToday();
    const [detail, unlocks, tamper] = await Promise.all([
      api(`/racks/${id}`),
      api("/events", { query: { rackId: id, type: "ACCESS_GRANTED", from: since, size: 1 } }),
      api("/events", { query: { rackId: id, type: "TAMPER", from: since, size: 1 } }),
    ]);
    data = detail;
    const r = detail.rack;
    document.title = `${r.name} · HokieBikeRack`;
    title.textContent = r.name;
    status.replaceChildren(...sentence(r, detail.devices, tamper.items[0]));
    baseState = sceneState(r, detail.devices);
    const off = r.status === "OFFLINE" || r.status === "UNKNOWN";
    if (!demoActive) {
      scene.set("state", baseState);
      tapBtn.disabled = unknownBtn.disabled = off;
    }
    tryNote.textContent = off ? "The preview works once this rack is online." : "A preview of what the rack does. Nothing unlocks.";
    if (ctx.mode === "staff") renderActivity(activity, r.id);
    renderIfChanged(facts, JSON.stringify([r.status, r.lastSeenAt && ago(r.lastSeenAt), unlocks.total, tamper.total]), () => [
      fact("Status", h("span", { class: STATUS_CLASS[r.status] }, STATUS_WORD[r.status])),
      fact("Last check-in", r.lastSeenAt ? ago(r.lastSeenAt) : "Never"),
      fact("Unlocks", String(unlocks.total)),
      fact("Tamper alerts", h("span", { class: tamper.total ? "warning" : "" }, String(tamper.total))),
    ]);
    if (ctx.mode === "staff") renderDevices(devicesBlock, detail, ctx, refresh);
    renderWhere(r);
    if (map) map.setRacks([r]);
  }

  // "Where": a small map of the rack, or (staff) placing it by clicking the map.
  let placing = action === "place" && ctx.mode === "staff" && ctx.canEdit;
  let placer = null;
  let whereSig = "";
  function renderWhere(r) {
    const sig = JSON.stringify([r.latitude, r.longitude, r.locationDescription, placing]);
    if (sig === whereSig) return;
    whereSig = sig;
    if (map) { map.destroy(); map = null; }
    if (placer) { placer.destroy(); placer = null; }
    const canPlace = ctx.mode === "staff" && ctx.canEdit;
    const placed = r.latitude != null;
    const parts = [h("h2", {}, "Where"), h("p", { class: "muted" }, r.locationDescription || "No description yet.")];
    if (placing) {
      placer = placementPanel({
        initial: placed ? r : null,
        onSave: async (p) => {
          await api(`/racks/${r.id}`, { method: "PATCH", body: p });
          ctx.toast(placed ? "Moved on the map" : "Placed on the map");
          placing = false;
          if (location.hash.endsWith("/place")) history.replaceState(null, "", `#rack/${r.id}`);
          await refresh();
        },
        onCancel: () => {
          placing = false;
          if (location.hash.endsWith("/place")) history.replaceState(null, "", `#rack/${r.id}`);
          renderWhere(r);
        },
      });
      parts.push(placer.el);
    } else {
      if (placed) {
        const mapEl = h("div", { class: "map-small" });
        parts.push(mapEl);
        map = rackMap(mapEl, { interactive: true, focus: r });
        parts.push(h("div", { class: "btn-row" }, h("a", { class: "btn btn-small", target: "_blank", rel: "noopener",
          href: `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}&travelmode=bicycling` }, "Get Directions")));
      } else {
        parts.push(h("p", { class: "empty" }, canPlace ? "This rack isn't on the map yet." : "This rack isn't on the map yet. Staff will add it."));
      }
      if (canPlace) {
        parts.push(h("div", { class: "btn-row" },
          button(placed ? "Move on Map" : "Place on Map", () => { placing = true; renderWhere(r); }, { small: true }),
          placed ? button("Take Off Map", async () => {
            try {
              await api(`/racks/${r.id}`, { method: "PATCH", body: { clearCoordinates: true } });
              ctx.toast("Taken off the map");
              await refresh();
            } catch (e) { ctx.toast(e.message); }
          }, { kind: "quiet", small: true }) : null));
      }
    }
    where.replaceChildren(...parts);
  }

  refresh().catch((e) => {
    // Bad link or a deleted rack: say so plainly and offer the way back.
    el.replaceChildren(back, h("div", { class: "block" },
      h("h1", { class: "display" }, e.status === 404 ? "Rack Not Found" : "Couldn't Load This Rack"),
      h("p", { class: "status-sentence" }, e.status === 404 ? "It may have been removed, or the link is wrong." : e.message),
      h("div", { class: "block" }, button(ctx.mode === "staff" ? "Go to Rack Health" : "See All Racks", () => ctx.go("#"), { kind: "primary" }))));
  });
  return { refresh, destroy: () => { clearTimeout(demoTimer); if (map) map.destroy(); if (placer) placer.destroy(); document.title = "HokieBikeRack"; } };
}

const ACTIVITY = {
  ACCESS_GRANTED: ["unlock", "positive", "Unlocked"],
  ACCESS_DENIED: ["blocked", "negative", "Card not accepted"],
  TAMPER_WARNING: ["siren", "warning", "Rack bumped"],
  TAMPER_ALARM: ["siren", "negative", "Tamper alarm"],
  SENSOR_FAULT: ["signal", "warning", "Sensor problem"],
  DEVICE_BOOT: ["signal", "faint", "Lock module started"],
};

/** Staff only: the last few things that happened at this rack. */
async function renderActivity(block, rackId) {
  const data = await api("/events", { query: { rackId, size: 8 } });
  renderIfChanged(block, JSON.stringify(data.items.map((e) => e.id)), () => [
    h("h2", {}, "Recent Activity"),
    data.items.length ? h("div", { class: "list" }, data.items.map((e) => {
      const [ic, cls, label] = ACTIVITY[e.eventType] || ["signal", "faint", e.eventType.toLowerCase()];
      const who = e.credentialLabel || (e.credentialReference ? `Card ${shortRef(e.credentialReference, 8)}` : null);
      const why = e.eventType === "ACCESS_DENIED" ? DENY_REASONS[e.details?.reason] : null;
      return row({
        lead: h("span", { class: `row-icon ${cls}` }, icon(ic)),
        title: label,
        sub: [who, why].filter(Boolean).join(", ") || null,
        side: h("span", { class: "small muted" }, when(e.occurredAt)),
      });
    })) : h("p", { class: "empty" }, "Nothing yet."),
  ]);
}

function fact(label, value) {
  return h("div", {}, h("dt", {}, label), h("dd", {}, value));
}

/** Staff only: each lock module's health from its last heartbeat. */
function renderDevices(block, detail, ctx, refresh) {
  const r = detail.rack;
  renderIfChanged(block, JSON.stringify([detail.devices, r.openAlerts, ctx.canEdit]), () => [
    h("h2", {}, "Lock Modules"),
    detail.devices.length ? h("div", { class: "list" }, detail.devices.map((d) => {
      const hb = d.lastHeartbeat || {};
      const problems = [];
      if (hb.readerOk === false) problems.push("card reader not responding");
      if (hb.accelOk === false) problems.push("motion sensor not responding");
      if (d.lastSeenAt && hb.clockSynced === false) problems.push("clock not set");
      return row({
        lead: h("span", { class: `row-icon ${d.online ? (problems.length ? "warning" : "positive") : "faint"}` }, icon("signal")),
        title: d.label,
        sub: !d.lastSeenAt ? "Never connected" : problems.length ? problems.join(", ") : `All sensors working, signal ${hb.wifiRssi ?? "?"} dBm`,
        side: h("span", { class: d.online ? "positive" : "faint" }, !d.active ? "Disabled" : d.online ? "Online" : "Offline"),
        sideSub: d.firmwareVersion ? `Firmware ${d.firmwareVersion}` : null,
      });
    })) : h("p", { class: "empty" }, "No lock module yet. Add one in the admin console."),
    r.openAlerts && ctx.canEdit ? h("div", { class: "btn-row" },
      button(`Mark ${r.openAlerts} ${r.openAlerts === 1 ? "Alert" : "Alerts"} Handled`, async () => {
        try {
          await api(`/events/acknowledge-rack/${r.id}`, { method: "POST" });
          ctx.toast("Marked handled");
          refresh();
        } catch (e) { ctx.toast(e.message); }
      }, { small: true })) : null,
  ]);
}

// ---------- My Card ----------

export function card(el, ctx) {
  const picker = h("select", { class: "select", "aria-label": "Your card" });
  const body = h("div");
  el.append(
    h("h1", { class: "display" }, "My Card"),
    h("label", { class: "picker" }, h("span", { class: "picker-label" },
      "Rider accounts are on the way. To preview this screen, choose which card is yours."), picker),
    h("div", { class: "block" }, body));
  let cards = [];
  picker.addEventListener("change", () => { localStorage.setItem("hbr.app.card", picker.value); refresh(); });

  async function refresh() {
    const [list, racksList] = await Promise.all([api("/credentials"), api("/racks")]);
    cards = list.filter((c) => c.status !== "REVOKED" || c.id === localStorage.getItem("hbr.app.card"));
    const chosen = localStorage.getItem("hbr.app.card") || "";
    renderIfChanged(picker, JSON.stringify(cards.map((c) => [c.id, c.displayLabel])), () => [
      h("option", { value: "" }, "Choose a card"), cards.map((c) => h("option", { value: c.id }, c.displayLabel))]);
    picker.value = chosen;
    const c = cards.find((x) => x.id === chosen);
    if (!c) {
      renderIfChanged(body, "none", () => h("p", { class: "empty" }, cards.length ? "Choose a card above." : "No cards are registered yet."));
      return;
    }
    const history = await api("/events", { query: { credentialReference: c.credentialReference, size: 10 } });
    const rackName = Object.fromEntries(racksList.map((r) => [r.id, r.name]));
    const active = c.status === "ACTIVE";
    renderIfChanged(body, JSON.stringify([c, history.items.map((e) => e.id), racksList.length]), () => h("div", { class: "card-layout" },
      h("div", { class: `idcard${active ? "" : " off"}` },
        h("div", { class: "idcard-top" }, h("span", {}, "Virginia Tech Bike Access"), h("span", { class: "idcard-chip", "aria-hidden": "true" })),
        h("p", { class: "idcard-name" }, c.displayLabel),
        h("div", { class: "idcard-foot" }, h("span", {}, active ? "Active" : c.status.charAt(0) + c.status.slice(1).toLowerCase().replaceAll("_", " ")),
          h("span", {}, shortRef(c.credentialReference, 8)))),
      h("div", {},
        h("h2", { class: "title" }, "Works At"),
        h("p", { class: "muted" }, c.allRacks ? "Every rack." : (c.rackIds.map((id) => rackName[id]).filter(Boolean).join(", ") || "No racks yet. Ask staff to add one.")),
        c.validUntil ? h("p", { class: "muted" }, `Until ${new Date(c.validUntil).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}.`) : null,
        h("div", { class: "block" }, h("h2", {}, "Recent"),
          history.items.length ? h("div", { class: "list" }, history.items.map((e) => {
            const ok = e.eventType === "ACCESS_GRANTED";
            return row({
              lead: h("span", { class: `row-icon ${ok ? "positive" : "negative"}` }, icon(ok ? "unlock" : "blocked")),
              title: ok ? "Unlocked" : "Not accepted",
              sub: ok ? e.rackName : `${e.rackName}, ${DENY_REASONS[e.details?.reason] || "card not accepted"}`,
              side: h("span", { class: "small muted" }, when(e.occurredAt)),
            });
          })) : h("p", { class: "empty" }, "Not used yet.")),
        h("p", { class: "block small faint" }, "Lost your card? Ask staff to turn it off. It stops working within a minute."))));
  }
  refresh().catch((e) => body.replaceChildren(h("p", { class: "empty" }, e.message)));
  return { refresh };
}

// ---------- Alerts (rider) ----------

export function alerts(el, ctx) {
  const lede = h("p", { class: "lede" });
  const list = h("div", { class: "list" }, h("div", { class: "skeleton" }));
  el.append(h("h1", { class: "display" }, "Alerts"), lede, list);

  async function refresh() {
    const [events, creds] = await Promise.all([api("/events", { query: { type: "TAMPER", size: 30 } }), api("/credentials")]);
    const mine = creds.find((c) => c.id === localStorage.getItem("hbr.app.card"));
    let items = events.items;
    if (mine && !mine.allRacks) items = items.filter((e) => mine.rackIds.includes(e.rackId));
    lede.textContent = mine ? `Tamper alerts at racks where ${mine.displayLabel}'s card works.` : "Tamper alerts at every rack.";
    renderIfChanged(list, JSON.stringify(items.map((e) => [e.id, e.acknowledgedAt])), () => items.length
      ? items.map((e) => {
        const alarm = e.eventType === "TAMPER_ALARM";
        return row({
          lead: h("span", { class: `row-icon ${alarm ? "negative" : "warning"}` }, icon("siren")),
          title: alarm ? "Tamper alarm" : "Rack bumped",
          sub: e.rackName,
          side: h("span", { class: "small muted" }, when(e.occurredAt)),
          sideSub: e.acknowledgedAt ? "Checked by staff" : null,
          onClick: e.rackId ? () => ctx.go(`#rack/${e.rackId}`) : null,
        });
      })
      : h("p", { class: "empty" }, "No alerts."));
  }
  refresh().catch((e) => list.replaceChildren(h("p", { class: "empty" }, e.message)));
  return { refresh };
}
