// Runs the firmware's PC unit tests (firmware/test/*) without making any
// native .exe files: the tests are compiled to WebAssembly by clang (which is
// itself WebAssembly, from the @yowasp/clang npm package) and run inside
// Node's WASI sandbox.
//
// Why: Windows Smart App Control on Miles's laptop blocks the test programs
// that `pio test -e native` builds. Node is trusted, so this works there.
// On any other machine, `pio test -e native` is still the normal way.
//
//   cd firmware/tools/wasm-tests
//   npm install        (once; downloads ~100 MB)
//   npm test
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';
import { runClang } from '@yowasp/clang';

const firmwareDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const logicDir = join(firmwareDir, 'lib', 'hbr_logic', 'src');
const testRoot = join(firmwareDir, 'test');

// The Unity test framework comes from PlatformIO's download of it.
const unityDir = ['native', 'uno', 'esp32dev']
  .map((env) => join(firmwareDir, '.pio', 'libdeps', env, 'Unity', 'src'))
  .find((dir) => existsSync(join(dir, 'unity.c')));
if (!unityDir) {
  console.error('Unity not found. Download it once with (from firmware/):\n' +
    '  ~/.platformio/penv/Scripts/python.exe -m platformio pkg install -e native');
  process.exit(2);
}

/** Every C/C++ file in a folder, as { name: contents }. */
const read = (dir) => Object.fromEntries(readdirSync(dir)
  .filter((f) => /\.(c|cpp|h)$/.test(f))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

const logic = read(logicDir);
const unity = read(unityDir);
// WebAssembly has no setjmp yet; Unity's built-in switch makes a failed
// assertion `return` from the test instead (the failure is still counted).
const flags = ['-Wall', '-Wextra', '-O1', '-Ilogic', '-Iunity', '-DUNITY_EXCLUDE_SETJMP_H'];
const quiet = { fetchProgress: () => {} };

let failed = 0;
const suites = readdirSync(testRoot).filter((d) => existsSync(join(testRoot, d, 'test_main.cpp')));
for (const suite of suites) {
  console.log(`\n===== ${suite} =====`);
  const files = { logic, unity, 'test_main.cpp': readFileSync(join(testRoot, suite, 'test_main.cpp'), 'utf8') };
  const stderr = [];
  const opts = { ...quiet, stderr: (b) => b && stderr.push(Buffer.from(b)) };
  let wasm;
  try {
    // Unity is C: compile it as C, then the logic + test as C++, and link.
    const c = await runClang(['clang', '-c', 'unity/unity.c', '-o', 'unity.o', ...flags], files, opts);
    const sources = Object.keys(logic).filter((f) => f.endsWith('.cpp')).map((f) => `logic/${f}`);
    const out = await runClang(['clang++', '-std=gnu++17', ...flags, 'test_main.cpp', ...sources,
      'unity.o', '-o', 'test.wasm'], { ...files, 'unity.o': c['unity.o'] }, opts);
    wasm = out['test.wasm'];
  } catch (e) {
    console.log(Buffer.concat(stderr).toString());
    console.log(`COMPILE FAILED (${e.message})`);
    failed++;
    continue;
  }
  const warnings = Buffer.concat(stderr).toString().trim();
  if (warnings) console.log(`compiler warnings:\n${warnings}\n`);
  const wasi = new WASI({ version: 'preview1', returnOnExit: true });
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm),
    { wasi_snapshot_preview1: wasi.wasiImport });
  if (wasi.start(instance) !== 0) failed++;
}
console.log(`\n${suites.length - failed} of ${suites.length} test suites passed`);
process.exit(failed ? 1 : 0);
