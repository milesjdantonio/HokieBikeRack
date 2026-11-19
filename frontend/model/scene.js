// The rack in 3D (three.js), shaped after the Lockpost concept model: two posts, a top rail and
// the yellow shackle. Post A carries the lock module with our real parts. Everything that moves
// is driven by app.js from the running firmware: LEDs and wires from GPIO levels, the servo
// horn and latch from the servo pulse, the post's sway from the physics.
//
// Three build options (docs/notes/firmware-model.md, "Build options"): the frame scales, but
// the parts are always drawn at their real size, so you can see whether they fit.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/addons/OrbitControls.js";
import { RoomEnvironment } from "../vendor/three/addons/RoomEnvironment.js";
import { RoundedBoxGeometry } from "../vendor/three/addons/RoundedBoxGeometry.js";

/** Shorthand for a 3D point. */
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Sizes in metres. Parts: real dimensions from their datasheets (check yours with calipers).
// The boards: x across the width, z along the length, USB end at -len/2. Header rows list their
// pins from the USB end (numbers = Arduino pin numbers, 14..19 = A0..A5); z0 is the first pin's
// distance from the USB edge. Board knowledge only: which pin a part uses comes from pins.h.
const BOARDS = {
  uno: {
    name: "Arduino Uno R3", w: 0.0534, len: 0.0686, pcb: "pcbUno", headerH: 0.0085,
    usb: { x: 0.0115, w: 0.012, h: 0.011, len: 0.016, overhang: 0.0063 },  // USB-B
    jack: { x: -0.019, w: 0.009, h: 0.011, len: 0.0137, overhang: 0.0018 },  // DC barrel jack
    chip: { x: -0.008, z: 0.0142, w: 0.0076, h: 0.0045, len: 0.0356 },        // ATmega328P, DIP-28
    rows: [
      { x: -0.0241, z0: 0.02794, names: ["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND", "VIN"] },
      { x: -0.0241, z0: 0.0508, names: [14, 15, 16, 17, 18, 19] },  // A0..A5 (A4 = SDA, A5 = SCL)
      { x: 0.0242, z0: 0.018, names: ["SCL", "SDA", "AREF", "GND", 13, 12, 11, 10, 9, 8] },
      { x: 0.0242, z0: 0.04496, names: [7, 6, 5, 4, 3, 2, 1, 0] },
    ],
  },
  nano: {
    name: "Arduino Nano", w: 0.018, len: 0.045, pcb: "pcbBlue", headerH: 0.006,
    usb: { x: 0, w: 0.0075, h: 0.004, len: 0.009, overhang: 0.001 },  // mini-USB
    chip: { x: 0, z: 0.004, w: 0.007, h: 0.0012, len: 0.007 },        // ATmega328P, TQFP-32
    rows: [
      { x: -0.0076, z0: 0.0047, names: [13, "3V3", "AREF", 14, 15, 16, 17, 18, 19, "A6", "A7", "5V", "RST", "GND", "VIN"] },
      { x: 0.0076, z0: 0.0047, names: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, "GND", "RST", 0, 1] },
    ],
  },
};
const SERVOS = {
  mg90s: { name: "MG90S Servo", body: [0.0225, 0.0285, 0.0122], ears: 0.032, earY: 0.006, shaft: [0.0055, 0.006], arm: 0.019 },
  submicro: { name: "Sub-Micro Servo", body: [0.02, 0.017, 0.0085], ears: 0.027, earY: 0.004, shaft: [0.005, 0.004], arm: 0.014 },
};
export const OPTIONS = {
  a: { key: "a", label: "A Standard", scale: 1, head: { w: 0.092, lo: 0.052, hi: 0.095 },
    board: "uno", servo: "mg90s", buzzer: { r: 0.006, h: 0.0095, name: "12 mm active buzzer" },
    cap: { r: 0.005, h: 0.016, name: "1000 µF, 16 V" },
    note: "The Uno (69 × 53 mm) plus its USB plug won't fit in the head beside the reader, so it stands in the post, USB down. A usable, full-size rack." },
  b: { key: "b", label: "B 0.75x", scale: 0.75, head: { w: 0.069, lo: 0.039, hi: 0.071 },
    board: "nano", servo: "mg90s", buzzer: { r: 0.006, h: 0.0095, name: "12 mm active buzzer" },
    cap: { r: 0.005, h: 0.016, name: "1000 µF, 16 V" },
    note: "Same servo and buzzer as A. The post is only 52 mm inside, too narrow for the Uno, so an Arduino Nano (same chip, same firmware) stands in it." },
  c: { key: "c", label: "C 0.5x Mini", scale: 0.5, head: { w: 0.06, lo: 0.04, hi: 0.062 },
    board: "nano", servo: "submicro", buzzer: { r: 0.0045, h: 0.0055, name: "9 mm active buzzer" },
    cap: { r: 0.004, h: 0.012, name: "470 µF, 10 V" },
    note: "Mini parts and a Nano, but the full-size PN532, so the head stays 60 mm. A tabletop demo model: too low to hold a bike." },
};

