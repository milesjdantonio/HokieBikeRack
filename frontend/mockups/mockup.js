// Admin mockup: sample data only. Shows the real map, the real rack animation in the alarm pop-up,
// and a terminal feed, so Miles can compare style A and B before the real build.
import { riveIcon } from "../js/rive.js";
import { rackMap } from "../app/js/map.js";

const style = new URLSearchParams(location.search).get("style") === "b" ? "b" : "a";
document.body.classList.add(`style-${style}`);
for (const a of document.querySelectorAll(".mock-switch a")) a.classList.toggle("on", a.dataset.style === style);

const logo = riveIcon("logo", { size: 28 });
document.querySelector("#brand-mark").append(logo.el);
const scene = riveIcon("rack", { size: 132, height: 88, inputs: { state: 3 } });
document.querySelector("#alarm-scene").append(scene.el);

const racks = [
  { id: "squires", name: "Squires North", status: "WARNING", latitude: 37.22975, longitude: -80.41835 },
  { id: "newman", name: "Newman Library", status: "ONLINE", latitude: 37.22868, longitude: -80.41925 },
  { id: "torgersen", name: "Torgersen Hall North", status: "OFFLINE", latitude: 37.22995, longitude: -80.41985 },
];
const map = rackMap(document.querySelector("#map"), {});
map.setRacks(racks);
setTimeout(() => { map.setRacks(racks); map.select("squires"); }, 2500);

const LINES = [
  ["16:58:12", "ok", "<b>torgersen</b> lock module checked in"],
  ["16:58:40", "", "<b>newman</b> card f02f1d68 denied: not registered here"],
  ["16:59:03", "ok", "<b>squires</b> Demo Rider unlocked"],
  ["17:00:21", "warn", "<b>squires</b> rack bumped, jolt 0.62 g"],
  ["17:00:30", "", "admin $ register 8474ffc1 \"Miles D.\" newman"],
  ["17:00:30", "ok", "registered Miles D. at newman. racks sync within a minute"],
  ["17:01:47", "alarm", "<b>squires</b> TAMPER ALARM, jolt 1.31 g, siren on"],
  ["17:01:48", "", "admin $ tap newman"],
  ["17:01:48", "ok sim", "<b>newman</b> Miles D. unlocked"],
  ["17:02:05", "", "<b>torgersen</b> offline 14 min"],
];
const feed = document.querySelector("#feed");
for (const [t, cls, msg] of LINES) {
  const line = document.createElement("div");
  line.className = `line ${cls}`;
  const time = document.createElement("span");
  time.className = "t";
  time.textContent = t;
  const badge = document.createElement("span");
  badge.className = "badge";
  if (cls.includes("alarm")) badge.style.background = "#ff7b72";
  else if (cls.includes("warn")) badge.style.background = "#e3b341";
  const text = document.createElement("span");
  text.className = "msg";
  // Sample text written in this file (not user data), so innerHTML is safe here.
  text.innerHTML = msg;
  line.append(time, badge, text);
  feed.append(line);
}
