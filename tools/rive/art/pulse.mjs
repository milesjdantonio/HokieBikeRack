// pulse.riv: a live status dot. Offline = still grey dot. Online = green dot with a slow
// "heartbeat" ring. Warning = amber dot with a faster ring.
//
// State machine "Pulse", number input `status`: 0 offline, 1 online, 2 warning.

import { EASE, RivFile } from '../riv.mjs';
import { C } from '../colors.mjs';

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Pulse', width: 32, height: 32 });

  const ring = ab.node(null, { name: 'ring', x: 16, y: 16 });
  const rs = ab.shape(ring);
  ab.ellipse(rs, { w: 12, h: 12 });
  const ringStroke = ab.stroke(rs, C.green, 2);

  const core = ab.node(null, { name: 'core', x: 16, y: 16 });
  const cs = ab.shape(core);
  ab.ellipse(cs, { w: 12, h: 12 });
  const coreFill = ab.fill(cs, C.grey);

  const offline = ab.animation('offline', { duration: 10 });
  offline.key(coreFill, 'colorValue', [[0, C.grey, 'hold']]);
  offline.key(ringStroke, 'colorValue', [[0, `${C.grey}00`, 'hold']]);
  offline.key(ring, 'scaleX', [[0, 1, 'hold']]);
  offline.key(ring, 'scaleY', [[0, 1, 'hold']]);
  offline.key(core, 'scaleX', [[0, 1, 'hold']]);
  offline.key(core, 'scaleY', [[0, 1, 'hold']]);

  const beat = (name, colour, duration) => {
    const a = ab.animation(name, { duration, loop: 1 });
    a.key(coreFill, 'colorValue', [[0, colour, 'hold']]);
    a.key(ring, 'scaleX', [[0, 1, EASE.out], [duration, 2.4]]);
    a.key(ring, 'scaleY', [[0, 1, EASE.out], [duration, 2.4]]);
    a.key(ringStroke, 'colorValue', [[0, `${colour}cc`, EASE.out], [duration, `${colour}00`]]);
    const third = Math.round(duration / 3);
    a.key(core, 'scaleX', [[0, 1, EASE.out], [8, 1.12, EASE.inOut], [third, 1]]);
    a.key(core, 'scaleY', [[0, 1, EASE.out], [8, 1.12, EASE.inOut], [third, 1]]);
    return a;
  };
  const online = beat('online', C.green, 96);
  const warning = beat('warning', C.orange, 54);

  const sm = ab.stateMachine('Pulse');
  const status = sm.number('status', 1);
  const layer = sm.layer('Main');
  const states = [layer.state(offline), layer.state(online), layer.state(warning)];
  layer.transition(layer.entry, states[1]);
  // Every state can go to every other one when `status` changes.
  states.forEach((from, i) => states.forEach((to, j) => {
    if (i !== j) layer.transition(from, to, { conditions: [{ input: status, op: '==', value: j }] });
  }));
  return f;
}
