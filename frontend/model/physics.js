// Physics around the firmware model: how the post moves and what the MPU-6050 feels, and how far
// the servo arm has turned. This is the "world", not the firmware. The numbers here are simple
// guesses, marked as such on the page; the real ones come from the bench test
// (docs/notes/hardware-test-checklist.md, section 5).

const G = 9.81;

export const POST = {
  topHeight: 0.875,     // m, top of the head
  sensorHeight: 0.61,   // m, where the MPU-6050 is glued inside the post
  naturalHz: 3.5,       // the post's sway frequency in its footing (guess)
  damping: 0.12,        // fraction of critical damping (guess)
  maxSway: 0.05,        // m at the top; the footing doesn't allow more
};

export class Physics {
  constructor() {
    this.t = 0;                 // ms of model time already simulated
    this.x = 0; this.vx = 0;    // sway of the top along the rail (m, m/s)
    this.z = 0; this.vz = 0;    // sway front to back
    this.lean = 0;              // degrees the post is tilted (toward +x)
    this.leanTarget = 0;
    this.leanRate = 40;         // degrees per second the post can be pushed over
    this.drag = null;           // { x, z } while you drag the post with the pointer
    this.shakes = [];           // { from, to, hz, amp, axis }
    this.knocks = [];           // { at, speed, axis }
    this.lastAccel = [0, 1, 0];
  }

  // ---- inputs, timed in model ms ----
  knock(at, speed = 0.06, axis = "z") { this.knocks.push({ at, speed, axis }); }
  shake(from, ms = 2000, hz = 3.5, amp = 0.025, axis = "x") {
    this.shakes.push({ from, to: from + ms, hz, amp, axis });
  }
  setLean(deg) { this.leanTarget = deg; }
  setDrag(target) { this.drag = target; }

  // Integrate up to `tMs` in 1 ms steps and return the accelerometer reading in g, in the
  // sensor's own axes: the board is glued to the post's inner wall on its side, so x is along
  // the rail, y is up (gravity reads +1 g here) and z points out of the front of the post.
  sample(tMs) {
    if (tMs < this.t) this.t = tMs;  // a new boot restarts the clock
    const w = 2 * Math.PI * POST.naturalHz;
    const ratio = POST.sensorHeight / POST.topHeight;
    let ax = 0, az = 0;
    const dt = 0.001;
    while (this.t < tMs) {
      this.t += 1;
      for (const k of this.knocks) {
        if (!k.done && this.t >= k.at) {
          k.done = true;
          if (k.axis === "x") this.vx += k.speed;
          else this.vz += k.speed;
        }
      }
      let tx = 0, tz = 0, stiffX = w * w, stiffZ = w * w;
      for (const s of this.shakes) {
        if (this.t >= s.from && this.t < s.to) {
          const fade = Math.min(1, (this.t - s.from) / 150, (s.to - this.t) / 150);
          const d = s.amp * fade * Math.sin(2 * Math.PI * s.hz * (this.t - s.from) / 1000);
          if (s.axis === "x") { tx += d; stiffX = 4 * w * w; } else { tz += d; stiffZ = 4 * w * w; }
        }
      }
      if (this.drag) {
        tx = this.drag.x; tz = this.drag.z;
        stiffX = stiffZ = 6 * w * w;
      }
      ax = -stiffX * (this.x - tx) - 2 * POST.damping * Math.sqrt(stiffX) * this.vx;
      az = -stiffZ * (this.z - tz) - 2 * POST.damping * Math.sqrt(stiffZ) * this.vz;
      this.vx += ax * dt; this.vz += az * dt;
      this.x += this.vx * dt; this.z += this.vz * dt;
      const limit = POST.maxSway;
      if (Math.abs(this.x) > limit) { this.x = Math.sign(this.x) * limit; this.vx *= -0.3; }
      if (Math.abs(this.z) > limit) { this.z = Math.sign(this.z) * limit; this.vz *= -0.3; }
      const step = this.leanRate / 1000;
      this.lean += Math.max(-step, Math.min(step, this.leanTarget - this.lean));
    }
    this.knocks = this.knocks.filter((k) => !k.done);
    this.shakes = this.shakes.filter((s) => s.to > this.t);
    const lean = this.lean * Math.PI / 180;
    this.lastAccel = [ax * ratio / G + Math.sin(lean), Math.cos(lean), az * ratio / G];
    return this.lastAccel;
  }

  get busy() { return this.shakes.length > 0 || this.drag !== null; }
}

// The MG90S follows its pulse width at its rated speed, if its 5 V supply is on. The firmware
// never finds out whether it did: there is no position feedback.
export class ServoArm {
  constructor(assume) {
    this.assume = assume;
    this.angle = null;   // degrees; null until the first pulse arrives
    this.target = null;
    this.powered = true;
  }

  pulse(us) {
    const { servoUs0, servoUs180 } = this.assume;
    this.target = Math.max(0, Math.min(180, (us - servoUs0) / (servoUs180 - servoUs0) * 180));
    if (this.angle === null) this.angle = 90;  // where the horn happened to be at power-on
  }

  advance(ms) {
    if (this.target === null || !this.powered) return;
    const step = this.assume.servoDegPerS * ms / 1000;
    this.angle += Math.max(-step, Math.min(step, this.target - this.angle));
  }
}
