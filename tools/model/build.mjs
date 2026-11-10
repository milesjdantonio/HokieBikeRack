#!/usr/bin/env node
// Builds the firmware model: the REAL firmware (firmware/src, firmware/lib/hbr_logic) plus the
// emulated hardware (firmware/model) compiled to WebAssembly for frontend/model/.
// Explained in docs/notes/firmware-model.md.
//
//   node tools/model/build.mjs                  build frontend/model/firmware.js + firmware.json
//   node tools/model/build.mjs --local-config   also use the HBR_SERVO_* lines from include/config.h
//   node tools/model/build.mjs --check          exit 1 if the firmware changed since the last build
//
// The firmware is the Arduino Uno version; firmware/model/hw.cpp plays the Uno and its parts.
// Needs Emscripten: `em++` on PATH (emsdk, any OS), or on Windows the MSYS2 package
// (pacman -S mingw-w64-ucrt-x86_64-emscripten). Teammates who only open the page need nothing:
// the built files are committed.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const FW = path.join(ROOT, "firmware");
const OUT_DIR = path.join(ROOT, "frontend", "model");
const OUT_JS = path.join(OUT_DIR, "firmware.js");
const OUT_JSON = path.join(OUT_DIR, "firmware.json");
const WORK = path.join(FW, ".pio", "model");
const args = new Set(process.argv.slice(2));
const LOCAL_CONFIG = args.has("--local-config");

// Each compile unit. model_api.cpp pulls in main.cpp, lock.cpp, feedback.cpp, card_reader.cpp
// and card_store.cpp itself (see the comment at its top).
const UNITS = [
  { src: "model/model_api.cpp" },
  { src: "model/hw.cpp" },
  { src: "src/credential_ref.cpp" },
  { src: "src/tamper_sensor.cpp" },
  ...fs.readdirSync(path.join(FW, "lib", "hbr_logic", "src")).filter((f) => f.endsWith(".cpp"))
    .map((f) => ({ src: `lib/hbr_logic/src/${f}` })),
];

const EXPORTS = ["hbr_boot", "hbr_run_until", "hbr_now_ms", "hbr_restart_requested", "hbr_reset_reason",
  "hbr_card", "hbr_link", "hbr_serial_write", "hbr_card_ref", "hbr_eeprom_get", "hbr_eeprom_put",
  "hbr_preload_card", "hbr_take_log", "hbr_state", "hbr_config", "malloc", "free"].map((n) => "_" + n);

// ---------------------------------------------------------------- inputs + staleness
function listInputs() {
  const files = [];
  const walk = (dir, filter) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, filter);
      else if (filter(p)) files.push(p);
    }
  };
  const code = (p) => /\.(cpp|h|hpp)$/.test(p);
  walk(path.join(FW, "src"), code);
  walk(path.join(FW, "include"), (p) => code(p) && path.basename(p) !== "config.h");
  walk(path.join(FW, "lib", "hbr_logic", "src"), code);
  walk(path.join(FW, "model"), code);
  files.push(fileURLToPath(import.meta.url), path.join(HERE, "emscripten_msys2.py"));
  return files.sort();
}

