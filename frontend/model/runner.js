// Loads the compiled firmware (firmware.js, built by tools/model/build.mjs) and runs it.
// A reboot throws the WebAssembly instance away (all RAM gone, like the real chip) and starts a
// fresh one, copying the EEPROM across first, because EEPROM survives a power cut.
import createFirmware from "./firmware.js";

export const RESET = { POWER_ON: 1, WATCHDOG: 2 };

export class FirmwareRunner {
  // preloadCards: card IDs enrolled on the very first boot, as if done on the bench earlier.
  constructor({ physics, onBoot, preloadCards = [] }) {
    this.physics = physics;
    this.onBoot = onBoot || (() => {});
    this.preloadCards = preloadCards;
    this.fw = null;
    this.eeprom = null;  // 1024 bytes as hex; null = a new chip, never booted
    this.inputs = { links: [true, true], card: null };
    this.worldMsBeforeBoot = 0;  // model time used up by earlier boots
    this.boots = 0;
    this.config = null;
  }

  async boot(reason = RESET.POWER_ON) {
    if (this.fw) {
      this.eeprom = this.str(this.fw._hbr_eeprom_get());
      this.worldMsBeforeBoot += this.fw._hbr_now_ms();
    }
    const hooks = { accel: (ms) => this.physics.sample(this.worldMsBeforeBoot + ms) };
    const fw = await createFirmware({ hooks, print: () => {}, printErr: (t) => console.warn("[firmware]", t) });
    if (this.eeprom) this.call(fw, "hbr_eeprom_put", this.eeprom);
    else for (const uid of this.preloadCards) this.call(fw, "hbr_preload_card", uid);
    fw._hbr_link(0, this.inputs.links[0] ? 1 : 0);
    fw._hbr_link(1, this.inputs.links[1] ? 1 : 0);
    if (this.inputs.card) this.call(fw, "hbr_card", 1, this.inputs.card);
    this.fw = fw;
    this.boots++;
    fw._hbr_boot(reason, (Math.random() * 0xffffffff) >>> 0);
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
  get resetReason() { return this.fw ? this.fw._hbr_reset_reason() : RESET.POWER_ON; }
  get nowMs() { return this.fw ? this.fw._hbr_now_ms() : 0; }
  get worldMs() { return this.worldMsBeforeBoot + this.nowMs; }

  state() { return JSON.parse(this.str(this.fw._hbr_state())); }
  cardRef(uid) { return this.str(this.call(this.fw, "hbr_card_ref", uid)); }

  card(uid) {
    this.inputs.card = uid;
    if (uid) this.call(this.fw, "hbr_card", 1, uid);
    else this.fw._hbr_card(0, 0);
  }
  link(which, on) { this.inputs.links[which] = on; this.fw._hbr_link(which, on ? 1 : 0); }
  serial(text) { this.call(this.fw, "hbr_serial_write", text); }

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
