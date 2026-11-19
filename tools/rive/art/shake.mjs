// shake.riv: the scene in the panel that drops in from the top of the admin map when a rack is
// shaken. The rack shudders with motion lines beside it while a jolt meter draws the spike.
//
// State machine "Shake", number input `level`:
//   0 bump   amber: a few shudders, the meter draws one spike, then everything settles (plays once)
//   1 alarm  red: keeps shuddering and the lock's light flashes red/orange until the level changes

import { EASE, RivFile } from '../riv.mjs';
import { posed } from '../pose.mjs';

const W = 150, H = 100;
const STEEL = '#a3a9b3', STEEL_DARK = '#5e6570', MODULE = '#2c2431', GROUND = '#161b22';
const AMBER = '#ffb547', RED = '#ff6b6b', ORANGE = '#ff9a3c';
/** A colour with alpha: hex("#ff0000", 0.5) -> "#ff000080". */
const hex = (c, a = 1) => c + Math.round(a * 255).toString(16).padStart(2, '0');

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Shake', width: W, height: H });

  const ground = ab.shape(null, { name: 'ground' });
  ab.rect(ground, { x: 0, y: 72, w: W, h: H - 72 });
  ab.fill(ground, GROUND);

  // The rack pivots at its feet.
  const rig = ab.node(null, { name: 'rig', x: 75, y: 72 });
  const hoop = ab.shape(rig);
  ab.path(hoop, [[-22, 0], [-22, -40, 16], [22, -40, 16], [22, 0]], { closed: false });
  ab.stroke(hoop, STEEL, 6);
  const feet = ab.shape(rig);
  ab.rect(feet, { x: -29, y: -2, w: 14, h: 4, r: 1.5 });
  ab.rect(feet, { x: 15, y: -2, w: 14, h: 4, r: 1.5 });
  ab.fill(feet, STEEL_DARK);
  const module = ab.shape(rig);
  ab.rect(module, { x: 16, y: -32, w: 13, h: 20, r: 3 });
  ab.fill(module, MODULE);
  const led = ab.shape(rig);
  ab.ellipse(led, { x: 22.5, y: -27, w: 4.5, h: 4.5 });
  const ledFill = ab.fill(led, '#2fa365');

  // Motion lines either side.
  const lines = [-1, 1].map((side) => {
    const node = ab.node(null, { name: `lines-${side}`, x: 75 + side * 36, y: 46 });
    const s = ab.shape(node);
    ab.path(s, [[0, -10], [side * 3, 2]], { closed: false });
    ab.path(s, [[side * 7, -4], [side * 9, 6]], { closed: false });
    const stroke = ab.stroke(s, AMBER, 2.2);
    return { node, stroke };
  });

  // Jolt meter along the ground: flat, a spike, flat.
  const meter = ab.shape(null, { name: 'meter' });
  ab.path(meter, [[14, 87], [56, 87], [61, 80], [66, 95], [71, 77], [76, 94], [81, 82], [86, 89], [90, 87], [136, 87]], { closed: false });
  const meterStroke = ab.stroke(meter, AMBER, 2);
  const meterTrim = ab.trim(meterStroke, { end: 0 });

  const shudder = (amp) => [[0, 0, EASE.inOut], [5, amp, EASE.inOut], [10, -amp, EASE.inOut], [15, amp * 0.8, EASE.inOut], [20, -amp * 0.8, EASE.inOut]];
  const anims = posed(ab, {
    bump: { duration: 70 },
    alarm: { duration: 40, loop: 1 },
  }, [
    { target: rig, prop: 'rotation', base: 0, poses: {
      bump: [...shudder(0.07), [26, 0.03, EASE.inOut], [32, 0, 'hold'], [70, 0]],
      alarm: [...shudder(0.1), [25, 0.06, EASE.inOut], [30, -0.06, EASE.inOut], [35, 0.03, EASE.inOut], [40, 0]],
    } },
    ...lines.map((l) => ({ target: l.node, prop: 'opacity', base: 0, poses: {
      bump: [[0, 0, EASE.out], [4, 1, 'hold'], [24, 1, EASE.in], [36, 0]],
      alarm: [[0, 1, 'hold'], [10, 0.4, 'hold'], [20, 1, 'hold'], [30, 0.4, 'hold'], [40, 1]],
    } })),
    ...lines.map((l) => ({ target: l.stroke, prop: 'colorValue', base: hex(AMBER), poses: { alarm: hex(RED) } })),
    { target: meterStroke, prop: 'colorValue', base: hex(AMBER), poses: { alarm: hex(RED) } },
    { target: meterTrim, prop: 'end', base: 0, poses: { bump: [[0, 0, EASE.inOut], [40, 1]], alarm: 1 } },
    { target: ledFill, prop: 'colorValue', base: hex('#2fa365'), poses: {
      bump: [[0, hex(AMBER), 'hold'], [10, hex('#4b4450'), 'hold'], [20, hex(AMBER), 'hold'], [34, hex('#2fa365')]],
      alarm: [[0, hex(RED), 'hold'], [10, hex(ORANGE), 'hold'], [20, hex(RED), 'hold'], [30, hex(ORANGE), 'hold'], [40, hex(RED)]],
    } },
  ]);

  const sm = ab.stateMachine('Shake');
  const level = sm.number('level', 0);
  const layer = sm.layer('Main');
  const sBump = layer.state(anims.bump), sAlarm = layer.state(anims.alarm);
  layer.transition(layer.entry, sBump);
  layer.transition(sBump, sAlarm, { conditions: [{ input: level, op: '==', value: 1 }], duration: 150 });
  layer.transition(sAlarm, sBump, { conditions: [{ input: level, op: '==', value: 0 }], duration: 150 });
  return f;
}