// Line endings ignored: Git on Windows checks files out with CRLF, on Mac/Linux with LF.
function sha256(file) {
  const text = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sourceHash(files) {
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(path.relative(ROOT, f).replaceAll("\\", "/") + "\0" + sha256(f) + "\n");
  if (LOCAL_CONFIG) h.update(localConfigLines());
  return h.digest("hex");
}

function localConfigLines() {
  const file = path.join(FW, "include", "config.h");
  if (!fs.existsSync(file)) return "";
  // Only the servo angles. Nothing else from config.h (Wi-Fi, tokens, card key) is ever copied.
  return fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => /^\s*#define\s+HBR_SERVO_(LOCKED|UNLOCKED)_DEG\s+-?\d+\s*$/.test(l)).join("\n");
}

if (args.has("--check")) {
  if (!fs.existsSync(OUT_JSON)) fail("No frontend/model/firmware.json yet. Run: node tools/model/build.mjs");
  const built = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
  const now = sourceHash(listInputs());
  if (now === built.sourceHash) {
    console.log("Firmware model is up to date.");
    process.exit(0);
  }
  const old = new Map(built.files.map((f) => [f.path, f.sha256]));
  for (const f of listInputs()) {
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    if (old.get(rel) !== sha256(f)) console.log("  changed: " + rel);
  }
  fail("The firmware changed since frontend/model/firmware.js was built. Run: node tools/model/build.mjs");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------- toolchain
function toolchain() {
  const env = { ...process.env };
  if (process.env.HBR_EMXX) return { cmd: [process.env.HBR_EMXX], env, label: process.env.HBR_EMXX };
  if (process.platform !== "win32") {
    if (spawnSync("em++", ["--version"]).status === 0) return { cmd: ["em++"], env, label: "em++ (PATH)" };
  }
  const msys = process.env.HBR_MSYS2_UCRT64 || "C:/msys64/ucrt64";
  const emRoot = path.join(msys, "lib", "emscripten");
  const llvm = path.join(msys, "opt", "emscripten-llvm", "bin");
  const python = path.join(msys, "bin", "python.exe");
  if (process.platform === "win32" && fs.existsSync(path.join(emRoot, "emcc.py")) && fs.existsSync(python)) {
    const launchers = path.join(WORK, "launchers");
    fs.mkdirSync(launchers, { recursive: true });
    const wrapper = path.join(HERE, "emscripten_msys2.py");
    for (const t of ["emcc", "em++", "emar", "emranlib"]) {
      fs.writeFileSync(path.join(launchers, t + ".bat"), `@"${python}" "${wrapper}" ${t} %*\r\n`);
    }
    const config = path.join(WORK, "emscripten-config.py");
    const q = (p) => "r'" + p.replaceAll("\\", "/") + "'";
    // Emscripten builds its C library into this cache once. Keep it out of the project folder:
    // OneDrive locks files while it syncs them, and Emscripten then can't delete its temp folders.
    const cache = process.env.HBR_EM_CACHE || path.join(os.tmpdir(), "hbr-emscripten-cache");
    fs.writeFileSync(config, [
      `LLVM_ROOT = ${q(llvm)}`, `BINARYEN_ROOT = ${q(msys)}`, `NODE_JS = ${q(path.join(msys, "bin", "node.exe"))}`,
      `CACHE = ${q(cache)}`, ""].join("\n"));
    env.EM_CONFIG = config;
    env.HBR_EMSCRIPTEN_ROOT = emRoot;
    env.HBR_EM_LAUNCHERS = launchers;
    env.PATH = path.join(msys, "bin") + path.delimiter + (env.PATH || "");
    // MSYS2's wasm-opt hangs forever with its thread pool on Windows; one thread is fine.
    env.BINARYEN_CORES = "1";
    // Smart App Control may block MSYS2's wasm-opt.exe. With `npm install` run once in
    // tools/model, the wrapper runs the WebAssembly build of the same tools in Node instead.
    const binaryenJs = path.join(HERE, "node_modules", "binaryen", "bin");
    let label = "MSYS2 Emscripten";
    if (fs.existsSync(path.join(binaryenJs, "wasm-opt"))) {
      env.HBR_BINARYEN_JS = binaryenJs;
      env.HBR_NODE = process.execPath;
      label += " + Binaryen in Node";
    }
    return { cmd: [python, wrapper, "em++"], env, label };
  }
  fail([
    "Emscripten not found. Install one of:",
    "  Windows: C:\\msys64\\usr\\bin\\pacman.exe -S mingw-w64-ucrt-x86_64-emscripten",
    "  Any OS:  https://emscripten.org/docs/getting_started/downloads.html (emsdk), then em++ on PATH",
    "Or set HBR_EMXX to your em++.",
  ].join("\n"));
}

function run(cmd, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(output || `exit ${code}`))));
  });
}

