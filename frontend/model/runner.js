// Loads the compiled firmware (firmware.js, built by tools/model/build.mjs) and runs it.
// A reboot throws the WebAssembly instance away (all RAM gone, like the real chip) and starts a
// fresh one, copying the flash files across first, because flash survives a power cut.
import createFirmware from "./firmware.js";

export const RESET = { POWER_ON: 1, SOFTWARE: 3 };

export class FirmwareRunner {
  constructor({ physics, server, onBoot }) {
    this.physics = physics;
    this.server = server;
    this.onBoot = onBoot || (() => {});
    this.fw = null;
    this.flash = {};
    this.inputs = { hotspot: true, links: [true, true], card: null };
    this.worldStart = Math.floor(Date.now() / 1000);  // real time when the page opened
    this.worldMsBeforeBoot = 0;                         // model time used up by earlier boots
    this.boots = 0;
    this.config = null;
  }

  async boot(reason = RESET.POWER_ON) {
    if (this.fw) {
      this.flash = JSON.parse(this.str(this.fw._hbr_flash_json()));
      this.worldMsBeforeBoot += this.fw._hbr_now_ms();
    }
    const hooks = {
      accel: (ms) => this.physics.sample(this.worldMsBeforeBoot + ms),
      http: (method, url, headers, body) => this.server.handle(method, url, headers, body),
    };
    const fw = await createFirmware({ hooks, print: () => {}, printErr: (t) => console.warn("[firmware]", t) });
    for (const [path, content] of Object.entries(this.flash)) {
      this.call(fw, "hbr_flash_put", path, content);
    }
    fw._hbr_hotspot(this.inputs.hotspot ? 1 : 0);
    fw._hbr_link(0, this.inputs.links[0] ? 1 : 0);
    fw._hbr_link(1, this.inputs.links[1] ? 1 : 0);
    if (this.inputs.card) this.call(fw, "hbr_card", 1, this.inputs.card);
    this.fw = fw;
    this.boots++;
    fw._hbr_boot(reason, this.worldEpoch(), (Math.random() * 0xffffffff) >>> 0);
    this.config = JSON.parse(this.str(fw._hbr_config()));
    this.onBoot(reason);
  }

  // Run the firmware forward by `ms` of model time. Returns what happened meanwhile.
  run(ms) {
    const fw = this.fw;
    fw._hbr_run_until(fw._hbr_now_ms() + ms);
    return JSON.parse(this.str(fw._hbr_take_log()));
  }

  get restartRequested() { return this.fw && this.fw._hbr_restart_requested() === 1; }
  get nowMs() { return this.fw ? this.fw._hbr_now_ms() : 0; }
  get worldMs() { return this.worldMsBeforeBoot + this.nowMs; }
  worldEpoch() { return this.worldStart + Math.floor(this.worldMs / 1000); }

  state() { return JSON.parse(this.str(this.fw._hbr_state())); }
  flashFile(path) { return this.str(this.call(this.fw, "hbr_flash_file", path)); }
  cardRef(uid) { return this.str(this.call(this.fw, "hbr_card_ref", uid)); }

  card(uid) {
    this.inputs.card = uid;
    if (uid) this.call(this.fw, "hbr_card", 1, uid);
    else this.fw._hbr_card(0, 0);
  }
  link(which, on) { this.inputs.links[which] = on; this.fw._hbr_link(which, on ? 1 : 0); }
  hotspot(on) { this.inputs.hotspot = on; this.fw._hbr_hotspot(on ? 1 : 0); }
  serial(text) { this.call(this.fw, "hbr_serial_write", text); }
  wipeFlash() { this.flash = {}; }

  str(ptr) { return this.fw ? this.fw.UTF8ToString(ptr) : ""; }

  // Calls an exported function, copying string arguments into the module's memory.
  call(fw, name, ...args) {
    const ptrs = [];
    const real = args.map((a) => {
      if (typeof a !== "string") return a;
      const bytes = new TextEncoder().encode(a + "\0");
      const p = fw._malloc(bytes.length);
      fw.HEAPU8.set(bytes, p);
      ptrs.push(p);
      return p;
    });
    try {
      return fw["_" + name](...real);
    } finally {
      for (const p of ptrs) fw._free(p);
    }
  }
}
