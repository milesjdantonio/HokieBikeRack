// badge.riv: the small status tile next to each terminal line and each Needs You item. It draws
// itself once when the line arrives, then holds still (the alarm flashes three times, then holds).
//
// State machine "Badge", number input `kind`:
//   0 info     a chevron slides in               (check-ins, commands)
//   1 ok       a check draws itself              (unlocks, registered)
//   2 denied   a cross draws, then shakes no      (card refused)
//   3 warning  a triangle draws, the "!" drops in (rack bumped)
//   4 alarm    a siren lights up and flashes      (tamper alarm)
//   5 offline  signal bars drop, a slash crosses  (rack offline)
//   6 card     a card slides onto a reader        (unknown card waiting to be registered)
//   7 police   a shield lights up and a check draws (authorities alerted)

import { EASE, RivFile } from '../riv.mjs';
import { posed } from '../pose.mjs';

const S = 32, C = 16;
const COLORS = {
  info: '#8b949e', ok: '#3fd68a', denied: '#ff6b6b', warning: '#ffb547', alarm: '#ff6b6b', offline: '#8b949e', card: '#e5751f',
  police: '#58a6ff',
};
const KINDS = ['info', 'ok', 'denied', 'warning', 'alarm', 'offline', 'card', 'police'];
const hex = (c, a = 1) => c + Math.round(a * 255).toString(16).padStart(2, '0');

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Badge', width: S, height: S });

  const tile = ab.shape(null, { name: 'tile' });
  ab.rect(tile, { x: 1, y: 1, w: 30, h: 30, r: 8 });
  const tileFill = ab.fill(tile, COLORS.info, { alpha: 0.16 });

  const group = (name) => ab.node(null, { name, x: C, y: C });
  const g = Object.fromEntries(KINDS.map((k) => [k, group(k)]));

  // info: chevron
  const chev = ab.shape(g.info);
  ab.path(chev, [[-4, -6], [3, 0], [-4, 6]], { closed: false });
  ab.stroke(chev, COLORS.info, 2.8);

  // ok: check
  const check = ab.shape(g.ok);
  ab.path(check, [[-7, 0.5], [-2, 5.5], [7.5, -5.5]], { closed: false });
  const checkTrim = ab.trim(ab.stroke(check, COLORS.ok, 3), { end: 0 });

  // denied: cross
  const crossNode = ab.node(g.denied, { name: 'cross' });
  const cross = ab.shape(crossNode);
  ab.path(cross, [[-6, -6], [6, 6]], { closed: false });
  ab.path(cross, [[6, -6], [-6, 6]], { closed: false });
  const crossTrim = ab.trim(ab.stroke(cross, COLORS.denied, 3), { end: 0, mode: 2 });

  // warning: triangle and a dropping "!"
  const tri = ab.shape(g.warning);
  ab.path(tri, [[0, -9], [9.5, 7.5], [-9.5, 7.5]], { closed: true, radius: 2 });
  const triTrim = ab.trim(ab.stroke(tri, COLORS.warning, 2.4), { end: 0 });
  const bangNode = ab.node(g.warning, { name: 'bang' });
  const bang = ab.shape(bangNode);
  ab.rect(bang, { x: -1.2, y: -3.6, w: 2.4, h: 5.2, r: 1.2 });
  ab.rect(bang, { x: -1.2, y: 3, w: 2.4, h: 2.4, r: 1.2 });
  ab.fill(bang, COLORS.warning);

  // alarm: a siren dome on a base, with three rays
  const dome = ab.shape(g.alarm);
  ab.path(dome, [[-6.5, 6], [-6.5, -2, 6.5], [6.5, -2, 6.5], [6.5, 6]], { closed: true });
  const domeFill = ab.fill(dome, COLORS.alarm);
  const base = ab.shape(g.alarm);
  ab.rect(base, { x: -9, y: 6, w: 18, h: 3.4, r: 1.5 });
  ab.fill(base, COLORS.alarm);
  const raysNode = ab.node(g.alarm, { name: 'rays' });
  const rays = ab.shape(raysNode);
  ab.path(rays, [[0, -12], [0, -14.5]], { closed: false });
  ab.path(rays, [[-9, -8], [-11, -10]], { closed: false });
  ab.path(rays, [[9, -8], [11, -10]], { closed: false });
  ab.stroke(rays, COLORS.alarm, 2.2);

  // offline: three bars and a slash
  const bars = [[-7, 3], [-1.5, -1], [4, -5]].map(([x, top], i) => {
    const n = ab.node(g.offline, { name: `bar-${i}`, x: x + 1.6, y: 7 });
    const s = ab.shape(n);
    ab.rect(s, { x: -1.6, y: top - 7, w: 3.2, h: 7 - top, r: 1 });
    ab.fill(s, COLORS.offline);
    return n;
  });
  const slash = ab.shape(g.offline);
  ab.path(slash, [[-9, 9], [9, -9]], { closed: false });
  const slashTrim = ab.trim(ab.stroke(slash, '#ff6b6b', 2.4), { end: 0 });

  // card: a card slides down onto a reader line
  const reader = ab.shape(g.card);
  ab.rect(reader, { x: -10, y: 7, w: 20, h: 3, r: 1.5 });
  ab.fill(reader, '#8b949e');
  const cardNode = ab.node(g.card, { name: 'card', y: -1 });
  const card = ab.shape(cardNode);
  ab.rect(card, { x: -8, y: -6, w: 16, h: 11, r: 2 });
  ab.fill(card, COLORS.card);
  const chip = ab.shape(cardNode);
  ab.rect(chip, { x: -5, y: -3, w: 4, h: 3.4, r: 0.8 });
  ab.fill(chip, '#1a0d04');

  // police: a shield with a check that draws itself
  const shieldNode = ab.node(g.police, { name: 'shield' });
  const shield = ab.shape(shieldNode);
  ab.path(shield, [[0, -10], [8, -7], [8, 0], [0, 10], [-8, 0], [-8, -7]], { closed: true, radius: 1.5 });
  ab.stroke(shield, COLORS.police, 2.2);
  const pCheck = ab.shape(g.police);
  ab.path(pCheck, [[-3.5, 0], [-1, 2.8], [4, -3]], { closed: false });
  const pCheckTrim = ab.trim(ab.stroke(pCheck, COLORS.police, 2.2), { end: 0 });

  const groupOpacity = KINDS.map((k) => ({
    target: g[k], prop: 'opacity', base: 0,
    poses: { [k]: [[0, 0, EASE.out], [6, 1]] },
  }));
  const anims = posed(ab, {
    info: { duration: 30 },
    ok: { duration: 34 },
    denied: { duration: 54 },
    warning: { duration: 44 },
    alarm: { duration: 96 },
    offline: { duration: 48 },
    card: { duration: 44 },
    police: { duration: 44 },
  }, [
    ...groupOpacity,
    { target: tileFill, prop: 'colorValue', base: hex(COLORS.info, 0.16), poses: Object.fromEntries(KINDS.map((k) => [k,
      k === 'alarm'
        ? [[0, hex(COLORS.alarm, 0.5), 'hold'], [16, hex(COLORS.alarm, 0.16), 'hold'], [32, hex(COLORS.alarm, 0.5), 'hold'],
          [48, hex(COLORS.alarm, 0.16), 'hold'], [64, hex(COLORS.alarm, 0.5), 'hold'], [80, hex(COLORS.alarm, 0.2)]]
        : [[0, hex(COLORS[k], 0.34), EASE.out], [24, hex(COLORS[k], 0.16)]]])) },
    { target: g.info, prop: 'x', base: C, poses: { info: [[0, C - 6, EASE.out], [20, C]] } },
    { target: checkTrim, prop: 'end', base: 0, poses: { ok: [[0, 0, 'hold'], [4, 0, EASE.out], [26, 1]] } },
    { target: crossTrim, prop: 'end', base: 0, poses: { denied: [[0, 0, 'hold'], [4, 0, EASE.out], [20, 1]] } },
    { target: crossNode, prop: 'x', base: 0, poses: {
      denied: [[0, 0, 'hold'], [22, 0, EASE.inOut], [27, -2.5, EASE.inOut], [32, 2.5, EASE.inOut], [37, -1.5, EASE.inOut], [42, 0]],
    } },
    { target: triTrim, prop: 'end', base: 0, poses: { warning: [[0, 0, 'hold'], [2, 0, EASE.out], [26, 1]] } },
    { target: bangNode, prop: 'y', base: 0, poses: { warning: [[0, -10, 'hold'], [20, -10, EASE.back], [36, 0]] } },
    { target: bangNode, prop: 'opacity', base: 0, poses: { warning: [[0, 0, 'hold'], [20, 0, EASE.out], [26, 1]] } },
    { target: domeFill, prop: 'colorValue', base: hex(COLORS.alarm), poses: {
      alarm: [[0, hex('#ffd0c7'), 'hold'], [16, hex(COLORS.alarm), 'hold'], [32, hex('#ffd0c7'), 'hold'], [48, hex(COLORS.alarm), 'hold'],
        [64, hex('#ffd0c7'), 'hold'], [80, hex(COLORS.alarm)]],
    } },
    { target: raysNode, prop: 'opacity', base: 0, poses: {
      alarm: [[0, 1, 'hold'], [16, 0, 'hold'], [32, 1, 'hold'], [48, 0, 'hold'], [64, 1, 'hold'], [80, 0.9]],
    } },
    ...bars.map((b, i) => ({ target: b, prop: 'scaleY', base: 1, poses: {
      offline: [[0, 1, 'hold'], [i * 4, 1, EASE.in], [i * 4 + 16, 0.5]],
    } })),
    { target: slashTrim, prop: 'end', base: 0, poses: { offline: [[0, 0, 'hold'], [20, 0, EASE.out], [40, 1]] } },
    { target: shieldNode, prop: 'scaleX', base: 1, poses: { police: [[0, 0.6, EASE.back], [16, 1]] } },
    { target: shieldNode, prop: 'scaleY', base: 1, poses: { police: [[0, 0.6, EASE.back], [16, 1]] } },
    { target: pCheckTrim, prop: 'end', base: 0, poses: { police: [[0, 0, 'hold'], [14, 0, EASE.out], [34, 1]] } },
    { target: cardNode, prop: 'y', base: -1, poses: { card: [[0, -16, EASE.out], [22, 0, EASE.inOut], [30, -2, EASE.inOut], [38, -1]] } },
    { target: cardNode, prop: 'opacity', base: 1, poses: { card: [[0, 0, EASE.out], [10, 1]] } },
  ]);

  const sm = ab.stateMachine('Badge');
  const kind = sm.number('kind', 0);
  const layer = sm.layer('Main');
  const states = KINDS.map((k) => layer.state(anims[k]));
  layer.transition(layer.entry, states[0]);
  states.forEach((from, i) => states.forEach((to, j) => {
    if (i !== j) layer.transition(from, to, { conditions: [{ input: kind, op: '==', value: j }] });
  }));
  return f;
}
