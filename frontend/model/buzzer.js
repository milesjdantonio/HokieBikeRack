// Plays the rack's active buzzer through the speakers: on exactly when the firmware drives the
// buzzer GPIO high. An active buzzer has one fixed pitch; ~2.4 kHz is typical (an assumption,
// it depends on the part). Off until you switch Sound on.
export class Buzzer {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.on = false;
  }

  enable(on) {
    this.on = on;
    if (on && !this.ctx) {
      this.ctx = new AudioContext();
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 2400;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      osc.connect(this.gain).connect(this.ctx.destination);
      osc.start();
    }
    if (this.ctx) on ? this.ctx.resume() : this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }

  // edges: [ms, pin, level] from this frame; frameStart/now in model ms; speed = model ms per real ms.
  play(edges, pin, frameStart, speed) {
    if (!this.on || !this.ctx || speed <= 0) return;
    const base = this.ctx.currentTime + 0.03;
    for (const [ms, p, level] of edges) {
      if (p !== pin) continue;
      const at = base + Math.max(0, (ms - frameStart) / speed / 1000);
      this.gain.gain.setValueAtTime(level ? 0.035 : 0, at);
    }
  }

  silence() {
    if (this.ctx) this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }
}