// Every frame dimension for one option.
export function makeRack(o) {
  const s = o.scale;
  const postW = 0.08 * s, wall = Math.max(0.003, 0.005 * s);
  const R = {
    s, o, postX: 0.45 * s, postW, wall, inner: postW - 2 * wall, postTop: 0.78 * s, railY: 0.75 * s, rail: 0.06 * s,
    face: postW / 2, sockY0: 0.25 * s, sockPitch: 0.0275 * s, sockR: 0.0146 * s, sockDx: 0.016 * s, legSpan: 8, sockN: 19,
    barR: 0.0125 * s, shackleDepth: 0.185 * s, legDepth: 0.034 * s, mpuY: 0.61 * s, servoY: 0.705 * s,
    plateTop: 0.672 * s, plateBottom: 0.38 * s, boltTravel: 0.034 * s, plateTravel: 0.012 * s, head: o.head,
    board: BOARDS[o.board], servo: SERVOS[o.servo],
  };
  R.headTop = R.postTop + o.head.hi;
  R.width = 2 * R.postX + postW;
  return R;
}

export const PARTS = {
  post: "Post", shackle: "Shackle", reader: "Reader Window", lights: "Lights", vents: "Buzzer Vents",
  board: "Arduino Uno R3", pn532: "PN532 Reader", mpu: "MPU-6050", servo: "MG90S Servo", latch: "Latch",
  buzzer: "Buzzer", parts: "Resistors and Transistor", tubing: "Light Tubing", cap: "Capacitor", supply: "5 V Supply", usb: "USB Cable",
};

