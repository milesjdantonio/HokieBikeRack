// The rack map. Same stack as Miles's TerraSim: MapLibre GL JS, OpenFreeMap's OpenStreetMap
// style (streets, labels and 3D buildings, no key) and Esri World Imagery underneath (free with
// attribution). Styled for the app's dark ground: imagery dimmed like a photo in a dark room,
// buildings extruded in a dark tone, labels in the app's ink.
//
// If the map can't load (offline, no WebGL), a plain message stands in and the list still works.
import * as maplibregl from "../vendor/maplibre/maplibre-gl.mjs";
import { h } from "../js/dom.js";
import { icon } from "./icons.js";
import { riveIcon } from "../js/rive.js";

maplibregl.setWorkerUrl(new URL("../vendor/maplibre/maplibre-gl-worker.mjs", import.meta.url).href);

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};
// Virginia Tech's Drillfield, looking north-west over campus.
const CAMPUS = { center: [-80.4224, 37.2281], zoom: 16, pitch: 55, bearing: -18 };
// The map can't be panned or zoomed out past Virginia Tech (campus plus a margin of Blacksburg).
const VT_BOUNDS = [[-80.4520, 37.2050], [-80.3930, 37.2490]];
const MIN_ZOOM = 14;

let stylePromise = null;
function loadStyle() {
  stylePromise = stylePromise || fetch(STYLE_URL).then((r) => {
    if (!r.ok) throw new Error(`map style ${r.status}`);
    return r.json();
  }).catch((e) => { stylePromise = null; throw e; });   // a failure isn't remembered: the next map tries again
  return stylePromise.then((style) => structuredClone(style));
}

/**
 * Restyles OpenFreeMap's style for a dark page. `look` options:
 *   satellite   true = Esri imagery under the streets (default); false = a dark street map only
 *   saturation  imagery colour, -1 (grey) .. 0 (as photographed)
 *   brightness  imagery brightness cap, 0..1
 *   ground      page/background colour
 *   building    3D building colour
 */
