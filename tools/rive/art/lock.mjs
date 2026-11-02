// lock.riv: a padlock. When unlocked, the shackle lifts and swings open and the body turns
// green; when locked again it drops back with a small bounce and turns maroon.
//
// State machine "Lock", boolean input `unlocked`.

import { EASE, RivFile } from '../riv.mjs';
import { C } from '../colors.mjs';

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Lock', width: 64, height: 64 });
  const DOWN = 30;   // shackle y when locked
  const UP = 22;     // shackle y when open
  const OPEN = -0.3; // radians: swing the free leg up and out

  // Shackle first so the body draws on top of its legs. Pivot = top of the left leg.
  const shackle = ab.node(null, { name: 'shackle', x: 21, y: DOWN });
  const arc = ab.shape(shackle, { name: 'arc' });
  ab.path(arc, [[0, 14], [0, -12, 11], [22, -12, 11], [22, 14]], { closed: false });
  ab.stroke(arc, C.steel, 5);

  const body = ab.shape(null, { name: 'body' });
  ab.rect(body, { x: 13, y: 28, w: 38, h: 29, r: 7 });
  const bodyFill = ab.fill(body, C.maroon);
  const hole = ab.shape(null, { name: 'keyhole' });
  ab.ellipse(hole, { x: 32, y: 39, w: 6, h: 6 });
  ab.rect(hole, { x: 30.5, y: 40, w: 3, h: 9, r: 1.5 });
  ab.fill(hole, C.white, { alpha: 0.9 });

  const locked = ab.animation('locked', { duration: 10 });
  locked.key(shackle, 'y', [[0, DOWN, 'hold']]);
  locked.key(shackle, 'rotation', [[0, 0, 'hold']]);
  locked.key(bodyFill, 'colorValue', [[0, C.maroon, 'hold']]);

  const unlock = ab.animation('unlock', { duration: 32 });
  unlock.key(shackle, 'y', [[0, DOWN, EASE.back], [14, UP]]);
  unlock.key(shackle, 'rotation', [[0, 0, 'hold'], [10, 0, EASE.back], [32, OPEN]]);
  unlock.key(bodyFill, 'colorValue', [[0, C.maroon, EASE.inOut], [16, C.green]]);

  const open = ab.animation('open', { duration: 10 });
  open.key(shackle, 'y', [[0, UP, 'hold']]);
  open.key(shackle, 'rotation', [[0, OPEN, 'hold']]);
  open.key(bodyFill, 'colorValue', [[0, C.green, 'hold']]);

  const close = ab.animation('lock', { duration: 28 });
  close.key(shackle, 'rotation', [[0, OPEN, EASE.inOut], [10, 0]]);
  close.key(shackle, 'y', [[0, UP, 'hold'], [8, UP, EASE.slam], [18, DOWN + 1.5, EASE.out], [24, DOWN]]);
  close.key(bodyFill, 'colorValue', [[0, C.green, EASE.inOut], [18, C.maroon]]);

  const sm = ab.stateMachine('Lock');
  const unlocked = sm.bool('unlocked', false);
  const layer = sm.layer('Main');
  const sLocked = layer.state(locked);
  const sUnlock = layer.state(unlock);
  const sOpen = layer.state(open);
  const sLock = layer.state(close);
  layer.transition(layer.entry, sLocked);
  layer.transition(sLocked, sUnlock, { conditions: [{ input: unlocked, value: true }] });
  layer.transition(sUnlock, sOpen, { exitTime: 100, percent: true });
  layer.transition(sUnlock, sLock, { conditions: [{ input: unlocked, value: false }] });
  layer.transition(sOpen, sLock, { conditions: [{ input: unlocked, value: false }] });
  layer.transition(sLock, sLocked, { exitTime: 100, percent: true });
  layer.transition(sLock, sUnlock, { conditions: [{ input: unlocked, value: true }] });
  return f;
}
