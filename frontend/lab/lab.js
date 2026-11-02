// Rive lab: mounts each animation and adds a button per input value or trigger.
// window.__rive reports what loaded (used by the automated checks).
import { h } from "../js/dom.js";
import { riveIcon } from "../js/rive.js";

const ANIMATIONS = [
  { name: "rack", size: 600, height: 400, inputs: { state: 0 },
    controls: [["state", [0, 1, 2, 3, 4], ["Idle", "Granted", "Denied", "Alarm", "Offline"]]] },
  { name: "logo", size: 160, inputs: {}, controls: [], triggers: [["play", "Play"]] },
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
