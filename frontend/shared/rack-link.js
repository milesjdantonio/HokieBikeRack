// The USB link to the rack (the Arduino Uno), shared by everything on the page: the Testing
// panel and the dashboard's rack connection both use this one port, because only one program
// can hold it. Web Serial, so Chrome or Edge on localhost or https.
//
//   link.connect()        asks the browser for the port (call it straight from a click)
//   link.send("status")   sends one serial command
//   link.onLine(fn)       fn(line, { sent, sim }) for every line; sim = the test command just sent, or ""
//   link.onChange(fn)     fn(link) when connected / ready changes
//
// The rack restarts when a computer opens the port, so `ready` turns true at its "Ready." line.
const BAUD = 115200;
const SIM_ONLY = new Set(["tap", "shake", "buzz", "servo", "lock", "unlock", "silence", "cancel"]);

const lineFns = new Set();
const changeFns = new Set();
let port = null, reader = null, writer = null, readDone = null, writeDone = null;
let lastSim = { word: "", at: 0 };

export const link = {
  supported: typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext,
  connected: false,
  ready: false,
  firmware: "",

  async connect() {
    if (this.connected) return true;
    let picked;
    try {
      picked = await navigator.serial.requestPort();
    } catch (err) {
      if (err && err.name === "NotFoundError") return false; // the picker was closed
      throw err;
    }
    await picked.open({ baudRate: BAUD });
    port = picked;
    const enc = new TextEncoderStream();
    writeDone = enc.readable.pipeTo(port.writable).catch(() => {});
    writer = enc.writable.getWriter();
    const dec = new TextDecoderStream();
    readDone = port.readable.pipeTo(dec.writable).catch(() => {});
    reader = dec.readable.getReader();
    this.connected = true;
    this.ready = false;
    changed();
    readLoop();
    // Normally "Ready." arrives within ~3 s; a board that didn't restart never says it.
    setTimeout(() => { if (this.connected && !this.ready) { this.ready = true; changed(); } }, 6000);
    return true;
  },

  async disconnect() {
    if (!this.connected) return;
    const r = reader, w = writer, p = port;
    this.connected = false;
    this.ready = false;
    reader = writer = port = null;
    try { if (r) await r.cancel(); } catch (e) { /* already gone */ }
    try { await readDone; } catch (e) { /* ignore */ }
    try { if (w) { await w.close(); await writeDone; } } catch (e) { /* ignore */ }
    try { if (p) await p.close(); } catch (e) { /* ignore */ }
    changed();
  },

  async send(command) {
    if (!writer) return false;
    const word = command.trim().split(/\s+/)[0];
    if (SIM_ONLY.has(word)) lastSim = { word, at: Date.now() };
    emit("> " + command, true);
    try { await writer.write(command + "\n"); return true; } catch (e) { return false; }
  },

  onLine(fn) { lineFns.add(fn); return () => lineFns.delete(fn); },
  onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
};

function changed() { for (const fn of changeFns) { try { fn(link); } catch (e) { console.error(e); } } }

// `sent` lines are our own commands echoed into the log. `sim` names the test command (tap,
// shake...) sent in the last 2 s, so the bridge can tell a test from a real card or jolt.
function emit(line, sent = false) {
  const info = { sent, sim: !sent && Date.now() - lastSim.at < 2000 ? lastSim.word : "" };
  for (const fn of lineFns) { try { fn(line, info); } catch (e) { console.error(e); } }
}

async function readLoop() {
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (!line.trim()) continue;
        let m;
        if ((m = line.match(/^HokieBikeRack firmware (\S+)/))) link.firmware = m[1];
        if (/^Ready\./.test(line) && !link.ready) { link.ready = true; changed(); }
        emit(line);
      }
    }
  } catch (err) {
    emit("Lost the rack: " + (err && err.message ? err.message : err));
  }
  if (link.connected) link.disconnect();
}

if (link.supported) {
  navigator.serial.addEventListener("disconnect", (e) => {
    if (port && e.target === port) { emit("The rack was unplugged."); link.disconnect(); }
  });
}
