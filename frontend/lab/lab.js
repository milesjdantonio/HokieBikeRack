// Rive lab: mounts each animation and adds a button per input value or trigger.
// window.__rive reports what loaded (used by the automated checks).
import { h } from "../js/dom.js";
import { riveIcon } from "../js/rive.js";

const ANIMATIONS = [
  { name: "rack", size: 600, height: 400, inputs: { state: 0 },
    controls: [["state", [0, 1, 2, 3, 4], ["Idle", "Granted", "Denied", "Alarm", "Offline"]]] },
  { name: "logo", size: 160, inputs: {}, controls: [], triggers: [["play", "Play"]] },
  { name: "pin", size: 168, inputs: { status: 0 },
    controls: [["status", [0, 1, 2, 3], ["Online", "Warning", "Alarm", "Offline"]], ["selected", [true, false], ["Select", "Deselect"]]],
    triggers: [["unlock", "Unlock"], ["deny", "Deny"]] },
  { name: "badge", size: 128, inputs: { kind: 0 },
    controls: [["kind", [0, 1, 2, 3, 4, 5, 6], ["Info", "OK", "Denied", "Warning", "Alarm", "Offline", "Card"]]] },
  { name: "signal", size: 128, inputs: { level: 4 },
    controls: [["level", [0, 1, 2, 3, 4], ["Offline", "1 Bar", "2 Bars", "3 Bars", "4 Bars"]]], triggers: [["blip", "Blip"]] },
];

window.__rive = {};
const lab = document.querySelector("#lab");
for (const def of ANIMATIONS) {
  const anim = riveIcon(def.name, { size: def.size, height: def.height, inputs: def.inputs, label: def.name });
  const report = { name: def.name, loaded: false, inputs: [] };
  window.__rive[def.name] = report;
  const poll = setInterval(() => {
    if (anim.ready) { report.loaded = true; report.inputs = Object.keys(anim.inputs); clearInterval(poll); }
    if (anim.el.classList.contains("rive-failed")) { report.error = "load failed"; clearInterval(poll); }
  }, 100);
  report.set = (k, v) => anim.set(k, v);
  report.fire = (k) => anim.fire(k);
  const stage = h("figure", { class: def.name === "rack" ? "stage" : "lab-mark" }, anim.el);
  lab.append(h("section", { class: "block" },
    h("h2", {}, `${def.name}.riv`),
    stage,
    h("div", { class: "btn-row lab-controls" },
      def.controls.map(([key, values, labels]) => values.map((v, i) =>
        h("button", { type: "button", class: "btn btn-small", onClick: () => anim.set(key, v) }, labels[i]))),
      (def.triggers || []).map(([t, label]) => h("button", { type: "button", class: "btn btn-small", onClick: () => anim.fire(t) }, label)))));
}
