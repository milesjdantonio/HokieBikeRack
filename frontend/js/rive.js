// Small animated icons made with Rive (https://rive.app). Adapted from Miles's TerraSim
// project. The .riv files are built from code in tools/rive/art/ (node tools/rive/build.mjs).
//
//   const icon = riveIcon("pulse", { size: 18, inputs: { status: 1 }, label: "online" });
//   container.append(icon.el);
//   icon.set("status", 2);
//
// If Rive or the file can't load, the element keeps a plain CSS fallback, so nothing breaks.
// Needs 'wasm-unsafe-eval' in the Content-Security-Policy (the Rive runtime is WebAssembly).

const R = window.rive;
if (R) {
  R.RuntimeLoader.setWasmUrl(new URL("../vendor/rive/rive.wasm", import.meta.url).href);
  R.Rive.suppressDeprecationWarnings = ["default-state-machine", "state-machine-inputs", "state-machines-param"];
}

const MACHINES = { pulse: "Pulse", lock: "Lock", alarm: "Alarm" };
const live = new Set();
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Destroys icons whose element has left the page (views re-render often).
 * An icon only counts as "gone" after it has been on the page once, because
 * views often create several icons before attaching them.
 */
function sweep() {
  const now = Date.now();
  for (const handle of live) {
    if (handle.el.isConnected) handle.seen = true;
    else if (handle.seen || now - handle.created > 30000) handle.destroy();
  }
}

export function riveIcon(name, { size = 24, inputs = {}, label = "" } = {}) {
  sweep();
  const el = document.createElement("span");
  el.className = `rive-icon rive-${name}`;
  el.style.width = `${size}px`;   // CSSOM styles are allowed by our CSP
  el.style.height = `${size}px`;
  if (label) { el.setAttribute("role", "img"); el.setAttribute("aria-label", label); }
  else el.setAttribute("aria-hidden", "true");
  const fallback = document.createElement("span");
  fallback.className = "rive-fallback";
  el.append(fallback);

  const state = { ...inputs };
  const applyFallback = () => {
    for (const [k, v] of Object.entries(state)) el.dataset[k] = String(v);
  };
  applyFallback();

  const handle = { el, ready: false, inputs: {}, set, destroy, seen: false, created: Date.now() };
  if (!R) return handle;

  const canvas = document.createElement("canvas");
  canvas.width = size * 2;   // 2x for sharp edges on high-DPI screens
  canvas.height = size * 2;
  let instance = null;
  try {
    instance = new R.Rive({
      src: new URL(`../assets/rive/${name}.riv`, import.meta.url).href,
      canvas,
      stateMachines: MACHINES[name],
      autoplay: true,
      layout: new R.Layout({ fit: R.Fit.Contain, alignment: R.Alignment.Center }),
      onLoad: () => {
        for (const i of instance.stateMachineInputs(MACHINES[name]) || []) handle.inputs[i.name] = i;
        for (const [k, v] of Object.entries(state)) setInput(k, v);
        el.prepend(canvas);
        el.classList.add("has-rive");
        handle.ready = true;
        if (reducedMotion()) setTimeout(() => instance && instance.pause(), 1200);
      },
      onLoadError: () => el.classList.add("rive-failed"),
    });
  } catch {
    el.classList.add("rive-failed");
    return handle;
  }
  live.add(handle);

  function setInput(key, value) {
    const input = handle.inputs[key];
    if (input) input.value = value;
  }

  function set(key, value) {
    state[key] = value;
    applyFallback();
    setInput(key, value);
    if (instance && reducedMotion()) {
      instance.play();
      setTimeout(() => instance && instance.pause(), 1200);
    }
  }

  function destroy() {
    live.delete(handle);
    try { instance && instance.cleanup(); } catch { /* already gone */ }
    instance = null;
  }
  return handle;
}

/** Rack status word -> pulse input (0 offline, 1 online, 2 warning). */
export function pulseStatus(status) {
  return { ONLINE: 1, WARNING: 2 }[status] ?? 0;
}