// ---------------------------------------------------------------- build
async function main() {
  const tc = toolchain();
  const started = Date.now();
  fs.mkdirSync(WORK, { recursive: true });

  // A copy of include/ WITHOUT your config.h, plus the model's own config.h. device_config.h
  // looks for config.h next to itself, so this is the only way it can never see your secrets.
  const staging = path.join(WORK, "include");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const f of fs.readdirSync(path.join(FW, "include"))) {
    if (f.endsWith(".h") && f !== "config.h") fs.copyFileSync(path.join(FW, "include", f), path.join(staging, f));
  }
  let modelConfig = fs.readFileSync(path.join(FW, "model", "config.h"), "utf8");
  if (LOCAL_CONFIG) {
    const lines = localConfigLines();
    if (!lines) console.log("--local-config: no HBR_SERVO_* lines in include/config.h; using defaults.");
    if (lines) modelConfig += `\n// Copied by --local-config from include/config.h:\n${lines}\n#define HBR_MODEL_SERVO_FROM_CONFIG 1\n`;
  }
  fs.writeFileSync(path.join(staging, "config.h"), modelConfig);

  const version = (await run([...tc.cmd, "--version"], tc.env, FW)).split(/\r?\n/)[0].trim();
  console.log(`Building the firmware model with ${tc.label}: ${version}`);

  const cflags = ["-std=gnu++17", "-O2", "-Wall", "-Wno-unused-function", "-Wno-unused-variable", "-Wno-constant-logical-operand",
    "-I", path.join(FW, "model", "shim"), "-I", staging, "-I", path.join(FW, "lib", "hbr_logic", "src"),
    "-DHBR_MODEL=1"];
  const objDir = path.join(WORK, "obj");
  fs.mkdirSync(objDir, { recursive: true });

  const objects = [];
  const queue = [...UNITS];
  const workers = Array.from({ length: Math.min(4, os.cpus().length) }, async () => {
    while (queue.length) {
      const unit = queue.shift();
      const obj = path.join(objDir, unit.src.replaceAll("/", "_") + ".o");
      objects.push(obj);
      const defs = (unit.defines || []).map((d) => "-D" + d);
      try {
        const warnings = await run([...tc.cmd, "-c", path.join(FW, unit.src), "-o", obj, ...cflags, ...defs], tc.env, FW);
        if (warnings.trim()) console.log(warnings.trim());
        console.log("  compiled " + unit.src);
      } catch (e) {
        fail(`Compile failed: ${unit.src}\n${e.message}`);
      }
    }
  });
  await Promise.all(workers);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const link = [...tc.cmd, ...objects.sort(), "-o", OUT_JS, "-O2",
    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createFirmware", "-sSINGLE_FILE=1", "-sSINGLE_FILE_BINARY_ENCODE=0",
    "-sENVIRONMENT=web,node", "-sALLOW_MEMORY_GROWTH=1", "-sDYNAMIC_EXECUTION=0", "-sFILESYSTEM=0",
    `-sEXPORTED_FUNCTIONS=${EXPORTS.join(",")}`, "-sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAPU8",
    "-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$stringToNewUTF8,$UTF8ToString"];
  try {
    await run(link, tc.env, FW);
  } catch (e) {
    fail("Link failed:\n" + e.message);
  }

  // Where each value is defined, so the page can say "src/card_reader.cpp:12".
  const createFirmware = (await import(pathToFileURL(OUT_JS).href + "?t=" + Date.now())).default;
  const fw = await createFirmware({ hooks: {} });
  const config = JSON.parse(fw.UTF8ToString(fw._hbr_config()));
  const locations = {};
  for (const v of config.values) {
    const file = v.file === "model/config.h" ? path.join(staging, "config.h") : path.join(FW, v.file);
    locations[v.id] = locate(file, v.id, v.file);
  }

  const inputs = listInputs();
  const manifest = {
    builtAt: new Date().toISOString(),
    toolchain: version,
    localConfig: LOCAL_CONFIG,
    sourceHash: sourceHash(inputs),
    files: inputs.map((f) => ({ path: path.relative(ROOT, f).replaceAll("\\", "/"), sha256: sha256(f) })),
    locations,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + "\n");
  const kb = Math.round(fs.statSync(OUT_JS).size / 1024);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)} s: frontend/model/firmware.js (${kb} KB) + firmware.json`);
}

function locate(file, id, relative) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const word = new RegExp(`\\b${id}\\b`);
  const isDefinition = (l) => /#define|constexpr|=|\(\d/.test(l) && !/#ifndef|#ifdef/.test(l);
  let index = lines.findIndex((l) => word.test(l) && isDefinition(l));
  if (index < 0) index = lines.findIndex((l) => word.test(l));
  return { file: relative, line: index + 1, code: index >= 0 ? lines[index].trim() : "" };
}

main().catch((e) => fail(e.stack || String(e)));