function darken(style, look = {}) {
  const { satellite: useSatellite = true, saturation = -0.35, brightness = 0.62, ground = "#0e0a0c", building = "#2c2330",
    label = "#e9dfe3" } = look;
  const under = style.layers.filter((l) => l.type === "background" || (l.type === "fill" && !/building/.test(l.id)));
  const over = style.layers.filter((l) => !under.includes(l));
  if (useSatellite) {
    style.sources.satellite = { type: "raster", tiles: [SATELLITE.url], tileSize: 256, maxzoom: 19, attribution: SATELLITE.attribution };
    // Imagery above land/water fills, below roads, labels and buildings (TerraSim's order).
    const satellite = { id: "satellite", type: "raster", source: "satellite",
      paint: { "raster-brightness-max": brightness, "raster-saturation": saturation, "raster-contrast": 0.05, "raster-fade-duration": 200 } };
    style.layers = [...under, satellite, ...over];
  } else {
    // Night street map: land, parks and water as quiet steps of the ground colour.
    for (const l of under) {
      l.paint = l.paint || {};
      if (l.type !== "fill") continue;
      l.paint["fill-color"] = /water/.test(l.id) ? "#0c1824" : /park|grass|wood|forest|landcover|green/.test(l.id) ? "#0f1714" : "#0d1117";
      l.paint["fill-opacity"] = 1;
    }
  }
  for (const l of style.layers) {
    l.paint = l.paint || {};
    if (l.type === "background") l.paint["background-color"] = ground;
    if (l.type === "line") {
      const minor = /path|footway|cycle|track/.test(l.id);
      if (useSatellite) l.paint["line-opacity"] = minor ? 0.25 : 0.35;
      else if (!/boundary|water/.test(l.id)) { l.paint["line-color"] = minor ? "#1f2833" : "#2c3846"; l.paint["line-opacity"] = minor ? 0.8 : 1; }
    }
    if (l.type === "symbol") {
      l.paint["text-color"] = label;
      l.paint["text-halo-color"] = ground;
      l.paint["text-halo-width"] = 1.2;
      l.paint["icon-opacity"] = 0.6;
      // Fewer labels: only names that help find a rack (buildings, streets, places).
      if (/poi|shield/.test(l.id)) l.layout = { ...(l.layout || {}), visibility: "none" };
    }
    if (l.type === "fill-extrusion") {
      l.paint["fill-extrusion-color"] = building;
      l.paint["fill-extrusion-opacity"] = 0.9;
      l.paint["fill-extrusion-vertical-gradient"] = true;
    }
    if (l.type === "fill" && /building/.test(l.id)) l.paint["fill-opacity"] = 0.4;
  }
  style.sky = { "sky-color": ground, "horizon-color": "#1e1519", "fog-color": ground, "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.7 };
  return style;
}

/** Rive pin status number for a rack (see tools/rive/art/pin.mjs). */
const PIN_STATUS = { ONLINE: 0, WARNING: 1, UNCONFIRMED: 1, ALARM: 2, OFFLINE: 3, UNKNOWN: 3 };
// Police alerted (an open incident) wins over everything: the pin flashes red and blue.
const pinStatus = (r) => (r.police ? 4 : r.alarm ? 2 : PIN_STATUS[r.status] ?? 3);

/**
 * Mounts a map in `container`.
 * Returns { setRacks(racks), select(id), setInset(px), fitAll(), flash(id, event), destroy() }.
 * onSelect(rack) is called when a marker is clicked.
 *
 * Pins are Rive animations (pin.riv): they change colour, shudder on an alarm, and show a check or a
 * cross when a card is tapped (flash(id, "unlock" | "deny")). Each pin is made once and then only
 * told what changed, so a status change animates instead of popping.
 *
 * setInset({ left, right, top, bottom }) tells the map how much of it is covered (by a side panel),
 * so "centre on this rack" means the middle of the part you can see, not the middle of the window.
 */
export function rackMap(container, { interactive = true, onSelect, focus = null, look = {}, view = {} } = {}) {
  const cam = { ...CAMPUS, ...view };
  container.classList.add("map");
  const markers = new Map();   // rack id -> { marker, el, pin, label, rack }
  let map = null;
  let pending = null;
  let selected = null;
  let destroyed = false;
  let fitted = false;
  let inset = { left: 0, right: 0, top: 0, bottom: 0 };

  const fallback = (text) => container.replaceChildren(h("p", { class: "map-fallback" }, text));

  (async () => {
    let style;
    try { style = darken(await loadStyle(), look); } catch { fallback("The map couldn't load. The list below still works."); return; }
    if (destroyed) return;
    try {
      map = new maplibregl.Map({
        container, style, interactive, attributionControl: { compact: true },
        center: focus ? [focus.longitude, focus.latitude] : cam.center,
        zoom: focus ? 17.2 : cam.zoom, pitch: cam.pitch, bearing: cam.bearing, maxPitch: 70, maxBounds: VT_BOUNDS, minZoom: MIN_ZOOM,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      fallback("This browser can't show the map (WebGL is off). The list below still works.");
      return;
    }
    map.setPadding(inset);
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.on("load", () => {
      container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      if (pending) setRacks(pending);
    });
    map.on("error", () => { /* a missing tile shouldn't break the page */ });
  })();

  function makeMarker(r) {
    const pin = riveIcon("pin", { size: 60, inputs: { status: pinStatus(r), selected: r.id === selected } });
    const label = h("span", { class: "marker-label" }, r.label || r.name);
    // The plain disc is the fallback if Rive can't load; CSS hides it once the pin is drawn.
    const el = h("button", { type: "button", class: "marker marker-rive",
      onClick: (e) => { e.stopPropagation(); select(r.id); if (onSelect) onSelect(markers.get(r.id)?.rack || r); } },
    pin.el, h("span", { class: "marker-disc" }, icon("racks")), label);
    const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([r.longitude, r.latitude]).addTo(map);
    return { marker, el, pin, label, rack: r };
  }

  function setRacks(racks) {
    pending = racks;
    if (!map || !map.loaded()) return;
    const placed = racks.filter((r) => r.latitude != null && r.longitude != null);
    for (const [id, m] of markers) {
      if (!placed.some((r) => r.id === id)) { m.marker.remove(); m.pin.destroy(); markers.delete(id); }
    }
    for (const r of placed) {
      let m = markers.get(r.id);
      if (!m) { m = makeMarker(r); markers.set(r.id, m); }
      m.rack = r;
      m.marker.setLngLat([r.longitude, r.latitude]);
      m.label.textContent = r.label || r.name;
      m.pin.set("status", pinStatus(r));
      const word = r.alarm ? "alarm" : String(r.status || "unknown").toLowerCase();
      // classList, not className: MapLibre's own marker classes (its positioning) must stay.
      for (const c of [...m.el.classList]) if (c.startsWith("marker-") && c !== "marker-rive" && c !== "marker-label") m.el.classList.remove(c);
      m.el.classList.add(`marker-${word}`);
      m.el.classList.toggle("selected", r.id === selected);
      m.el.setAttribute("aria-label", `${r.name}, ${word}`);
    }
    if (!fitted && placed.length && !focus) {
      fitted = true;
      fitAll(0);
    }
  }

  /** Shows every placed rack inside the visible part of the map. */
  function fitAll(duration = 800) {
    const placed = [...markers.values()].map((m) => m.rack);
    if (!map || !placed.length) return;
    if (placed.length === 1) { map.easeTo({ center: [placed[0].longitude, placed[0].latitude], zoom: 17, duration }); return; }
    const b = new maplibregl.LngLatBounds();
    for (const r of placed) b.extend([r.longitude, r.latitude]);
    map.fitBounds(b, { padding: 80, maxZoom: 17.3, duration, pitch: cam.pitch, bearing: cam.bearing });
  }

  function select(id, { move = true } = {}) {
    selected = id;
    for (const [rid, m] of markers) {
      m.el.classList.toggle("selected", rid === id);
      m.pin.set("selected", rid === id);
    }
    const m = markers.get(id);
    if (m && map && move) map.easeTo({ center: m.marker.getLngLat(), duration: 700, zoom: Math.max(map.getZoom(), 16.6) });
  }

  function setInset(next, { duration = 500 } = {}) {
    inset = { left: 0, right: 0, top: 0, bottom: 0, ...next };
    if (!map) return;
    // Easing only the padding keeps the same spot in the middle, now the middle of the visible part.
    map.easeTo({ padding: inset, duration });
  }

  /**
   * Move on Map: the rack's pin becomes draggable and a click on the map moves it there.
   * onChange({ latitude, longitude }) runs on every move. Returns { stop(keep) }: stop(false) puts
   * the pin back where it was.
   */
  function startMove(id, onChange) {
    const m = markers.get(id);
    if (!m || !map) return { stop() {} };
    const from = m.marker.getLngLat();
    const report = () => { const p = m.marker.getLngLat(); onChange?.({ latitude: round(p.lat), longitude: round(p.lng) }); };
    const onClick = (e) => { m.marker.setLngLat(e.lngLat); report(); };
    m.marker.setDraggable(true);
    m.marker.on("dragend", report);
    m.el.classList.add("moving");
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return {
      stop(keep = true) {
        m.marker.setDraggable(false);
        m.marker.off("dragend", report);
        m.el.classList.remove("moving");
        map.off("click", onClick);
        map.getCanvas().style.cursor = "";
        if (!keep) m.marker.setLngLat(from);
      },
    };
  }

  /** Plays a one-off event on a rack's pin: "unlock" (check) or "deny" (cross). */
  function flash(id, event) {
    markers.get(id)?.pin.fire(event);
  }

  function destroy() {
    destroyed = true;
    for (const m of markers.values()) { m.marker.remove(); m.pin.destroy(); }
    markers.clear();
    if (map) map.remove();
  }

  return { setRacks, select, setInset, fitAll, flash, startMove, destroy };
}

/**
 * Picking where a rack stands, the way TerraSim picks land: click the map to drop the pin, drag it
 * to adjust. Starts looking straight down (easier to be exact) close in over campus or the rack.
 * onPick({ latitude, longitude }) runs on every click or drag. Returns { flyTo, setPoint, destroy }.
 */
export function placeMap(container, { initial = null, onPick } = {}) {
  container.classList.add("map", "map-place");
  let map = null;
  let marker = null;
  let destroyed = false;
  const pinEl = () => h("span", { class: "marker marker-pin" }, h("span", { class: "marker-disc" }, icon("racks")));

  function setPoint(lngLat, notify = true) {
    if (!map) return;
    if (!marker) {
      marker = new maplibregl.Marker({ element: pinEl(), anchor: "center", draggable: true }).setLngLat(lngLat).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        if (onPick) onPick({ latitude: round(p.lat), longitude: round(p.lng) });
      });
    } else {
      marker.setLngLat(lngLat);
    }
    if (notify && onPick) onPick({ latitude: round(lngLat[1] ?? lngLat.lat), longitude: round(lngLat[0] ?? lngLat.lng) });
  }

  (async () => {
    let style;
    try { style = darken(await loadStyle()); } catch { container.replaceChildren(h("p", { class: "map-fallback" }, "The map couldn't load. Try again when you're online.")); return; }
    if (destroyed) return;
    const start = initial ? [initial.longitude, initial.latitude] : CAMPUS.center;
    try {
      map = new maplibregl.Map({ container, style, attributionControl: { compact: true }, center: start,
        zoom: initial ? 18.6 : 17, pitch: 0, bearing: 0, maxPitch: 70, maxBounds: VT_BOUNDS, minZoom: MIN_ZOOM, canvasContextAttributes: { antialias: true } });
    } catch {
      container.replaceChildren(h("p", { class: "map-fallback" }, "This browser can't show the map (WebGL is off)."));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.getCanvas().style.cursor = "crosshair";
    map.on("load", () => {
      container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      if (initial) setPoint([initial.longitude, initial.latitude], false);
    });
    map.on("click", (e) => setPoint([e.lngLat.lng, e.lngLat.lat]));
    map.on("error", () => {});
  })();

  return {
    setPoint,
    flyTo(lng, lat) { if (map) map.flyTo({ center: [lng, lat], zoom: 18.6, pitch: 0, bearing: 0, duration: 900 }); },
    destroy() { destroyed = true; if (marker) marker.remove(); if (map) map.remove(); },
  };
}

// 6 decimal places is about 10 cm: plenty for a bike rack.
const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Place search, like TerraSim's: Photon (komoot's OpenStreetMap search, free, no key), biased
 * toward Blacksburg. Returns [{ name, detail, lng, lat }].
 */
export async function searchPlaces(query) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lat", "37.2284");
  url.searchParams.set("lon", "-80.4234");
  url.searchParams.set("limit", "6");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search isn't available right now.");
  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const detail = [p.street && `${p.housenumber ? `${p.housenumber} ` : ""}${p.street}`, p.city || p.town || p.village, p.state]
      .filter(Boolean).join(", ");
    return { name: p.name || p.street || "Unnamed place", detail, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  });
}
