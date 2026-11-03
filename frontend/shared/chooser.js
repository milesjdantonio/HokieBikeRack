// The "/" version chooser: the logo builds itself, and each version gets its pin (rider green,
// staff amber, police red/blue, admin alarm) so the four read apart at a glance.
import { riveIcon } from "../js/rive.js";

document.querySelector("#mark").append(riveIcon("logo", { size: 56 }).el);
for (const v of document.querySelectorAll(".version")) {
  v.querySelector(".v-icon").append(riveIcon("pin", { size: 56, inputs: { status: Number(v.dataset.pin) } }).el);
}
