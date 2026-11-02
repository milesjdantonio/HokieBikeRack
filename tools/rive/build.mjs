// Builds every HokieBikeRack .riv animation from the scripts in tools/rive/art/ into
// frontend/assets/rive/. Same approach as Miles's TerraSim project: the animations are code,
// so they can be reviewed in Git and rebuilt any time.
//
//   node tools/rive/build.mjs            build all
//   node tools/rive/build.mjs lock,pulse build some

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'frontend', 'assets', 'rive');
mkdirSync(out, { recursive: true });
const only = process.argv[2] ? process.argv[2].split(',') : null;

for (const file of readdirSync(join(here, 'art')).filter((f) => f.endsWith('.mjs'))) {
  const name = file.replace(/\.mjs$/, '');
  if (only && !only.includes(name)) continue;
  const mod = await import(pathToFileURL(join(here, 'art', file)).href);
  const bytes = mod.default().toBytes();
  writeFileSync(join(out, `${name}.riv`), bytes);
  console.log(`${name}.riv  ${(bytes.length / 1024).toFixed(1)} KB`);
}
