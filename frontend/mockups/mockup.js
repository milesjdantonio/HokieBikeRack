// Admin mockup: sample data only. Shows the real map, the real rack animation in the alarm pop-up,
// and a terminal feed, so Miles can compare style A and B before the real build.
import { riveIcon } from "../js/rive.js";
import { rackMap } from "../app/js/map.js";

const style = ["a", "b", "b2", "b3"].includes(new URLSearchParams(location.search).get("style"))
  ? new URLSearchParams(location.search).get("style") : "a";
document.body.classList.add(`style-${style}`);
if (style === "b2" || style === "b3") document.body.classList.add("style-b");

// Each variation rearranges the same parts.
const stage = document.querySelector(".stage");
const panel = document.querySelector(".panel");
const needs = document.querySelector(".needs");
if (style === "b2") stage.prepend(panel);                       // docked column, nothing over the map
if (style === "b3") {
  document.querySelector(".map-area").append(needs);            // needs-you chips on the map
  // Bottom sheet: keep each heading with its list so columns don't split them.
  const kids = [...panel.children];
  const groups = [];
  let g = null;
  for (const k of kids) {
    if (k.classList.contains("panel-close") || k.classList.contains("panel-actions")) continue;
    if (!g || k.tagName === "H2") { g = document.createElement("div"); g.className = "group"; groups.push(g); }
    g.append(k);
  }
  // Name column holds the rack's actions and Close, so nothing overlaps the other columns.
  groups[0].append(panel.querySelector(".panel-actions"), panel.querySelector(".panel-close"));
  panel.append(...groups);
  document.querySelector(".term-head span").textContent = "feed";
}
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
const COOL = { ground: "#07090c", building: "#1d242d", label: "#d6dde5" };
const MAP_OPTIONS = {
  a: {},
  b: { look: COOL },
  b2: { look: { ...COOL, saturation: -1, brightness: 0.5 }, view: { pitch: 0, bearing: 0, zoom: 16.6 } },
  b3: { look: { ...COOL, satellite: false, building: "#1c2430" }, view: { pitch: 58, bearing: -25 } },
};
const map = rackMap(document.querySelector("#map"), MAP_OPTIONS[style]);
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
