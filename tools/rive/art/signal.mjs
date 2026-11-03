// signal.riv: four signal bars. Used for a lock module's Wi-Fi strength and in the terminal header,
// where the bars flick each time a new event arrives (so "live" means something, not a pulse).
//
// State machine "Signal":
//   number `level`  0..4 bars lit. 0 = offline: the bars go grey and a slash draws across.
//   trigger `blip`  the lit bars flick bright once (an event just arrived)

import { EASE, RivFile } from '../riv.mjs';
import { posed } from '../pose.mjs';

const S = 32;
const LIT = '#3fd68a', BRIGHT = '#c8ffe0', DIM = '#2a323c', GREY = '#5b6572', RED = '#ff6b6b';
const hex = (c, a = 1) => c + Math.round(a * 255).toString(16).padStart(2, '0');

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Signal', width: S, height: S });

  const bars = [0, 1, 2, 3].map((i) => {
    const h = 6 + i * 5;
    const node = ab.node(null, { name: `bar-${i}`, x: 6 + i * 6.6, y: 26 });
    const s = ab.shape(node);
    ab.rect(s, { x: -2, y: -h, w: 4, h, r: 1.2 });
    const fill = ab.fill(s, DIM);
    // A bright copy on top for the blip.
    const hi = ab.node(node, { name: `hi-${i}` });
    const hs = ab.shape(hi);
    ab.rect(hs, { x: -2, y: -h, w: 4, h, r: 1.2 });
    ab.fill(hs, BRIGHT);
    return { node, fill, hi };
  });
  const slashNode = ab.node(null, { name: 'slash' });
  const slash = ab.shape(slashNode);
  ab.path(slash, [[5, 28], [28, 5]], { closed: false });
  const slashTrim = ab.trim(ab.stroke(slash, RED, 2.6), { end: 0 });

  const levels = ['off', 'one', 'two', 'three', 'four'];
  const level = posed(ab, Object.fromEntries(levels.map((l) => [l, { duration: 40 }])), [
    ...bars.map((b, i) => ({ target: b.fill, prop: 'colorValue', base: hex(DIM), poses: Object.fromEntries(levels.map((l, n) => [l,
      n === 0 ? [[0, hex(DIM), EASE.inOut], [16, hex(GREY)]]
        : i < n ? [[0, hex(DIM), 'hold'], [i * 5, hex(DIM), EASE.out], [i * 5 + 12, hex(LIT)]]
          : hex(DIM)])) })),
    ...bars.map((b, i) => ({ target: b.node, prop: 'scaleY', base: 1, poses: {
      off: [[0, 1, 'hold'], [i * 3, 1, EASE.in], [i * 3 + 14, 0.45]],
    } })),
    { target: slashTrim, prop: 'end', base: 0, poses: { off: [[0, 0, 'hold'], [14, 0, EASE.out], [34, 1]] } },
  ]);
  const blip = posed(ab, { still: { duration: 10 }, flick: { duration: 36 } }, bars.map((b, i) => ({
    target: b.hi, prop: 'opacity', base: 0, poses: { flick: [[0, 0, 'hold'], [i * 4, 0, EASE.out], [i * 4 + 4, 0.9, EASE.inOut], [i * 4 + 20, 0]] },
  })));

  const sm = ab.stateMachine('Signal');
  const levelIn = sm.number('level', 4);
  const blipIn = sm.trigger('blip');
  const l1 = sm.layer('Level');
  const st = levels.map((l) => l1.state(level[l]));
  l1.transition(l1.entry, st[4]);
  st.forEach((from, i) => st.forEach((to, j) => {
    if (i !== j) l1.transition(from, to, { conditions: [{ input: levelIn, op: '==', value: j }] });
  }));
  const l2 = sm.layer('Blip');
  const still = l2.state(blip.still), flick = l2.state(blip.flick);
  l2.transition(l2.entry, still);
  l2.transition(still, flick, { conditions: [{ input: blipIn }] });
  l2.transition(flick, flick, { conditions: [{ input: blipIn }] });
  l2.transition(flick, still, { exitTime: 100, percent: true });
  return f;
}