export class RackScene {
  constructor(canvas, labelLayer, { onPick, onDrag, option = "a" }) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.onPick = onPick;
    this.onDrag = onDrag;
    this.inside = false;
    this.labels = [];
    this.mats = makeMaterials();

    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x120d10);
    scene.fog = new THREE.Fog(0x120d10, 5, 12);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.fly = null;

    const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
    sun.position.set(2.2, 4, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.2, near: 0.5, far: 10 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.01;
    scene.add(sun, new THREE.HemisphereLight(0xdfe6ee, 0x2a1d22, 0.5));
    this.ledLights = [new THREE.PointLight(0x3cff7a, 0, 0.6, 2), new THREE.PointLight(0xff3020, 0, 0.6, 2)];

    const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), this.mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    this.setOption(option, true);
    this.bindPointer();
  }

  // Build (or rebuild) the rack for one option.
  setOption(key, instant = false) {
    this.opt = OPTIONS[key] || OPTIONS.a;
    this.R = makeRack(this.opt);
    if (this.rack) {
      this.scene.remove(this.rack);
      this.rack.traverse((o) => o.geometry?.dispose());
    }
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.internals = [];
    this.outsideOnly = [];
    this.pickables = [];
    this.wires = {};
    this.rack = new THREE.Group();  // sways and leans as one welded frame
    this.scene.add(this.rack);
    this.buildFrame();
    this.buildHead();
    this.buildShackle();
    this.buildTubing();
    this.buildInternals();
    if (this.pins) this.wire(this.pins);
    this.setView(this.inside);
    this.focus("rack", instant);
  }

  partName(id) {
    if (id === "board") return this.R.board.name;
    if (id === "servo") return this.R.servo.name;
    return PARTS[id] || id;
  }

  // ---------------------------------------------------------------- building
  part(mesh, id) {
    mesh.userData.part = id;
    this.pickables.push(mesh);
    return mesh;
  }

  label(id, at, { inside = false, outside = false } = {}) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "scene-label";
    el.textContent = this.partName(id);
    el.addEventListener("click", () => this.onPick(id));
    this.labelLayer.append(el);
    this.labels.push({ el, at, id, inside, outside });
  }

  sockY(i) { return this.R.sockY0 + i * this.R.sockPitch; }

  buildFrame() {
    const m = this.mats, R = this.R, A = R.postX;
    for (const x of [A, -A]) {
      const shell = new THREE.Mesh(squareTube(R.postW, R.wall, R.postTop + 0.02), x === A ? m.shellA : m.galv);
      shell.position.set(x, -0.02, 0);
      shell.castShadow = shell.receiveShadow = true;
      this.rack.add(x === A ? this.part(shell, "post") : shell);
      if (x === A) this.postShell = shell;
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * R.s, 0.07 * R.s, 0.008, 32), m.galv);
      flange.position.set(x, 0.004, 0);
      flange.receiveShadow = true;
      this.rack.add(flange);
    }
    const rail = new THREE.Mesh(squareTube(R.rail, Math.max(0.003, 0.004 * R.s), 2 * (A - R.postW / 2)), m.galv);
    rail.rotation.z = -Math.PI / 2;
    rail.position.set(-(A - R.postW / 2), R.railY, 0);
    rail.castShadow = true;
    this.rack.add(rail);
    // Post B: plain cap, no electronics.
    const cap = new THREE.Mesh(new RoundedBoxGeometry(0.09 * R.s, 0.03 * R.s, 0.09 * R.s, 3, 0.008 * R.s), m.headShell);
    cap.position.set(-A, R.postTop + 0.015 * R.s, 0);
    cap.castShadow = true;
    this.rack.add(cap);
    // Socket rings on post A's face, the ones the shackle doesn't use shown empty.
    const ring = new THREE.TorusGeometry(R.sockR, 0.003 * R.s, 8, 28);
    const hole = new THREE.CircleGeometry(R.sockR - 0.001 * R.s, 28);
    for (let i = 0; i < R.sockN; i++) {
      const x = A + (i % 2 ? R.sockDx : -R.sockDx);
      const r = new THREE.Mesh(ring, m.rubber);
      r.position.set(x, this.sockY(i), R.face + 0.0006);
      const h = new THREE.Mesh(hole, m.hole);
      h.position.set(x, this.sockY(i), R.face + 0.0004);
      this.rack.add(r, h);
      this.outsideOnly.push(h);
    }
  }

  buildHead() {
    const m = this.mats, R = this.R, H = R.head, hw = H.w / 2;
    const head = new THREE.Group();
    head.position.set(R.postX, R.postTop, 0);
    this.rack.add(head);
    this.head = head;
    // Shell: a wedge, low at the front (rider side), high at the back.
    const s = new THREE.Shape();
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, H.lo); s.lineTo(-hw, H.hi); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: H.w, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(hw, 0, 0);
    const shell = new THREE.Mesh(geo, m.headShell);
    shell.castShadow = true;
    head.add(this.part(shell, "post"));
    this.headShell = shell;
    // Reader window on the slope, with the tap mark printed on it.
    const slope = Math.atan2(H.hi - H.lo, H.w);
    this.slope = slope;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(H.w * 0.76, H.w * 0.8), m.window);
    win.position.set(0, (H.lo + H.hi) / 2 + 0.0024, 0);
    win.rotation.x = -(Math.PI / 2 - slope);
    head.add(this.part(win, "reader"));
    this.label("reader", () => head.localToWorld(V(0, H.hi - 0.005, 0.01)), { outside: true });
    // LEDs through the front face.
    const ledX = Math.min(0.016, hw - 0.01), ledY = Math.min(0.026, H.lo - 0.012);
    this.ledAt = [V(-ledX, ledY, hw + 0.004), V(ledX, ledY, hw + 0.004)];
    [[-ledX, m.ledGreen], [ledX, m.ledRed]].forEach(([x, mat], i) => {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0029, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.rotation.x = Math.PI / 2;
      dome.position.set(x, ledY, hw + 0.0022);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0029, 0.0029, 0.006, 16), mat);
      body.rotation.x = Math.PI / 2;
      body.position.set(x, ledY, hw - 0.001);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0036, 0.0008, 6, 20), m.bright);
      bezel.position.set(x, ledY, hw + 0.002);
      head.add(this.part(dome, "lights"), body, bezel);
      this.ledLights[i].position.set(x, ledY, hw + 0.014);
      head.add(this.ledLights[i]);
    });
    // A Hokie Passport, shown hovering over the window while it is on the reader.
    if (!this.cardTex) {
      this.cardTex = canvasTexture(256, 160, (g, w, h) => {
        g.fillStyle = "#861f41"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#e5751f"; g.fillRect(0, h * 0.72, w, h * 0.1);
        g.fillStyle = "#f4eef0"; g.font = "600 26px Hanken Grotesk, system-ui, sans-serif";
        g.fillText("Hokie Passport", 18, 44);
      });
      this.cardMat = new THREE.MeshStandardMaterial({ map: this.cardTex, roughness: 0.5 });
    }
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.0008, 0.0856), [m.black, m.black, this.cardMat, m.black, m.black, m.black]);
    card.rotation.set(slope, 0.35, 0);
    card.position.set(0.004, (H.lo + H.hi) / 2 + 0.02, 0.006);
    card.visible = false;
    card.castShadow = true;
    head.add(card);
    this.card = card;
    this.label("lights", () => head.localToWorld(V(0, ledY - 0.014, hw + 0.014)), { outside: true });
    // Buzzer vents on the side.
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.004, Math.min(0.03, H.w * 0.4)), m.hole);
      vent.position.set(hw + 0.0015, 0.014 + i * 0.007, -0.01);
      head.add(this.part(vent, "vents"));
    }
    this.label("vents", () => head.localToWorld(V(hw + 0.014, H.lo, -0.01)), { outside: true });
  }

  buildShackle() {
    const m = this.mats, R = this.R;
    const g = new THREE.Group();
    this.shackle = g;
    this.rack.add(g);
    const r = R.barR, depth = R.shackleDepth, c = 0.032 * R.s;
    const low = 6;  // socket index of the lower leg
    const x = R.postX + (low % 2 ? R.sockDx : -R.sockDx);  // both legs use the same socket column
    const legY = [this.sockY(low), this.sockY(low + R.legSpan)];
    const [lo, hi] = legY;
    // A U: out of the lower socket, up the front, back into the upper socket.
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(V(x, lo, R.face), V(x, lo, depth - c)));
    path.add(new THREE.QuadraticBezierCurve3(V(x, lo, depth - c), V(x, lo, depth), V(x, lo + c, depth)));
    path.add(new THREE.LineCurve3(V(x, lo + c, depth), V(x, hi - c, depth)));
    path.add(new THREE.QuadraticBezierCurve3(V(x, hi - c, depth), V(x, hi, depth), V(x, hi, depth - c)));
    path.add(new THREE.LineCurve3(V(x, hi, depth - c), V(x, hi, R.face)));
    const bar = new THREE.Mesh(new THREE.TubeGeometry(path, 160, r, 18, false), m.shackle);
    bar.castShadow = true;
    g.add(this.part(bar, "shackle"));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.085 * R.s, 20), m.rubber);
    grip.position.set(x, (lo + hi) / 2, depth);
    g.add(this.part(grip, "shackle"));
    // Leg tips inside the post: a ramp at the end, then the groove the spring latch drops into.
    for (const y of legY) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.84, r * 0.84, R.legDepth * 0.88, 18), m.hard);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(x, y, R.face - R.legDepth * 0.44);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.008 * R.s, 18), m.bright);
      neck.rotation.x = Math.PI / 2;
      neck.position.set(x, y, R.face - R.legDepth);
      g.add(tip, neck);
      this.insideOnly(tip, neck);
    }
    this.label("shackle", () => this.rack.localToWorld(V(x, (lo + hi) / 2 + 0.07 * R.s, depth)), { outside: true });
  }

  // Light tubing wrapped twice around the top of the post, at the base of the lock module.
  // The green LED shines into one end and the red LED into the other, so the whole tube shows
  // the light colour from every side.
  buildTubing() {
    const head = this.head, H = this.R.head;
    const half = H.w / 2 + 0.006, y0 = 0.007, rise = 0.011, turns = 2;
    const pts = [];
    const ringPoint = (u) => {  // u in 0..1 around a rounded square, starting at the front
      const a = u * Math.PI * 2 + Math.PI / 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const k = 1 / Math.max(Math.abs(c), Math.abs(sn)) ** 0.85;  // squarish, rounded corners
      return [c * half * Math.min(k, 1.3), sn * half * Math.min(k, 1.3)];
    };
    const [g, r] = this.ledAt;
    pts.push(g.clone().add(V(0, 0, 0.001)));  // green LED end
    pts.push(V(g.x * 0.75, y0 + 0.004, half + 0.004));
    const n = 96 * turns;
    for (let i = 0; i <= n; i++) {
      const [x, z] = ringPoint(i / 96);
      pts.push(V(x, y0 + rise * (i / n), z));
    }
    pts.push(V(r.x * 0.75, y0 + rise + 0.004, half + 0.004));
    pts.push(r.clone().add(V(0, 0, 0.001)));  // red LED end
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e4e6, roughness: 0.35, transparent: true, opacity: 0.85,
      emissive: 0xffffff, emissiveIntensity: 0 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 420, 0.0032, 10), mat);
    tube.castShadow = true;
    head.add(this.part(tube, "tubing"));
    this.tubeMat = mat;
    this.label("tubing", () => head.localToWorld(V(-half - 0.01, 0.0, 0.03)), { outside: true });
  }

  insideOnly(...meshes) {
    this.internals.push(...meshes);
  }

  buildInternals() {
    const m = this.mats, R = this.R, A = R.postX, H = R.head, hw = H.w / 2, head = this.head, o = this.opt;
    // The Arduino board stands in the post against the back wall, USB down. Its length runs up
    // the post, and its parts and headers (the board's -y side) face the front.
    const B = R.board;
    const board = new THREE.Group();
    board.position.set(A, 0.27 * R.s, -R.inner / 2 + 0.003);
    board.rotation.x = -Math.PI / 2;
    this.rack.add(board);
    const side = -1;  // which side of the PCB the parts are on
    board.add(this.part(new THREE.Mesh(new THREE.BoxGeometry(B.w, 0.0016, B.len), m[B.pcb]), "board"));
    const block = (w, h, len, mat, x, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
      b.position.set(x, side * (0.0008 + h / 2), z);
      board.add(this.part(b, "board"));
    };
    block(B.usb.w, B.usb.h, B.usb.len, m.bright, B.usb.x, -B.len / 2 + B.usb.len / 2 - B.usb.overhang);
    if (B.jack) block(B.jack.w, B.jack.h, B.jack.len, m.black, B.jack.x, -B.len / 2 + B.jack.len / 2 - B.jack.overhang);
    block(B.chip.w, B.chip.h, B.chip.len, m.chip328, B.chip.x, B.chip.z);
    this.headerPins = {};
    for (const row of B.rows) {
      const z0 = -B.len / 2 + row.z0, n = row.names.length;
      block(0.0025, B.headerH, (n - 1) * 0.00254 + 0.0025, m.black, row.x, z0 + (n - 1) * 0.00127);
      row.names.forEach((name, i) => {
        if (!(name in this.headerPins)) {
          this.headerPins[name] = { group: board, at: V(row.x, side * (0.0013 + B.headerH), z0 + i * 0.00254) };
        }
      });
    }
    this.board = board;
    this.usbEnd = () => board.localToWorld(V(B.usb.x, side * (0.0008 + B.usb.h / 2), -B.len / 2 - B.usb.overhang - 0.006));
    this.insideOnly(board);
    this.label("board", () => board.localToWorld(V(0, side * 0.014, 0)), { inside: true });

    // PN532 under the reader window, parallel to it. Always full size: cards are.
    const pn = new THREE.Group();
    pn.position.set(0, (H.lo + H.hi) / 2 - 0.008, 0);
    pn.rotation.x = this.slope;  // board normal tilts toward the rider, like the window
    head.add(pn);
    pn.add(this.part(new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.0016, 0.04), m.pcbRed), "pn532"));
    const loop = new THREE.Mesh(roundedRectRing(0.034, 0.03, 0.006, 0.0012), m.copper);
    loop.rotation.x = -Math.PI / 2;
    loop.position.y = 0.0009;
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0012, 0.006), m.chip);
    chip.position.set(0.01, 0.0012, -0.012);
    pn.add(loop, chip);
    this.pn = pn;
    this.insideOnly(pn);
    this.label("pn532", () => pn.localToWorld(V(0, 0.01, 0.0)), { inside: true });

    // Buzzer, and the little board with the LED resistors and the buzzer transistor.
    const bz = o.buzzer;
    const buzzer = new THREE.Mesh(new THREE.CylinderGeometry(bz.r, bz.r, bz.h, 24), m.black);
    buzzer.position.set(hw - 0.012, 0.012, -Math.min(0.01, hw * 0.3));
    head.add(this.part(buzzer, "buzzer"));
    this.buzzerMesh = buzzer;
    const perf = new THREE.Group();
    perf.position.set(-hw + 0.016, 0.01, hw - 0.022);
    head.add(perf);
    perf.add(this.part(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0016, 0.016), m.perf), "parts"));
    for (let i = 0; i < 3; i++) {
      const res = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.0065, 10), m.resistor);
      res.rotation.z = Math.PI / 2;
      res.position.set(0, 0.0018, -0.005 + i * 0.004);
      perf.add(res);
    }
    const npn = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0045, 16, 1, false, 0, Math.PI), m.black);
    npn.position.set(0.006, 0.003, 0.005);
    perf.add(npn);
    this.perf = perf;
    this.insideOnly(buzzer, perf);
    this.label("buzzer", () => buzzer.localToWorld(V(0.006, 0.014, 0)), { inside: true });

    // MPU-6050 (GY-521) glued to the inside of the post's back wall, on its side.
    const mpu = new THREE.Group();
    mpu.position.set(A, R.mpuY, -R.inner / 2 + 0.001);
    this.rack.add(mpu);
    mpu.add(this.part(new THREE.Mesh(new THREE.BoxGeometry(0.021, 0.016, 0.0016), m.pcbBlue), "mpu"));
    const mpuChip = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.001), m.chip);
    mpuChip.position.z = 0.0012;
    mpu.add(mpuChip);
    this.mpu = mpu;
    this.insideOnly(mpu);
    this.label("mpu", () => mpu.localToWorld(V(0.03, 0.0, 0.01)), { inside: true });

    // Servo, horn, push rod and the spring latch (plate + tab) on the shackle's grooves.
    const S = R.servo;
    const servo = new THREE.Group();
    servo.position.set(A - 0.008 * R.s, R.servoY, -0.006 * R.s);
    this.rack.add(servo);
    const body = new THREE.Mesh(new THREE.BoxGeometry(...S.body), m.servo);
    const ears = new THREE.Mesh(new THREE.BoxGeometry(S.ears, 0.0025, S.body[2]), m.servo);
    ears.position.y = S.earY;
    servo.add(this.part(body, "servo"), this.part(ears, "servo"));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 16), m.bright);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(S.shaft[0], S.shaft[1], S.body[2] / 2 + 0.002);
    servo.add(shaft);
    const horn = new THREE.Group();
    horn.position.copy(shaft.position).add(V(0, 0, 0.0025));
    servo.add(horn);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(S.arm, 0.004, 0.0016), m.horn);
    arm.position.x = S.arm * 0.4;
    horn.add(arm);
    this.horn = horn;
    this.hornTip = S.arm * 0.8;
    this.servo = servo;
    const plateZ = R.face - R.legDepth;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05 * R.s, R.plateTop - R.plateBottom, 0.003), m.hard);
    plate.position.set(A, (R.plateTop + R.plateBottom) / 2, plateZ);
    this.rack.add(this.part(plate, "latch"));
    this.plate = plate;
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.03 * R.s, 0.006, 0.012 * R.s), m.bolt);
    bolt.position.set(A, R.plateTop + 0.0035, plateZ);
    this.rack.add(this.part(bolt, "latch"));
    this.bolt = bolt;
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 1, 8), m.bright);
    this.rack.add(this.rod);
    this.insideOnly(servo, plate, bolt, this.rod);
    this.label("servo", () => servo.localToWorld(V(-0.02, 0.02, 0)), { inside: true });
    this.label("latch", () => this.rack.localToWorld(V(A - 0.05 * R.s, R.plateTop + 0.01, R.face)), { inside: true });

    // Capacitor across the servo's 5 V, close to the servo.
    const cp = o.cap;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(cp.r, cp.r, cp.h, 20), m.cap);
    cap.position.set(A + Math.min(0.022 * R.s + 0.01, R.inner / 2 - cp.r - 0.001), R.servoY - 0.03 * R.s, -R.inner / 2 + cp.r + 0.003);
    this.rack.add(this.part(cap, "cap"));
    this.insideOnly(cap);
    this.label("cap", () => cap.localToWorld(V(0.02, -0.01, 0)), { inside: true });

    this.pinAt = (gpio) => {
      const p = this.headerPins[gpio];
      return p ? p.group.localToWorld(p.at.clone()) : head.localToWorld(V(0, 0.005, 0));
    };
    this.rack.updateMatrixWorld(true);
  }

  // Called once the firmware's pin numbers are known (from the compiled pins.h).
  wire(pins) {
    this.pins = pins;
    const R = this.R, A = R.postX, hw = R.head.w / 2;
    for (const w of Object.values(this.wires)) this.rack.remove(w.mesh);
    this.wires = {};
    this.rack.updateMatrixWorld(true);
    const toRack = (v) => this.rack.worldToLocal(v.clone());
    const head = (x, y, z) => toRack(this.head.localToWorld(V(x, y, z)));
    const add = (id, color, points, radius = 0.0011) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, radius, 6), mat);
      this.rack.add(mesh);
      this.internals.push(mesh);
      mesh.visible = this.inside;
      this.wires[id] = { mesh, mat };
    };
    const pin = (g) => toRack(this.pinAt(g));
    const mpuPad = (dx) => toRack(this.mpu.localToWorld(V(-0.006 + dx, 0.008, 0.002)));
    const pnPad = (dx) => toRack(this.pn.localToWorld(V(-0.012 + dx, -0.002, -0.016)));
    const ledIn = (i) => toRack(this.head.localToWorld(this.ledAt[i].clone().add(V(0, 0, -0.008))));
    const buzzIn = toRack(this.buzzerMesh.localToWorld(V(0, -0.003, 0)));
    const servoIn = toRack(this.servo.localToWorld(V(-R.servo.body[0] / 2, -0.008, 0)));
    // The board stands in the post: every wire runs up or down the side wall in its own lane.
    const wallX = A - R.inner / 2 + 0.004;
    let lane = 0;
    const route = (id, from, to) => {
      const z = -R.inner / 2 + 0.008 + (lane++ % 8) * Math.min(0.003, R.inner / 20);
      const dir = Math.sign(to.y - from.y) || 1;
      return [from, from.clone().add(V(0, 0, 0.006)), V(wallX, from.y + dir * 0.01, z),
        V(wallX, to.y - dir * 0.015, z), to];
    };
    // I2C to the MPU-6050 and the PN532 (same two pins, A4 and A5, both chips on the bus).
    // Both modules run from the Uno's 5 V pin (they have their own 3.3 V regulators).
    add("sdaMpu", 0x3d7bff, route("sdaMpu", pin(pins.sda), mpuPad(0.004)));
    add("sclMpu", 0xf2d03a, route("sclMpu", pin(pins.scl), mpuPad(0.0)));
    add("vccMpu", 0xff9c3a, route("vccMpu", pin("5V"), mpuPad(-0.004)));
    add("gndMpu", 0x222222, route("gndMpu", pin("GND"), mpuPad(-0.008)));
    add("sdaPn", 0x3d7bff, route("sdaPn", pin(pins.sda), pnPad(0)));
    add("sclPn", 0xf2d03a, route("sclPn", pin(pins.scl), pnPad(0.004)));
    // LEDs (through resistors on the little board) and the buzzer transistor.
    add("green", 0x37d67a, route("green", pin(pins.green), ledIn(0)));
    add("red", 0xff4a3a, route("red", pin(pins.red), ledIn(1)));
    add("buzzer", 0xa46cff, route("buzzer", pin(pins.buzzer), buzzIn));
    add("servoSig", 0xf2f2f2, route("servoSig", pin(pins.servo), servoIn));
    // Servo power from the separate 5 V supply, up from below; USB to the laptop.
    const sx = A + R.inner * 0.3, sz = -R.inner * 0.25;
    add("supply5v", 0xe33a2e, [V(sx, -0.05, sz), V(sx, R.servoY * 0.3, sz), V(sx, R.servoY - 0.04 * R.s, sz), servoIn.clone().add(V(0, -0.004, 0.002))], 0.0015);
    add("supplyGnd", 0x222222, [V(sx + 0.004, -0.05, sz - 0.002), V(sx + 0.004, R.servoY * 0.3, sz - 0.002), V(sx + 0.004, R.servoY - 0.04 * R.s, sz - 0.002), servoIn.clone().add(V(0, -0.006, -0.002))], 0.0015);
    const usbEnd = toRack(this.usbEnd());
    const usbPath = [usbEnd, usbEnd.clone().add(V(0, -0.03, 0)), V(A, 0.03, usbEnd.z), V(A + 0.06, 0.0, -0.1), V(A + 0.14, 0.0, -0.3)];
    add("usb", 0x5a5f66, usbPath, 0.0022);
    for (const id of ["supply5v", "supplyGnd"]) this.wires[id].mesh.userData.part = "supply";
    this.pickables.push(this.wires.supply5v.mesh, this.wires.usb.mesh);
    this.wires.usb.mesh.userData.part = "usb";
    if (!this.labels.some((l) => l.id === "supply")) {
      this.label("supply", () => this.rack.localToWorld(V(A + 0.03 + 0.03 * R.s, 0.2 * R.s, -0.03)), { inside: true });
      this.label("usb", () => this.rack.localToWorld(V(A + 0.08, 0.06 * R.s, -0.2)), { inside: true });
    }
  }

  // ---------------------------------------------------------------- view
  setView(inside) {
    this.inside = inside;
    const m = this.mats;
    for (const mat of [m.shellA, m.headShell, m.window]) {
      mat.transparent = inside;
      mat.opacity = inside ? (mat === m.window ? 0.22 : 0.13) : 1;
      mat.depthWrite = !inside;
      mat.needsUpdate = true;
    }
    for (const o of this.internals) o.visible = inside;
    for (const o of this.outsideOnly) o.visible = !inside;
    this.postShell.castShadow = !inside;
  }

  focus(preset, instant = false) {
    const R = this.R, A = R.postX, s = R.s, k = R.head.w / 0.092;
    const at = (t, d, f) => ({ t, p: [t[0] + d[0] * f, t[1] + d[1] * f, t[2] + d[2] * f] });
    const P = {
      rack: at([0.2 * s, 0.52 * s, 0], [1.25, 0.63, 1.75], s),
      head: at([A, R.postTop + 0.04 * k, 0], [0.34, 0.255, 0.36], k),
      latch: at([A, R.servoY - 0.06 * s, 0], [0.36, 0.14, 0.42], s),
      sensor: at([A, R.mpuY, -0.02 * s], [0.3, 0.1, 0.36], s),
      board: at([A, 0.27 * s, 0], [0.26, 0.08, 0.3], Math.max(s, 0.6)),
    }[preset];
    if (!P) return;
    if (instant) {
      this.camera.position.set(...P.p);
      this.controls.target.set(...P.t);
      this.controls.update();
      this.fly = null;
      return;
    }
    this.fly = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: V(...P.p), toT: V(...P.t), u: 0 };
  }

  focusPart(id) {
    const preset = { board: "board", usb: "board", pn532: "head", buzzer: "head", parts: "head", lights: "head",
      tubing: "head", reader: "head", vents: "head", servo: "latch", latch: "latch", cap: "latch", supply: "latch",
      mpu: "sensor" }[id];
    if (preset) this.focus(preset);
  }

  // ---------------------------------------------------------------- pointer: pick parts, drag the post
  bindPointer() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const hit = (e) => {
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects(this.pickables.filter((o) => o.visible), false);
      return hits[0];
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      const h = hit(e);
      down = { x: e.clientX, y: e.clientY, h, dragging: false };
      if (h && h.object.userData.part === "post") {
        // Drag the post: the controls stay still while you push it around.
        down.dragging = true;
        down.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          this.camera.getWorldDirection(V(0, 0, 0)).setY(0).normalize().negate(), h.point);
        down.start = h.point.clone();
        this.controls.enabled = false;
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!down?.dragging) return;
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const p = ray.ray.intersectPlane(down.plane, V(0, 0, 0));
      if (!p) return;
      const d = p.sub(down.start).multiplyScalar(0.35);
      this.onDrag({ x: clamp(d.x, -0.04, 0.04), z: clamp(d.z, -0.04, 0.04) });
    });
    const up = (e) => {
      if (!down) return;
      if (down.dragging) {
        this.onDrag(null);
        this.controls.enabled = true;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 5 && down.h) this.onPick(down.h.object.userData.part, true);
      down = null;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
  }

  // ---------------------------------------------------------------- per frame
  update(f) {
    const m = this.mats;
    // LEDs: lit exactly when their GPIO is high.
    m.ledGreen.emissiveIntensity = f.green ? 6 : 0;
    m.ledRed.emissiveIntensity = f.red ? 6 : 0;
    this.ledLights[0].intensity = f.green ? 0.06 : 0;
    this.ledLights[1].intensity = f.red ? 0.06 : 0;
    // Sway and lean of the whole frame about its footing (drawn 2.5x larger so you can see it).
    const k = 2.5 / 0.875;
    this.rack.rotation.set(f.sway.z * k, 0, -(f.sway.x * k) - f.lean * Math.PI / 180);
    // Servo horn and bolt.
    if (f.servoAngle !== null) {
      this.horn.rotation.z = (f.servoAngle - 90) * Math.PI / 180;
      // The spring latch slides sideways off the shackle's grooves: pulled by the servo, or
      // pushed aside by the ramp on a shackle leg going in.
      const open = clamp(f.latchOpen, 0, 1);
      this.bolt.position.x = this.R.postX - open * this.R.boltTravel;
      this.plate.position.x = this.R.postX - open * this.R.plateTravel;
      this.rack.updateMatrixWorld(true);
      const tip = this.horn.localToWorld(V(this.hornTip, 0, 0));
      const end = this.bolt.localToWorld(V(0.012 * this.R.s, 0.001, 0));
      placeRod(this.rod, this.rack.worldToLocal(tip), this.rack.worldToLocal(end));
    }
    this.shackle.position.z = f.shackleOut * 0.16 * this.R.s;
    // Light tubing: green, red, or amber when both LEDs are on.
    const tc = f.green && f.red ? 0xffb030 : f.green ? 0x3cff7a : f.red ? 0xff3020 : 0xffffff;
    this.tubeMat.emissive.setHex(tc);
    this.tubeMat.emissiveIntensity = f.green || f.red ? 2.2 : 0;
    m.buzzerTop.emissiveIntensity = f.buzzer ? 0.6 : 0;
    this.buzzerMesh.material = f.buzzer ? m.buzzerOn : m.black;
    // Wires: GPIO wires light while their pin is high; I2C wires while the bus is busy.
    const glow = (id, on) => {
      const w = this.wires[id];
      if (w) w.mat.emissiveIntensity = on ? 0.9 : 0;
    };
    glow("green", f.green);
    glow("red", f.red);
    glow("buzzer", f.buzzer);
    glow("servoSig", f.servoAttached);
    for (const id of ["sdaMpu", "sclMpu"]) glow(id, f.mpuBusy);
    for (const id of ["sdaPn", "sclPn"]) glow(id, f.pnBusy);
    glow("vccMpu", f.mpuLinked);
    glow("supply5v", f.servoPowered);
    if (this.wires.sdaPn) this.wires.sdaPn.mesh.visible = this.wires.sclPn.mesh.visible = this.inside && f.pnLinked;
    if (this.wires.sdaMpu) this.wires.sdaMpu.mesh.visible = this.inside && f.mpuLinked;
    m.copper.emissiveIntensity = f.cardNear ? 0.5 : 0;
    m.window.emissiveIntensity = f.cardNear ? 0.35 : 0.12;
    this.card.visible = f.cardNear;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 48 : 34;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (this.fly) {
      this.fly.u = Math.min(1, this.fly.u + dt / 0.9);
      const e = 1 - Math.pow(1 - this.fly.u, 3);
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, e);
      this.controls.target.lerpVectors(this.fly.fromT, this.fly.toT, e);
      if (this.fly.u >= 1) this.fly = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const shown = [];
    for (const l of this.labels) {
      const show = (this.inside ? l.inside : l.outside) && !this.hideLabels;
      if (!show) { l.el.hidden = true; continue; }
      const p = l.at().project(this.camera);
      const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
      l.el.hidden = p.z > 1 || x < 0 || y < 0 || x > w || y > h;
      if (l.el.hidden) continue;
      if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      shown.push({ l, x, y });
    }
    // Labels that would overlap are pushed up, lowest first, so close parts stay readable.
    shown.sort((a, b) => b.y - a.y);
    const placed = [];
    for (const s of shown) {
      const { w: lw, h: lh } = s.l;
      for (let tries = 0; tries < 8; tries++) {
        const hitBox = placed.find((r) => Math.abs(r.x - s.x) < (r.w + lw) / 2 + 4 && Math.abs(r.y - s.y) < (r.h + lh) / 2 + 2);
        if (!hitBox) break;
        s.y = hitBox.y - (hitBox.h + lh) / 2 - 3;
      }
      placed.push({ x: s.x, y: s.y, w: lw, h: lh });
      s.l.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

// ---------------------------------------------------------------- helpers
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/** Positions and stretches a cylinder so it runs from point a to point b (wires). */
function placeRod(rod, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  rod.position.copy(a).addScaledVector(d, 0.5);
  rod.scale.set(1, d.length(), 1);
  rod.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
}

/** A square steel tube with rounded corners (the posts). */
function squareTube(w, wall, height) {
  const outer = roundRect(new THREE.Shape(), w, w, 0.008);
  outer.holes.push(roundRect(new THREE.Path(), w - 2 * wall, w - 2 * wall, 0.004));
  const g = new THREE.ExtrudeGeometry(outer, { depth: height, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Draws a rounded rectangle into a shape or path, centred on 0,0. */
function roundRect(s, w, h, r) {
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

/** A rounded rectangle outline `t` thick (frames, bezels). */
function roundedRectRing(w, h, r, t) {
  const s = roundRect(new THREE.Shape(), w, h, r);
  s.holes.push(roundRect(new THREE.Path(), w - 2 * t, h - 2 * t, Math.max(0.001, r - t)));
  return new THREE.ShapeGeometry(s, 8);
}

/** A texture painted with a 2D canvas: draw(ctx, w, h). */
function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Every material in the scene (steel, plastic, ground, LEDs...), made once. */
function makeMaterials() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const ground = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#3a3436"; g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9000; i++) {
      const v = 46 + rnd() * 26 | 0;
      g.fillStyle = `rgba(${v},${v - 4},${v - 2},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.strokeStyle = "rgba(20,16,18,0.7)"; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
  });
  ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
  ground.repeat.set(6, 6);
  const windowTex = canvasTexture(256, 270, (g, w, h) => {
    g.fillStyle = "#16191c"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e5751f"; g.lineWidth = 9; g.lineCap = "round";
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w * 0.34, h * 0.42, 34 + i * 26, -0.75, 0.75); g.stroke(); }
    g.fillStyle = "#e5751f"; g.beginPath(); g.arc(w * 0.34, h * 0.42, 12, 0, 7); g.fill();
    g.fillStyle = "#f4eef0"; g.font = "600 34px Hanken Grotesk, system-ui, sans-serif"; g.textAlign = "center";
    g.fillText("Tap Your HokieP", w / 2, h * 0.86);
  });
  const chipTex = canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = "#141518"; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.fillStyle = "#d9dcdf"; g.font = "600 22px system-ui, sans-serif"; g.textAlign = "center";
    g.fillText("ATMEGA328P", 0, 8);
    g.restore();
  });
  const buzzerTop = S({ color: 0x18191c, roughness: 0.5, emissive: 0xa46cff, emissiveIntensity: 0 });
  return {
    ground: S({ map: ground, roughness: 0.95, metalness: 0 }),
    galv: S({ color: 0xb8c1c6, metalness: 0.85, roughness: 0.52 }),
    shellA: S({ color: 0xb8c1c6, metalness: 0.85, roughness: 0.52, side: THREE.DoubleSide }),
    headShell: S({ color: 0x2b2f34, metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide }),
    window: S({ map: windowTex, emissiveMap: windowTex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0 }),
    hard: S({ color: 0x5b6067, metalness: 1, roughness: 0.32 }),
    hardDark: S({ color: 0x9aa0a6, metalness: 1, roughness: 0.4 }),
    bright: S({ color: 0xdde0e4, metalness: 1, roughness: 0.25 }),
    rubber: S({ color: 0x17171a, roughness: 0.9 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x07090a, side: THREE.DoubleSide }),
    shackle: new THREE.MeshPhysicalMaterial({ color: 0xf2c230, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    pcbBlack: S({ color: 0x1a1c20, roughness: 0.6 }),
    pcbBlack2: S({ color: 0x24272c, roughness: 0.6 }),
    chip328: S({ map: chipTex, roughness: 0.45 }),
    pcbUno: S({ color: 0x00787f, roughness: 0.55 }),
    pcbRed: S({ color: 0xb3262b, roughness: 0.55 }),
    pcbBlue: S({ color: 0x1f4fa8, roughness: 0.55 }),
    perf: S({ color: 0x8a6a3a, roughness: 0.7 }),
    resistor: S({ color: 0xd8c39a, roughness: 0.6 }),
    copper: S({ color: 0xc77f3a, metalness: 1, roughness: 0.35, emissive: 0xe5751f, emissiveIntensity: 0, side: THREE.DoubleSide }),
    chip: S({ color: 0x111214, roughness: 0.4 }),
    servo: S({ color: 0x1b1c20, roughness: 0.45 }),
    horn: S({ color: 0xf0f0f0, roughness: 0.5 }),
    bolt: S({ color: 0xe5751f, metalness: 0.6, roughness: 0.4 }),
    cap: S({ color: 0x2b3f7a, roughness: 0.45 }),
    black: S({ color: 0x18191c, roughness: 0.5 }),
    buzzerOn: buzzerTop,
    buzzerTop,
    ledGreen: S({ color: 0x1f6b3c, emissive: 0x3cff7a, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 }),
    ledRed: S({ color: 0x6b1f1a, emissive: 0xff3020, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 }),
  };
}
