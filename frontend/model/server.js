// A tiny stand-in for the Spring backend, for the rack model only (docs/notes/firmware-model.md).
// It answers the three device endpoints the firmware's network task calls (docs/API.md):
//   GET  /api/v1/devices/{id}/authorization-snapshot
//   POST /api/v1/devices/{id}/heartbeat
//   POST /api/v1/devices/{id}/events
// and checks the Bearer token like the real one. It keeps everything in memory.

export class ModelServer {
  constructor({ deviceId, token, validityHours, nowEpoch }) {
    this.deviceId = deviceId;
    this.token = token;
    this.validityHours = validityHours;
    this.nowEpoch = nowEpoch;
    this.running = true;
    this.revision = Date.now();
    this.cards = new Map();    // credential reference -> { label, addedAt }
    this.unknown = new Map();  // reference -> { count, lastEpoch }
    this.events = [];          // newest first
    this.seen = new Set();     // event IDs already stored (retries are not duplicates)
    this.lastHeartbeat = null; // { epoch, body }
    this.requests = 0;
    this.changed = () => {};
  }

  register(ref, label) {
    this.cards.set(ref, { label, addedAt: this.nowEpoch() });
    this.unknown.delete(ref);
    this.bump();
  }

  revoke(ref) {
    if (this.cards.delete(ref)) this.bump();
  }

  bump() {
    this.revision = Math.max(this.revision + 1, Date.now());
    this.changed();
  }

  // Called by the firmware's HTTPClient (through the model). Returns { status, body }.
  // status -1 = nobody answered, as HTTPClient reports a refused connection.
  handle(method, url, headers, body) {
    if (!this.running) return { status: -1, body: "" };
    this.requests++;
    const m = url.match(/\/api\/v1\/devices\/([^/]+)\/([a-z-]+)$/);
    if (!m) return json(404, { error: "not found" });
    if (m[1] !== this.deviceId || headers.Authorization !== `Bearer ${this.token}`) {
      return json(401, { error: "bad device token" });
    }
    const now = this.nowEpoch();
    if (method === "GET" && m[2] === "authorization-snapshot") return json(200, this.snapshot(now));
    if (method === "POST" && m[2] === "heartbeat") {
      this.lastHeartbeat = { epoch: now, body: parse(body) };
      this.changed();
      return json(200, { serverTime: iso(now), currentRevision: this.revision });
    }
    if (method === "POST" && m[2] === "events") {
      const events = parse(body)?.events;
      if (!Array.isArray(events)) return json(400, { error: "events must be an array" });
      let accepted = 0;
      for (const e of events) {
        if (!e?.id || this.seen.has(e.id)) continue;
        this.seen.add(e.id);
        accepted++;
        this.events.unshift({ ...e, receivedEpoch: now });
        const ref = e.details?.credentialReference;
        if (e.eventType === "ACCESS_DENIED" && ref && !this.cards.has(ref)) {
          const u = this.unknown.get(ref) || { count: 0, lastEpoch: now };
          u.count++;
          u.lastEpoch = now;
          this.unknown.set(ref, u);
        }
      }
      this.events.length = Math.min(this.events.length, 200);
      if (accepted) this.changed();
      return json(200, { accepted });
    }
    return json(404, { error: "not found" });
  }

  snapshot(now) {
    const refs = [...this.cards.keys()].sort();
    const until = now + this.validityHours * 3600;
    return {
      deviceId: this.deviceId, rackId: "model-rack", revision: this.revision,
      issuedAt: iso(now), issuedAtEpoch: now, validUntil: iso(until), validUntilEpoch: until,
      credentialCount: refs.length, credentialReferences: refs,
    };
  }
}

function json(status, value) {
  return { status, body: JSON.stringify(value) };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function iso(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
