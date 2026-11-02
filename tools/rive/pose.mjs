// Every animated property gets a pose in every animation (TerraSim's rule). Without it, jumping
// from "granted" to "alarm" could leave the card hanging in mid-air, because Rive only moves the
// properties an animation keys.
//
//   const anims = posed(ab, { idle: { duration: 60 }, open: { duration: 90 } }, [
//     { target: latch, prop: 'y', base: 0, poses: { open: [[0, 0], [30, -10]] } },
//   ]);
// A pose is a list of [frame, value, ease?] or a single value (held). Missing = hold `base`.

export function posed(ab, anims, tracks) {
  const out = {};
  for (const [name, opts] of Object.entries(anims)) {
    const anim = ab.animation(name, opts);
    for (const t of tracks) {
      const pose = t.poses?.[name] ?? t.base;
      anim.key(t.target, t.prop, Array.isArray(pose) ? pose : [[0, pose, 'hold']]);
    }
    out[name] = anim;
  }
  return out;
}

// Points along a circular arc (straight segments), for NFC waves and the like.
export function arc(cx, cy, r, fromDeg, toDeg, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
