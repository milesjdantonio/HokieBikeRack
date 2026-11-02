// rack.riv: the customer app's centrepiece. A steel rack hoop, a bike parked against it, and the
// HokieBikeRack lock module on the hoop's right leg (status LED, NFC reader pad, locking bolt).
//
// State machine "Rack", number input `state`:
//   0 idle     the LED breathes green (the rack is live and ready)
//   1 granted  a card slides to the reader, NFC waves, LED turns green, the bolt pulls back
//   2 denied   card, waves, LED blinks red twice, the card shakes and leaves
//   3 alarm    the rack shudders, the LED flashes red/orange, rings spread from it
//   4 offline  the scene dims, the LED goes dark
// Every animated property has a pose in every state (tools/rive/pose.mjs).

import { EASE, RivFile } from '../riv.mjs';
import { arc, posed } from '../pose.mjs';

const W = 360, H = 240;
const GROUND = '#0e0a0c';
const FLOOR = '#171117';
const STEEL = '#a3a9b3', STEEL_DARK = '#5e6570';
const MAROON = '#861f41', TIRE = '#2e272f', RIM = '#4d4451', HUB = '#79707e';
const MODULE = '#2c2431', PAD = '#3a3040';
const GREEN = '#2fa365', GREEN_HI = '#5ee39a', RED = '#e5484d', ORANGE = '#e5751f', DARK_LED = '#4b4450';
const WAVE = '#f4eef0';

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Rack', width: W, height: H });

  // Floor: a step in tone, not a line.
  const floor = ab.shape(null, { name: 'floor' });
  ab.rect(floor, { x: 0, y: 204, w: W, h: H - 204 });
  ab.fill(floor, FLOOR);

  // ---- the rack (shakes as one piece in the alarm) ----
  const rig = ab.node(null, { name: 'rig', x: 232, y: 206 });
  const hoopShade = ab.shape(rig, { name: 'hoop-shade', x: 2.5 });
  ab.path(hoopShade, [[-50, 0], [-50, -118, 42], [50, -118, 42], [50, 0]], { closed: false });
  ab.stroke(hoopShade, STEEL_DARK, 9);
  const hoop = ab.shape(rig, { name: 'hoop' });
  ab.path(hoop, [[-50, 0], [-50, -118, 42], [50, -118, 42], [50, 0]], { closed: false });
  ab.stroke(hoop, STEEL, 7);
  const feet = ab.shape(rig, { name: 'feet' });
  ab.rect(feet, { x: -59, y: -3, w: 18, h: 6, r: 2 });
  ab.rect(feet, { x: 41, y: -3, w: 18, h: 6, r: 2 });
  ab.fill(feet, STEEL_DARK);

  // The bolt sits behind the module and slides into it when unlocked.
  const bolt = ab.node(rig, { name: 'bolt', x: 20, y: -62 });
  const boltShape = ab.shape(bolt);
  ab.rect(boltShape, { x: 0, y: 0, w: 16, h: 7, r: 2 });
  ab.fill(boltShape, STEEL);

  const module = ab.shape(rig, { name: 'module' });
  ab.rect(module, { x: 34, y: -98, w: 32, h: 54, r: 7 });
  ab.fill(module, MODULE);
  const pad = ab.shape(rig, { name: 'reader' });
  ab.rect(pad, { x: 38.5, y: -80, w: 23, h: 26, r: 4 });
  ab.fill(pad, PAD);
  const padMark = ab.shape(rig, { name: 'reader-mark' });
  ab.path(padMark, arc(47, -67, 5, -45, 45, 6), { closed: false });
  ab.path(padMark, arc(47, -67, 9, -45, 45, 8), { closed: false });
  ab.stroke(padMark, '#6a5f70', 1.6);

  // LED with a halo that only shows when it's lit by an event.
  const halo = ab.shape(rig, { name: 'led-halo' });
  ab.ellipse(halo, { x: 50, y: -89, w: 22, h: 22 });
  const haloFill = ab.fill(halo, GREEN, { alpha: 0 });
  const led = ab.shape(rig, { name: 'led' });
  ab.ellipse(led, { x: 50, y: -89, w: 7, h: 7 });
  const ledFill = ab.fill(led, GREEN);

  // Alarm rings around the LED.
  const ringA = ab.node(rig, { name: 'ring-a', x: 50, y: -89 });
  const ra = ab.shape(ringA);
  ab.ellipse(ra, { w: 26, h: 26 });
  const ringAStroke = ab.stroke(ra, RED, 2.2, { alpha: 0 });
  const ringB = ab.node(rig, { name: 'ring-b', x: 50, y: -89 });
  const rb = ab.shape(ringB);
  ab.ellipse(rb, { w: 26, h: 26 });
  const ringBStroke = ab.stroke(rb, ORANGE, 2.2, { alpha: 0 });

  // NFC waves between the reader and the card.
  const waves = [9, 15, 21].map((r, i) => {
    const node = ab.node(rig, { name: `wave-${i}`, x: 58, y: -67 });
    const s = ab.shape(node);
    ab.path(s, arc(0, 0, r, -48, 48, 10), { closed: false });
    ab.stroke(s, WAVE, 2);
    return node;
  });

  // The rider's card: comes in from the right edge.
  const card = ab.node(rig, { name: 'card', x: 140, y: -67, rotation: -0.12 });
  const cardBody = ab.shape(card, { name: 'card-body' });
  ab.rect(cardBody, { x: -18, y: -12, w: 36, h: 24, r: 3 });
  ab.fill(cardBody, MAROON);
  const chip = ab.shape(card, { name: 'card-chip' });
  ab.rect(chip, { x: -12, y: -5, w: 8, h: 7, r: 1.5 });
  ab.fill(chip, '#d7b46a');
  const stripe = ab.shape(card, { name: 'card-line' });
  ab.rect(stripe, { x: -12, y: 5, w: 20, h: 2.4, r: 1 });
  ab.fill(stripe, '#f4eef0', { alpha: 0.55 });

  // ---- the bike (still; parked with its front wheel at the hoop) ----
  const bike = ab.node(null, { name: 'bike' });
  const wheel = (cx, name) => {
    const tire = ab.shape(bike, { name: `${name}-tire` });
    ab.ellipse(tire, { x: cx, y: 174, w: 62, h: 62 });
    ab.stroke(tire, TIRE, 5);
    const rim = ab.shape(bike, { name: `${name}-rim` });
    ab.ellipse(rim, { x: cx, y: 174, w: 48, h: 48 });
    ab.stroke(rim, RIM, 1.5);
    const hub = ab.shape(bike, { name: `${name}-hub` });
    ab.ellipse(hub, { x: cx, y: 174, w: 7, h: 7 });
    ab.fill(hub, HUB);
  };
  wheel(96, 'rear');
  wheel(198, 'front');
  const R = [96, 174], BB = [140, 176], ST = [126, 128], HT = [184, 124], HB = [189, 139], F = [198, 174];
  const frame = ab.shape(bike, { name: 'frame' });
  for (const seg of [[R, BB], [BB, ST], [R, ST], [ST, HT], [BB, HB], [HT, HB], [HB, F]]) {
    ab.path(frame, seg, { closed: false });
  }
  ab.stroke(frame, MAROON, 5);
  const parts = ab.shape(bike, { name: 'parts' });
  ab.path(parts, [[125, 128], [123, 119]], { closed: false });          // seat post
  ab.path(parts, [[113, 118], [133, 118]], { closed: false });          // saddle
  ab.path(parts, [[184, 124], [181, 111], [196, 108]], { closed: false }); // stem + bar
  ab.stroke(parts, '#3b3340', 4.5);
  const crank = ab.shape(bike, { name: 'crank' });
  ab.ellipse(crank, { x: 140, y: 176, w: 13, h: 13 });
  ab.stroke(crank, '#3b3340', 3);

  // Offline veil over everything.
  const veil = ab.node(null, { name: 'veil' });
  const veilShape = ab.shape(veil);
  ab.rect(veilShape, { x: 0, y: 0, w: W, h: H });
  ab.fill(veilShape, GROUND);

  // ---- animations ----
  const hex = (c, a) => c + Math.round(a * 255).toString(16).padStart(2, '0');
  const OUT = 140, IN = 70;  // card x off-screen and at the reader
  const cardIn = (end) => [[0, OUT, EASE.out], [26, IN, 'hold'], [end - 30, IN, EASE.in], [end, OUT]];
  const waveFade = (start) => [[0, 0, 'hold'], [start, 0, EASE.out], [start + 8, 0.9, EASE.in], [start + 28, 0]];

  const anims = posed(ab, {
    idle: { duration: 180, loop: 1 },
    granted: { duration: 160 },
    denied: { duration: 130 },
    alarm: { duration: 48, loop: 1 },
    offline: { duration: 40 },
  }, [
    { target: card, prop: 'x', base: OUT, poses: {
      granted: cardIn(150),
      denied: [[0, OUT, EASE.out], [26, IN, 'hold'], [58, IN, EASE.inOut], [62, IN - 5, EASE.inOut], [66, IN + 5, EASE.inOut],
        [70, IN - 5, EASE.inOut], [74, IN + 5, EASE.inOut], [78, IN, 'hold'], [96, IN, EASE.in], [124, OUT]],
    } },
    { target: card, prop: 'rotation', base: -0.12, poses: {
      granted: [[0, -0.4, EASE.out], [26, -0.08, 'hold'], [120, -0.08, EASE.in], [150, -0.4]],
      denied: [[0, -0.4, EASE.out], [26, -0.08, 'hold'], [96, -0.08, EASE.in], [124, -0.4]],
    } },
    { target: card, prop: 'opacity', base: 0, poses: {
      granted: [[0, 0, EASE.out], [12, 1, 'hold'], [136, 1, EASE.in], [150, 0]],
      denied: [[0, 0, EASE.out], [12, 1, 'hold'], [110, 1, EASE.in], [124, 0]],
    } },
    ...waves.map((w, i) => ({ target: w, prop: 'opacity', base: 0, poses: {
      granted: waveFade(24 + i * 6), denied: waveFade(24 + i * 6),
    } })),
    { target: ledFill, prop: 'colorValue', base: hex(GREEN, 1), poses: {
      idle: [[0, hex(GREEN, 0.45), EASE.inOut], [90, hex(GREEN, 1), EASE.inOut], [180, hex(GREEN, 0.45)]],
      granted: [[0, hex(GREEN, 0.7), 'hold'], [46, hex(GREEN, 0.7), EASE.out], [52, hex(GREEN_HI, 1)]],
      denied: [[0, hex(GREEN, 0.7), 'hold'], [46, hex(RED, 1), 'hold'], [58, hex(DARK_LED, 1), 'hold'], [66, hex(RED, 1), 'hold'],
        [78, hex(DARK_LED, 1), 'hold'], [86, hex(RED, 1), 'hold'], [112, hex(RED, 1), EASE.inOut], [130, hex(GREEN, 0.7)]],
      alarm: [[0, hex(RED, 1), 'hold'], [12, hex(ORANGE, 1), 'hold'], [24, hex(RED, 1), 'hold'], [36, hex(ORANGE, 1), 'hold'], [48, hex(RED, 1)]],
      offline: [[0, hex(GREEN, 0.7), EASE.inOut], [30, hex(DARK_LED, 1)]],
    } },
    { target: haloFill, prop: 'colorValue', base: hex(GREEN, 0), poses: {
      granted: [[0, hex(GREEN_HI, 0), 'hold'], [48, hex(GREEN_HI, 0), EASE.out], [58, hex(GREEN_HI, 0.38), EASE.inOut], [160, hex(GREEN_HI, 0.22)]],
      denied: [[0, hex(RED, 0), 'hold'], [44, hex(RED, 0), EASE.out], [50, hex(RED, 0.35), 'hold'], [108, hex(RED, 0.35), EASE.inOut], [130, hex(RED, 0)]],
      alarm: [[0, hex(RED, 0.4), 'hold'], [12, hex(ORANGE, 0.4), 'hold'], [24, hex(RED, 0.4), 'hold'], [36, hex(ORANGE, 0.4), 'hold'], [48, hex(RED, 0.4)]],
    } },
    { target: bolt, prop: 'x', base: 20, poses: {
      granted: [[0, 20, 'hold'], [54, 20, EASE.inOut], [78, 34]],
    } },
    { target: rig, prop: 'rotation', base: 0, poses: {
      alarm: [[0, 0, EASE.inOut], [6, 0.02, EASE.inOut], [18, -0.02, EASE.inOut], [30, 0.02, EASE.inOut], [42, -0.02, EASE.inOut], [48, 0]],
    } },
    { target: ringA, prop: 'scaleX', base: 0.6, poses: { alarm: [[0, 0.6, null], [48, 2.6]] } },
    { target: ringA, prop: 'scaleY', base: 0.6, poses: { alarm: [[0, 0.6, null], [48, 2.6]] } },
    { target: ringAStroke, prop: 'colorValue', base: hex(RED, 0), poses: { alarm: [[0, hex(RED, 0.9), null], [48, hex(RED, 0)]] } },
    { target: ringB, prop: 'scaleX', base: 0.6, poses: { alarm: [[0, 1.6, null], [24, 2.6, 'hold'], [25, 0.6, null], [48, 1.6]] } },
    { target: ringB, prop: 'scaleY', base: 0.6, poses: { alarm: [[0, 1.6, null], [24, 2.6, 'hold'], [25, 0.6, null], [48, 1.6]] } },
    { target: ringBStroke, prop: 'colorValue', base: hex(ORANGE, 0), poses: {
      alarm: [[0, hex(ORANGE, 0.45), null], [24, hex(ORANGE, 0), 'hold'], [25, hex(ORANGE, 0.9), null], [48, hex(ORANGE, 0.45)]],
    } },
    { target: veil, prop: 'opacity', base: 0, poses: { offline: [[0, 0, EASE.inOut], [40, 0.55]] } },
  ]);

  const sm = ab.stateMachine('Rack');
  const state = sm.number('state', 0);
  const layer = sm.layer('Main');
  const order = ['idle', 'granted', 'denied', 'alarm', 'offline'];
  const states = order.map((name) => layer.state(anims[name]));
  layer.transition(layer.entry, states[0]);
  states.forEach((from, i) => states.forEach((to, j) => {
    if (i !== j) layer.transition(from, to, { conditions: [{ input: state, op: '==', value: j }], duration: 200 });
  }));
  return f;
}
