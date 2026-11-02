// logo.riv: the HokieBikeRack mark. A rack hoop draws itself, a wheel rolls into it, and the
// lock's status light comes on in Burnt Orange. Plays once on the customer app's first visit
// and on the sign-in screen.
//
// State machine "Logo", trigger `play` replays the build.

import { EASE, RivFile } from '../riv.mjs';
import { posed } from '../pose.mjs';

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Logo', width: 96, height: 96 });

  const hoopShape = ab.shape(null, { name: 'hoop' });
  ab.path(hoopShape, [[22, 80], [22, 30, 20], [74, 30, 20], [74, 80]], { closed: false });
  const hoopStroke = ab.stroke(hoopShape, '#f4eef0', 7);
  const hoopTrim = ab.trim(hoopStroke, { start: 0, end: 0 });

  const wheel = ab.node(null, { name: 'wheel', x: 48, y: 62 });
  const ws = ab.shape(wheel);
  ab.ellipse(ws, { w: 30, h: 30 });
  ab.stroke(ws, '#861f41', 6);

  const light = ab.node(null, { name: 'light', x: 74, y: 44 });
  const ls = ab.shape(light);
  ab.ellipse(ls, { w: 11, h: 11 });
  ab.fill(ls, '#e5751f');

  const anims = posed(ab, { build: { duration: 84 }, rest: { duration: 10 } }, [
    { target: hoopTrim, prop: 'end', base: 1, poses: { build: [[0, 0, EASE.inOut], [40, 1]] } },
    { target: wheel, prop: 'x', base: 48, poses: { build: [[0, 6, 'hold'], [22, 6, EASE.out], [56, 48]] } },
    { target: wheel, prop: 'rotation', base: 0, poses: { build: [[0, -4, 'hold'], [22, -4, EASE.out], [56, 0]] } },
    { target: wheel, prop: 'opacity', base: 1, poses: { build: [[0, 0, 'hold'], [22, 0, EASE.out], [34, 1]] } },
    { target: light, prop: 'scaleX', base: 1, poses: { build: [[0, 0, 'hold'], [56, 0, EASE.back], [72, 1]] } },
    { target: light, prop: 'scaleY', base: 1, poses: { build: [[0, 0, 'hold'], [56, 0, EASE.back], [72, 1]] } },
  ]);

  const sm = ab.stateMachine('Logo');
  const play = sm.trigger('play');
  const layer = sm.layer('Main');
  const sBuild = layer.state(anims.build), sRest = layer.state(anims.rest);
  layer.transition(layer.entry, sBuild);
  layer.transition(sBuild, sRest, { exitTime: 100, percent: true });
  layer.transition(sRest, sBuild, { conditions: [{ input: play }] });
  return f;
}
