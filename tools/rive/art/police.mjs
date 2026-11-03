// police.riv: "Alert Authorities". A shield sends a signal out to both sides, then a check draws on
// it once the alert is sent. Plays in the alarm panel when an admin presses Alert Authorities.
//
// State machine "Police", number input `state`:
//   0 ready    grey shield, nothing moving
//   1 sending  the shield lights blue and signal arcs sweep out three times, then moves on by itself to
//   2 sent     the shield fills, a check draws itself, and it holds

import { EASE, RivFile } from '../riv.mjs';
import { arc, posed } from '../pose.mjs';

const W = 150, H = 100, CX = 75, CY = 50;
const BLUE = '#58a6ff', BLUE_DARK = '#12304f', SHIELD = '#161b22', GREY = '#5b6572', WHITE = '#e6edf3';
const hex = (c, a = 1) => c + Math.round(a * 255).toString(16).padStart(2, '0');

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Police', width: W, height: H });

  // Signal arcs on both sides, three rings each.
  const rings = [0, 1, 2].map((i) => {
    const node = ab.node(null, { name: `ring-${i}`, x: CX, y: CY });
    const s = ab.shape(node);
    const r = 30 + i * 10;
    ab.path(s, arc(0, 0, r, -32, 32, 10), { closed: false });
    ab.path(s, arc(0, 0, r, 148, 212, 10), { closed: false });
    const stroke = ab.stroke(s, BLUE, 3, { alpha: 0 });
    return { node, stroke };
  });

  const shieldNode = ab.node(null, { name: 'shield', x: CX, y: CY });
  const shield = ab.shape(shieldNode);
  ab.path(shield, [[0, -25], [19, -18], [19, -2], [12, 13], [0, 24], [-12, 13], [-19, -2], [-19, -18]], { closed: true, radius: 3 });
  const shieldFill = ab.fill(shield, SHIELD);
  const shieldStroke = ab.stroke(shield, GREY, 2.6);
  // A star-like mark (a small diamond) until the check replaces it.
  const markNode = ab.node(shieldNode, { name: 'mark' });
  const mark = ab.shape(markNode);
  ab.path(mark, [[0, -9], [6, -1], [0, 7], [-6, -1]], { closed: true, radius: 1.5 });
  const markFill = ab.fill(mark, GREY);
  const checkNode = ab.node(shieldNode, { name: 'check' });
  const check = ab.shape(checkNode);
  ab.path(check, [[-8, -1], [-2.5, 5], [8.5, -7]], { closed: false });
  const checkTrim = ab.trim(ab.stroke(check, WHITE, 3.4), { end: 0 });

  const ringPose = (i) => {
    const frames = [];
    for (let c = 0; c < 3; c++) {
      const t = c * 40 + i * 8;
      frames.push([t, hex(BLUE, 0), EASE.out], [t + 6, hex(BLUE, 0.95), EASE.in], [t + 26, hex(BLUE, 0), 'hold']);
    }
    return frames;
  };
  const anims = posed(ab, {
    ready: { duration: 20 },
    sending: { duration: 120 },
    sent: { duration: 50 },
  }, [
    ...rings.map((r, i) => ({ target: r.stroke, prop: 'colorValue', base: hex(BLUE, 0), poses: { sending: ringPose(i) } })),
    ...rings.map((r, i) => ({ target: r.node, prop: 'scaleX', base: 1, poses: {
      sending: [0, 1, 2].flatMap((c) => [[c * 40 + i * 8, 0.85, EASE.out], [c * 40 + i * 8 + 26, 1.1, 'hold']]),
    } })),
    ...rings.map((r, i) => ({ target: r.node, prop: 'scaleY', base: 1, poses: {
      sending: [0, 1, 2].flatMap((c) => [[c * 40 + i * 8, 0.85, EASE.out], [c * 40 + i * 8 + 26, 1.1, 'hold']]),
    } })),
    { target: shieldStroke, prop: 'colorValue', base: hex(GREY), poses: {
      sending: [[0, hex(GREY), EASE.out], [12, hex(BLUE)]], sent: hex(BLUE),
    } },
    { target: shieldFill, prop: 'colorValue', base: hex(SHIELD), poses: {
      sent: [[0, hex(SHIELD), EASE.out], [14, hex(BLUE_DARK)]],
    } },
    { target: markFill, prop: 'colorValue', base: hex(GREY), poses: { sending: [[0, hex(GREY), EASE.out], [12, hex(BLUE)]], sent: hex(BLUE) } },
    { target: markNode, prop: 'opacity', base: 1, poses: { sent: [[0, 1, EASE.out], [8, 0]] } },
    { target: checkTrim, prop: 'end', base: 0, poses: { sent: [[0, 0, 'hold'], [8, 0, EASE.out], [30, 1]] } },
    { target: shieldNode, prop: 'scaleX', base: 1, poses: { sent: [[0, 1, EASE.out], [10, 1.08, EASE.inOut], [26, 1]] } },
    { target: shieldNode, prop: 'scaleY', base: 1, poses: { sent: [[0, 1, EASE.out], [10, 1.08, EASE.inOut], [26, 1]] } },
  ]);

  const sm = ab.stateMachine('Police');
  const state = sm.number('state', 0);
  const layer = sm.layer('Main');
  const sReady = layer.state(anims.ready), sSending = layer.state(anims.sending), sSent = layer.state(anims.sent);
  layer.transition(layer.entry, sReady);
  layer.transition(sReady, sSending, { conditions: [{ input: state, op: '>=', value: 1 }] });
  layer.transition(sSending, sSent, { exitTime: 100, percent: true });
  layer.transition(sSent, sReady, { conditions: [{ input: state, op: '==', value: 0 }] });
  layer.transition(sSending, sReady, { conditions: [{ input: state, op: '==', value: 0 }] });
  return f;
}
