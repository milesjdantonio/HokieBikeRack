// pin.riv: a rack's pin on the admin map. A dark disc with a bike glyph, ringed in the
// rack's status colour. Motion only happens when something happens (no idle pulsing).
//
// State machine "Pin", three layers that each move their own parts:
//   number `status`  0 online (green ring)  1 warning (amber ring, "!" badge pops in)
//                    2 alarm (red ring flashing red/orange, the pin shudders, red badge)
//                    3 offline (grey ring, the pin fades back)
//                    4 police (authorities alerted: ring and badge flash red and blue, like police lights)
//                    rider map, coloured by open spots (no connection states for riders):
//                    5 few (yellow: under 25% of spots open)  6 full (red)
//                    7 reported (alarm or report: the ring flashes red, a slash crosses the pin, a red pulse spreads)
//   trigger `unlock` the glyph turns into a check that draws itself, the ring flashes green
//   trigger `deny`   the glyph turns into a cross, the pin shakes no, the ring flashes red
//   bool `selected`  the disc fills Burnt Orange with a small settle

import { EASE, RivFile } from '../riv.mjs';
import { posed } from '../pose.mjs';

const S = 56, C = 28;            // artboard size and centre
const GROUND = '#0f1318', INK = '#e6edf3', ACCENT = '#e5751f', ACCENT_INK = '#1a0d04';
const GREEN = '#3fd68a', AMBER = '#ffb547', RED = '#ff6b6b', ORANGE = '#ff9a3c', GREY = '#7d8896';
const POLICE_RED = '#ff3b3b', POLICE_BLUE = '#2f81f7';
const YELLOW = '#f5d142', FULL_RED = '#ff5a5a', DARK_RED = '#5c1414';
/** A colour with alpha: hex("#ff0000", 0.5) -> "#ff000080". */
const hex = (c, a = 1) => c + Math.round(a * 255).toString(16).padStart(2, '0');

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Pin', width: S, height: S });

  const root = ab.node(null, { name: 'root' });
  const shaker = ab.node(root, { name: 'shaker', x: C, y: C });     // status: alarm shudder
  // Pulse behind the pin for a reported / alarming rack on the rider map. The one pulse in the
  // project: Miles asked for it here (riders must notice it), everything else stays still.
  const pulse = ab.node(shaker, { name: 'pulse' });
  const pulseShape = ab.shape(pulse);
  ab.ellipse(pulseShape, { w: 34, h: 34 });
  const pulseStroke = ab.stroke(pulseShape, FULL_RED, 3, { alpha: 0 });
  const nudge = ab.node(shaker, { name: 'nudge' });                  // events: "no" shake
  const core = ab.node(nudge, { name: 'core' });                     // selected: settle

  const disc = ab.shape(core, { name: 'disc' });
  ab.ellipse(disc, { w: 34, h: 34 });
  const discFill = ab.fill(disc, GROUND);
  const ringShape = ab.shape(core, { name: 'ring' });
  ab.ellipse(ringShape, { w: 34, h: 34 });
  const ring = ab.stroke(ringShape, GREEN, 3);
  const sirenShape = ab.shape(core, { name: 'siren' });
  ab.ellipse(sirenShape, { w: 44, h: 44 });
  const siren = ab.stroke(sirenShape, POLICE_BLUE, 3, { alpha: 0 });
  const flashShape = ab.shape(core, { name: 'flash' });
  ab.ellipse(flashShape, { w: 34, h: 34 });
  const flash = ab.stroke(flashShape, GREEN, 3.4, { alpha: 0 });

  // The glyph: a bike (Miles asked for a bike rather than rack hoops).
  const glyph = ab.node(core, { name: 'glyph', y: 1 });
  const bike = ab.shape(glyph, { name: 'bike' });
  ab.ellipse(bike, { x: -6.5, y: 3.5, w: 9, h: 9 });
  ab.ellipse(bike, { x: 6.5, y: 3.5, w: 9, h: 9 });
  ab.path(bike, [[-6.5, 3.5], [-2, -4], [4, -4], [6.5, 3.5]], { closed: false });   // seat stay, top tube, fork
  ab.path(bike, [[-6.5, 3.5], [0, 3.5], [4, -4]], { closed: false });                // chain stay, down tube
  ab.path(bike, [[-2, -4], [0, 3.5]], { closed: false });                             // seat tube
  ab.path(bike, [[-4, -6.5], [-0.5, -6.5]], { closed: false });                       // saddle
  ab.path(bike, [[4, -4], [3.4, -7], [6.4, -7]], { closed: false });                  // stem and bars
  const glyphStroke = ab.stroke(bike, INK, 1.9);

  const checkNode = ab.node(core, { name: 'check' });
  const checkShape = ab.shape(checkNode);
  ab.path(checkShape, [[-7, 0.5], [-2, 5.5], [8, -5.5]], { closed: false });
  const checkStroke = ab.stroke(checkShape, GREEN, 3);
  const checkTrim = ab.trim(checkStroke, { end: 0 });

  const crossNode = ab.node(core, { name: 'cross' });
  const crossShape = ab.shape(crossNode);
  ab.path(crossShape, [[-6, -6], [6, 6]], { closed: false });
  ab.path(crossShape, [[6, -6], [-6, 6]], { closed: false });
  const crossStroke = ab.stroke(crossShape, RED, 3);
  const crossTrim = ab.trim(crossStroke, { end: 0, mode: 2 });

  // A slash across the pin (half an X) for a rack that was reported: don't use it for now.
  const slash = ab.node(shaker, { name: 'slash' });
  const slashUnder = ab.shape(slash);
  ab.path(slashUnder, [[-15, -15], [15, 15]], { closed: false });
  ab.stroke(slashUnder, GROUND, 6.5);
  const slashTop = ab.shape(slash);
  ab.path(slashTop, [[-15, -15], [15, 15]], { closed: false });
  ab.stroke(slashTop, FULL_RED, 3.4);

  // Badge on the top-right of the disc for warnings and alarms.
  const badge = ab.node(shaker, { name: 'badge', x: 13, y: -13 });
  const badgeDisc = ab.shape(badge);
  ab.ellipse(badgeDisc, { w: 15, h: 15 });
  const badgeFill = ab.fill(badgeDisc, AMBER);
  const badgeEdge = ab.shape(badge);
  ab.ellipse(badgeEdge, { w: 15, h: 15 });
  ab.stroke(badgeEdge, GROUND, 2);
  const bang = ab.shape(badge, { name: 'bang' });
  ab.rect(bang, { x: -1.2, y: -4.6, w: 2.4, h: 5.4, r: 1.2 });
  ab.rect(bang, { x: -1.2, y: 2.2, w: 2.4, h: 2.4, r: 1.2 });
  ab.fill(bang, GROUND);

  // ---- layer 1: status ----
  const status = posed(ab, {
    online: { duration: 24 },
    warning: { duration: 36 },
    alarm: { duration: 40, loop: 1 },
    offline: { duration: 30 },
    police: { duration: 40, loop: 1 },
    few: { duration: 24 },
    full: { duration: 24 },
    reported: { duration: 40, loop: 1 },
  }, [
    { target: ring, prop: 'colorValue', base: hex(GREEN), poses: {
      warning: [[0, hex(GREY), EASE.out], [14, hex(AMBER)]],
      alarm: [[0, hex(RED), 'hold'], [10, hex(ORANGE), 'hold'], [20, hex(RED), 'hold'], [30, hex(ORANGE), 'hold'], [40, hex(RED)]],
      offline: [[0, hex(GREEN), EASE.inOut], [24, hex(GREY)]],
      online: [[0, hex(GREY), EASE.out], [14, hex(GREEN)]],
      police: [[0, hex(POLICE_RED), 'hold'], [10, hex(POLICE_BLUE), 'hold'], [20, hex(POLICE_RED), 'hold'], [30, hex(POLICE_BLUE), 'hold'], [40, hex(POLICE_RED)]],
      few: [[0, hex(GREY), EASE.out], [14, hex(YELLOW)]],
      full: [[0, hex(GREY), EASE.out], [14, hex(FULL_RED)]],
      reported: [[0, hex(FULL_RED), 'hold'], [20, hex(DARK_RED), 'hold'], [40, hex(FULL_RED)]],
    } },
    { target: slash, prop: 'opacity', base: 0, poses: { reported: 1 } },
    { target: pulse, prop: 'scaleX', base: 1, poses: { reported: [[0, 1, EASE.out], [40, 1.5]] } },
    { target: pulse, prop: 'scaleY', base: 1, poses: { reported: [[0, 1, EASE.out], [40, 1.5]] } },
    { target: pulseStroke, prop: 'colorValue', base: hex(FULL_RED, 0), poses: { reported: [[0, hex(FULL_RED, 0.9), EASE.out], [40, hex(FULL_RED, 0)]] } },
    // The slash just stays (Miles: it doesn't need to replay); only the ring flashes and the pulse spreads.
    { target: badge, prop: 'scaleX', base: 0, poses: {
      warning: [[0, 0, EASE.back], [16, 1]], alarm: 1, police: 1,
    } },
    { target: badge, prop: 'scaleY', base: 0, poses: {
      warning: [[0, 0, EASE.back], [16, 1]], alarm: 1, police: 1,
    } },
    { target: badgeFill, prop: 'colorValue', base: hex(AMBER), poses: {
      alarm: [[0, hex(RED), 'hold'], [10, hex(ORANGE), 'hold'], [20, hex(RED), 'hold'], [30, hex(ORANGE), 'hold'], [40, hex(RED)]],
      police: [[0, hex(POLICE_BLUE), 'hold'], [10, hex(POLICE_RED), 'hold'], [20, hex(POLICE_BLUE), 'hold'], [30, hex(POLICE_RED), 'hold'], [40, hex(POLICE_BLUE)]],
    } },
    // Police lights: an outer ring that swaps red/blue opposite to the main ring.
    { target: siren, prop: 'colorValue', base: hex(POLICE_BLUE, 0), poses: {
      police: [[0, hex(POLICE_BLUE, 0.95), 'hold'], [10, hex(POLICE_RED, 0.95), 'hold'], [20, hex(POLICE_BLUE, 0.95), 'hold'], [30, hex(POLICE_RED, 0.95), 'hold'], [40, hex(POLICE_BLUE, 0.95)]],
    } },
    { target: shaker, prop: 'rotation', base: 0, poses: {
      alarm: [[0, 0, EASE.inOut], [5, 0.14, EASE.inOut], [10, -0.14, EASE.inOut], [15, 0.1, EASE.inOut], [20, -0.06, EASE.inOut], [26, 0, 'hold'], [40, 0]],
    } },
    { target: root, prop: 'opacity', base: 1, poses: { offline: [[0, 1, EASE.inOut], [30, 0.55]] } },
  ]);
  // ---- layer 2: events ----
  const events = posed(ab, {
    rest: { duration: 10 },
    unlock: { duration: 90 },
    deny: { duration: 84 },
  }, [
    { target: glyph, prop: 'opacity', base: 1, poses: {
      unlock: [[0, 1, EASE.out], [6, 0, 'hold'], [70, 0, EASE.out], [84, 1]],
      deny: [[0, 1, EASE.out], [6, 0, 'hold'], [66, 0, EASE.out], [80, 1]],
    } },
    { target: checkNode, prop: 'opacity', base: 0, poses: { unlock: [[0, 0, 'hold'], [6, 1, 'hold'], [66, 1, EASE.in], [76, 0]] } },
    { target: checkTrim, prop: 'end', base: 0, poses: { unlock: [[0, 0, 'hold'], [6, 0, EASE.out], [26, 1]] } },
    { target: crossNode, prop: 'opacity', base: 0, poses: { deny: [[0, 0, 'hold'], [6, 1, 'hold'], [62, 1, EASE.in], [72, 0]] } },
    { target: crossTrim, prop: 'end', base: 0, poses: { deny: [[0, 0, 'hold'], [6, 0, EASE.out], [22, 1]] } },
    { target: nudge, prop: 'x', base: 0, poses: {
      deny: [[0, 0, 'hold'], [20, 0, EASE.inOut], [25, -4, EASE.inOut], [30, 4, EASE.inOut], [35, -3, EASE.inOut], [40, 2, EASE.inOut], [45, 0]],
    } },
    { target: flash, prop: 'colorValue', base: hex(GREEN, 0), poses: {
      unlock: [[0, hex(GREEN, 0), EASE.out], [10, hex(GREEN, 1), 'hold'], [50, hex(GREEN, 1), EASE.inOut], [84, hex(GREEN, 0)]],
      deny: [[0, hex(RED, 0), EASE.out], [10, hex(RED, 1), 'hold'], [50, hex(RED, 1), EASE.inOut], [80, hex(RED, 0)]],
    } },
  ]);
  // ---- layer 3: selection ----
  const sel = posed(ab, { off: { duration: 16 }, on: { duration: 30 } }, [
    { target: discFill, prop: 'colorValue', base: hex(GROUND), poses: {
      off: [[0, hex(ACCENT), EASE.out], [12, hex(GROUND)]],
      on: [[0, hex(GROUND), EASE.out], [10, hex(ACCENT)]],
    } },
    { target: glyphStroke, prop: 'colorValue', base: hex(INK), poses: {
      off: [[0, hex(ACCENT_INK), EASE.out], [12, hex(INK)]],
      on: [[0, hex(INK), EASE.out], [10, hex(ACCENT_INK)]],
    } },
    { target: core, prop: 'scaleX', base: 1, poses: { on: [[0, 1, EASE.out], [10, 1.14, EASE.inOut], [30, 1.06]], off: [[0, 1.06, EASE.out], [14, 1]] } },
    { target: core, prop: 'scaleY', base: 1, poses: { on: [[0, 1, EASE.out], [10, 1.14, EASE.inOut], [30, 1.06]], off: [[0, 1.06, EASE.out], [14, 1]] } },
  ]);

  const sm = ab.stateMachine('Pin');
  const statusIn = sm.number('status', 0);
  const unlock = sm.trigger('unlock');
  const deny = sm.trigger('deny');
  const selected = sm.bool('selected', false);

  const l1 = sm.layer('Status');
  const order = ['online', 'warning', 'alarm', 'offline', 'police', 'few', 'full', 'reported'];
  const st = order.map((n) => l1.state(status[n]));
  l1.transition(l1.entry, st[0]);
  st.forEach((from, i) => st.forEach((to, j) => {
    if (i !== j) l1.transition(from, to, { conditions: [{ input: statusIn, op: '==', value: j }], duration: 150 });
  }));

  const l2 = sm.layer('Events');
  const rest = l2.state(events.rest), sUnlock = l2.state(events.unlock), sDeny = l2.state(events.deny);
  l2.transition(l2.entry, rest);
  for (const s of [rest, sUnlock, sDeny]) {
    if (s !== sUnlock) l2.transition(s, sUnlock, { conditions: [{ input: unlock }] });
    if (s !== sDeny) l2.transition(s, sDeny, { conditions: [{ input: deny }] });
  }
  l2.transition(sUnlock, rest, { exitTime: 100, percent: true });
  l2.transition(sDeny, rest, { exitTime: 100, percent: true });

  const l3 = sm.layer('Select');
  const off = l3.state(sel.off), on = l3.state(sel.on);
  l3.transition(l3.entry, off);
  l3.transition(off, on, { conditions: [{ input: selected, value: true }] });
  l3.transition(on, off, { conditions: [{ input: selected, value: false }] });
  return f;
}
