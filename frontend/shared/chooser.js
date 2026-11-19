// The "/" version chooser: the logo builds itself, and each version gets its pin (rider green,
// staff amber, police red/blue, admin alarm) so the four read apart at a glance.
import { riveIcon } from "../js/rive.js";
import { backendReady, onBackendState } from "../js/backend.js";

// Wake the server now (if it's asleep on Render) so it's up by the time a version is picked.
const status = document.querySelector("#server-status");
const TEXT = { checking: "", waking: "Waking the server. Takes about a minute; you can pick a version now.", ready: "Server ready." };
onBackendState((s) => { status.textContent = TEXT[s]; status.dataset.state = s; });
backendReady({ screen: false });

document.querySelector("#mark").append(riveIcon("logo", { size: 56 }).el);
for (const v of document.querySelectorAll(".version")) {
  v.querySelector(".v-icon").append(riveIcon("pin", { size: 56, inputs: { status: Number(v.dataset.pin) } }).el);
}
