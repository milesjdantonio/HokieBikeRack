// Live data for every version (admin, staff, police, rider). Polls the backend every few seconds
// and tells the page what changed: new rack events (taps, shakes, alarms), racks going offline or
// coming back, police incidents moving along.
//
//   const live = createLive({ every: 4000, want: { events: true, unknown: true, incidents: true, cards: true } });
//   live.on("change", (state) => render(state));
//   live.on("event", (e) => react(e));            // only events that arrive after the page opened
//   live.on("rack", ({ rack, before }) => ...);   // a rack's status / alarm / incident changed
//   live.on("incident", ({ incident, before }) => ...);
//   live.on("connection", (ok, message) => ...);
//   live.start();  live.refresh();  // refresh right after an action, so the page updates at once
import { api } from "../js/api.js";

/** Polls the backend every `every` ms for the data in `want` and emits change / event / rack / incident. */
export function createLive({ every = 4000, want = {} } = {}) {
  const state = { racks: [], events: [], unknown: [], incidents: [], cards: [], requests: [], ok: null, loaded: false };
  const handlers = {};
  const seenEvents = new Set();
  let timer = null;
  let running = false;
  let inFlight = null;

  const emit = (name, ...args) => (handlers[name] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } });

  async function load() {
    const [racks, events, unknown, incidents, cards, requests] = await Promise.all([
      api("/racks"),
      want.events ? api("/events", { query: { size: 60 } }) : null,
      want.unknown ? api("/credentials/unknown") : null,
      want.incidents ? api("/incidents") : null,
      want.cards ? api("/credentials") : null,
      want.requests ? api("/access-requests", { query: { status: "PENDING" } }) : null,
    ]);
    const first = !state.loaded;

    // Racks: what changed since last time?
    const before = new Map(state.racks.map((r) => [r.id, r]));
    if (!first) {
      for (const r of racks) {
        const b = before.get(r.id);
        if (b && (b.status !== r.status || b.openAlarms !== r.openAlarms || b.incidentStatus !== r.incidentStatus)) emit("rack", { rack: r, before: b });
      }
    }
    state.racks = racks;

    if (events) {
      // Newest first from the server; hand new ones to the page oldest first.
      const fresh = events.items.filter((e) => !seenEvents.has(e.id)).reverse();
      for (const e of fresh) seenEvents.add(e.id);
      state.events = events.items;
      if (!first) for (const e of fresh) emit("event", e);
    }
    if (incidents) {
      const old = new Map(state.incidents.map((i) => [i.id, i]));
      if (!first) {
        for (const i of incidents) if (old.get(i.id)?.status !== i.status) emit("incident", { incident: i, before: old.get(i.id) || null });
        for (const [id, i] of old) if (!incidents.some((x) => x.id === id)) emit("incident", { incident: { ...i, status: "RESOLVED" }, before: i });
      }
      state.incidents = incidents;
    }
    if (unknown) state.unknown = unknown;
    if (cards) state.cards = cards;
    if (requests) {
      if (!first) for (const q of requests) if (!state.requests.some((x) => x.id === q.id)) emit("request", q);
      state.requests = requests;
    }
    state.loaded = true;
    emit("change", state, first);
  }

  async function tick() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await load();
        if (state.ok !== true) { state.ok = true; emit("connection", true, ""); }
      } catch (e) {
        if (state.ok !== false) { state.ok = false; emit("connection", false, e.message || "Can't reach the server"); }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function loop() {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(async () => { await tick(); loop(); }, document.hidden ? every * 3 : every);
  }

  return {
    state,
    on(name, fn) { (handlers[name] ||= []).push(fn); return this; },
    async start() { running = true; await tick(); loop(); },
    stop() { running = false; clearTimeout(timer); },
    /** Re-read now (after an action), then carry on polling. */
    async refresh() { await tick(); loop(); },
  };
}

// ---------- small shared helpers ----------

/** "Squires North" -> "squires-north": the name you type in the terminal. */
export const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Finds a rack by its short name, the start of its name, or any word of it. */
export function findRack(racks, text) {
  const s = slug(text || "");
  if (!s) return null;
  return racks.find((r) => slug(r.name) === s)
    || racks.find((r) => slug(r.name).startsWith(s))
    || racks.find((r) => slug(r.name).split("-").includes(s))
    || null;
}

/** A tamper alarm is open at this rack. */
export const isAlarm = (r) => r.openAlarms > 0;
/** The rack is up: ONLINE, or WARNING (online with a sensor problem or alert). */
export const isUp = (r) => r.status === "ONLINE" || r.status === "WARNING";

/** For the map pins (pin.riv): police (an open incident) > alarm > status. The label shows open spots. */
export const pinRack = (r) => ({ ...r, alarm: isAlarm(r), police: Boolean(r.incidentStatus), label: `${r.name} · ${spotsText(r)}` });

/** "2 of 3 spots open" / "Full" / "No lock module". */
export function spotsText(r, short = false) {
  if (r.deviceCount === 0 && r.capacitySetting == null) return "Not set up";
  if (r.openSpots === 0) return "Full";
  return short ? `${r.openSpots} open` : `${r.openSpots} of ${r.capacity} spot${r.capacity === 1 ? "" : "s"} open`;
}

/** "Alarm now" / "Last alarm 3h ago" / "No alarms". */
export function alarmText(r, ago) {
  if (r.openAlarms > 0) return "Alarm now";
  return r.lastAlarmAt ? `Last alarm ${ago(r.lastAlarmAt)}` : "No alarms";
}

export const INCIDENT_WORD = { ALERTED: "Alerted", EN_ROUTE: "On the Way", ON_SCENE: "On Scene", RESOLVED: "Resolved" };
export const STATUS_TEXT = { ONLINE: "Online", WARNING: "Needs a Look", UNCONFIRMED: "Back, Not Confirmed", OFFLINE: "Offline", UNKNOWN: "No Lock Module" };

/** Wi-Fi strength (dBm) -> 0..4 bars for signal.riv. */
export function bars(rssi, online = true) {
  if (!online || rssi == null) return 0;
  return rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
}
