// Rive lab page: mounts each icon large and adds buttons for its inputs.
// window.__rive reports what loaded (used by automated checks).
import { riveIcon } from "../js/rive.js";
import { h } from "../js/ui.js";

const ICONS = [
  { name: "rack", size: 360, height: 240, inputs: { state: 0 }, controls: [["state", [0, 1, 2, 3, 4], ["idle", "granted", "denied", "alarm", "offline"]]] },
  { name: "logo", inputs: {}, controls: [] , triggers: ["play"] },
  { name: "pulse", inputs: { status: 1 }, controls: [["status", [0, 1, 2], ["offline", "online", "warning"]]] },
  { name: "lock", inputs: { unlocked: false }, controls: [["unlocked", [false, true], ["locked", "unlocked"]]] },
  { name: "alarm", inputs: { active: false }, controls: [["active", [false, true], ["idle", "ALARM"]]] },
];

window.__rive = {};
const lab = document.querySelector("#lab");
for (const def of ICONS) {
  const icon = riveIcon(def.name, { size: def.size || 128, height: def.height, inputs: def.inputs, label: def.name });
  const report = { name: def.name, loaded: false, inputs: [] };
  window.__rive[def.name] = report;
  const poll = setInterval(() => {
    if (icon.ready) { report.loaded = true; report.inputs = Object.keys(icon.inputs); clearInterval(poll); }
    if (icon.el.classList.contains("rive-failed")) { report.error = "load failed"; clearInterval(poll); }
  }, 100);
  window.__rive[def.name].set = (k, v) => icon.set(k, v);
  window.__rive[def.name].fire = (k) => icon.fire(k);
  lab.append(h("section", { class: "panel lab-card" },
    h("h2", {}, `${def.name}.riv`),
    h("div", { class: "lab-stage" }, icon.el),
    h("div", { class: "lab-controls" }, def.controls.map(([key, values, labels]) =>
      values.map((v, i) => h("button", { type: "button", class: "small secondary", onClick: () => icon.set(key, v) },
        `${key} = ${labels[i]}`))),
    (def.triggers || []).map((t) => h("button", { type: "button", class: "small secondary", onClick: () => icon.fire(t) }, `fire ${t}`)))));
}
