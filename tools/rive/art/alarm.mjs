// alarm.riv: a rack siren. Idle = calm grey dome. Active = the dome flashes red/orange,
// wobbles, and sends out rings.
//
// State machine "Alarm", boolean input `active`.

import { EASE, RivFile } from '../riv.mjs';
import { C } from '../colors.mjs';

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Alarm', width: 64, height: 64 });
  const CX = 32, CY = 36;

  // Rings behind everything.
  const ringA = ab.node(null, { name: 'ringA', x: CX, y: CY });
  const ra = ab.shape(ringA);
  ab.ellipse(ra, { w: 30, h: 30 });
  const ringAStroke = ab.stroke(ra, C.red, 2.5);
  const ringB = ab.node(null, { name: 'ringB', x: CX, y: CY });
  const rb = ab.shape(ringB);
  ab.ellipse(rb, { w: 30, h: 30 });
  const ringBStroke = ab.stroke(rb, C.orange, 2.5);

  // The siren dome pivots on its base so it can wobble.
  const siren = ab.node(null, { name: 'siren', x: CX, y: 48 });
  const dome = ab.shape(siren, { name: 'dome' });
  // A half-circle dome on short straight sides, traced with straight segments.
  const arc = Array.from({ length: 13 }, (_, i) => {
    const a = Math.PI - (i * Math.PI) / 12;
    return [14 * Math.cos(a), -6 - 14 * Math.sin(a)];
  });
  ab.path(dome, [[-14, 0], ...arc, [14, 0]]);
  const domeFill = ab.fill(dome, C.grey);
  const shine = ab.shape(siren, { name: 'shine' });
  ab.ellipse(shine, { x: -6, y: -11, w: 5, h: 9 });
  ab.fill(shine, C.white, { alpha: 0.55 });

  const base = ab.shape(null, { name: 'base' });
  ab.rect(base, { x: 12, y: 47, w: 40, h: 8, r: 3 });
  ab.fill(base, C.dark);

  const idle = ab.animation('idle', { duration: 10 });
  idle.key(domeFill, 'colorValue', [[0, C.grey, 'hold']]);
  idle.key(siren, 'rotation', [[0, 0, 'hold']]);
  for (const ring of [ringA, ringB]) {
    idle.key(ring, 'scaleX', [[0, 0.5, 'hold']]);
    idle.key(ring, 'scaleY', [[0, 0.5, 'hold']]);
  }
  idle.key(ringAStroke, 'colorValue', [[0, `${C.red}00`, 'hold']]);
  idle.key(ringBStroke, 'colorValue', [[0, `${C.orange}00`, 'hold']]);

  const alarm = ab.animation('alarm', { duration: 48, loop: 1 });
  alarm.key(domeFill, 'colorValue', [[0, C.red, 'hold'], [12, C.orange, 'hold'], [24, C.red, 'hold'], [36, C.orange, 'hold'], [48, C.red]]);
  alarm.key(siren, 'rotation', [[0, 0, EASE.inOut], [6, 0.09, EASE.inOut], [18, -0.09, EASE.inOut], [30, 0.09, EASE.inOut], [42, -0.09, EASE.inOut], [48, 0]]);
  // Ring A grows over the whole loop; ring B is half a loop behind.
  alarm.key(ringA, 'scaleX', [[0, 0.5, null], [48, 1.9]]);
  alarm.key(ringA, 'scaleY', [[0, 0.5, null], [48, 1.9]]);
  alarm.key(ringAStroke, 'colorValue', [[0, `${C.red}e6`, null], [48, `${C.red}00`]]);
  alarm.key(ringB, 'scaleX', [[0, 1.2, null], [24, 1.9, 'hold'], [25, 0.5, null], [48, 1.2]]);
  alarm.key(ringB, 'scaleY', [[0, 1.2, null], [24, 1.9, 'hold'], [25, 0.5, null], [48, 1.2]]);
  alarm.key(ringBStroke, 'colorValue', [[0, `${C.orange}73`, null], [24, `${C.orange}00`, 'hold'], [25, `${C.orange}e6`, null], [48, `${C.orange}73`]]);

  const sm = ab.stateMachine('Alarm');
  const active = sm.bool('active', false);
  const layer = sm.layer('Main');
  const sIdle = layer.state(idle);
  const sAlarm = layer.state(alarm);
  layer.transition(layer.entry, sIdle);
  layer.transition(sIdle, sAlarm, { conditions: [{ input: active, value: true }] });
  layer.transition(sAlarm, sIdle, { conditions: [{ input: active, value: false }] });
  return f;
}
