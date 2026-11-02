// The rack map. Same stack as Miles's TerraSim: MapLibre GL JS, OpenFreeMap's OpenStreetMap
// style (streets, labels and 3D buildings, no key) and Esri World Imagery underneath (free with
// attribution). Styled for the app's dark ground: imagery dimmed like a photo in a dark room,
// buildings extruded in a dark tone, labels in the app's ink.
//
// If the map can't load (offline, no WebGL), a plain message stands in and the list still works.
import * as maplibregl from "../../vendor/maplibre/maplibre-gl.mjs";
import { h } from "../../js/dom.js";
import { icon } from "./ui.js";

maplibregl.setWorkerUrl(new URL("../../vendor/maplibre/maplibre-gl-worker.mjs", import.meta.url).href);

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};
// Virginia Tech's Drillfield, looking north-west over campus.
const CAMPUS = { center: [-80.4224, 37.2281], zoom: 16, pitch: 55, bearing: -18 };

let stylePromise = null;
function loadStyle() {
  stylePromise = stylePromise || fetch(STYLE_URL).then((r) => {
    if (!r.ok) throw new Error(`map style ${r.status}`);
    return r.json();
  }).catch((e) => { stylePromise = null; throw e; });   // a failure isn't remembered: the next map tries again
  return stylePromise.then((style) => structuredClone(style));
}

function darken(style) {
  style.sources.satellite = { type: "raster", tiles: [SATELLITE.url], tileSize: 256, maxzoom: 19, attribution: SATELLITE.attribution };
  // Imagery above land/water fills, below roads, labels and buildings (TerraSim's order).
  const under = style.layers.filter((l) => l.type === "background" || (l.type === "fill" && !/building/.test(l.id)));
  const over = style.layers.filter((l) => !under.includes(l));
  const satellite = { id: "satellite", type: "raster", source: "satellite",
    paint: { "raster-brightness-max": 0.62, "raster-saturation": -0.35, "raster-contrast": 0.05, "raster-fade-duration": 200 } };
  style.layers = [...under, satellite, ...over];
  for (const l of style.layers) {
    l.paint = l.paint || {};
    if (l.type === "background") l.paint["background-color"] = "#0e0a0c";
    if (l.type === "line") l.paint["line-opacity"] = /path|footway|cycle|track/.test(l.id) ? 0.25 : 0.35;
    if (l.type === "symbol") {
      l.paint["text-color"] = "#e9dfe3";
      l.paint["text-halo-color"] = "#0e0a0c";
      l.paint["text-halo-width"] = 1.2;
      l.paint["icon-opacity"] = 0.6;
      // Fewer labels: only names that help find a rack (buildings, streets, places).
      if (/poi|shield/.test(l.id)) l.layout = { ...(l.layout || {}), visibility: "none" };
    }
    if (l.type === "fill-extrusion") {
      l.paint["fill-extrusion-color"] = "#2c2330";
      l.paint["fill-extrusion-opacity"] = 0.9;
      l.paint["fill-extrusion-vertical-gradient"] = true;
    }
    if (l.type === "fill" && /building/.test(l.id)) l.paint["fill-opacity"] = 0.4;
  }
  style.sky = { "sky-color": "#0e0a0c", "horizon-color": "#1e1519", "fog-color": "#0e0a0c", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.7 };
  return style;
}

/**
 * Mounts a map in `container`. Returns { setRacks(racks), select(id), destroy() }.
 * onSelect(rack) is called when a marker is clicked.
 */
export function rackMap(container, { interactive = true, onSelect, focus = null } = {}) {
  container.classList.add("map");
  const markers = new Map();   // rack id -> { marker, el, sig }
  let map = null;
  let pending = null;
  let selected = null;
  let destroyed = false;
  let fitted = false;

  const fallback = (text) => container.replaceChildren(h("p", { class: "map-fallback" }, text));

  (async () => {
    let style;
    try { style = darken(await loadStyle()); } catch { fallback("The map couldn't load. The list below still works."); return; }
    if (destroyed) return;
    try {
      map = new maplibregl.Map({
        container, style, interactive, attributionControl: { compact: true },
        center: focus ? [focus.longitude, focus.latitude] : CAMPUS.center,
        zoom: focus ? 17.2 : CAMPUS.zoom, pitch: CAMPUS.pitch, bearing: CAMPUS.bearing, maxPitch: 70,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      fallback("This browser can't show the map (WebGL is off). The list below still works.");
      return;
    }
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.on("load", () => {
      container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      if (pending) setRacks(pending);
    });
    map.on("error", () => { /* a missing tile shouldn't break the page */ });
  })();

  function setRacks(racks) {
    pending = racks;
    if (!map || !map.loaded()) return;
    const placed = racks.filter((r) => r.latitude != null && r.longitude != null);
    for (const [id, m] of markers) {
      if (!placed.some((r) => r.id === id)) { m.marker.remove(); markers.delete(id); }
    }
    for (const r of placed) {
      const sig = `${r.latitude},${r.longitude},${r.status},${r.name}`;
      const existing = markers.get(r.id);
      if (existing && existing.sig === sig) continue;
      if (existing) existing.marker.remove();
      // A still marker: the rack drawn in a disc, its ring coloured by status. No pulsing.
      const el = h("button", { type: "button", class: `marker marker-${r.status.toLowerCase()}${r.id === selected ? " selected" : ""}`,
        "aria-label": `${r.name}, ${r.status.toLowerCase()}`,
        onClick: (e) => { e.stopPropagation(); select(r.id); if (onSelect) onSelect(r); } },
      h("span", { class: "marker-disc" }, icon("racks")), h("span", { class: "marker-label" }, r.name));
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([r.longitude, r.latitude]).addTo(map);
      markers.set(r.id, { marker, el, sig });
    }
    if (!fitted && placed.length && !focus) {
      fitted = true;
      if (placed.length === 1) map.jumpTo({ center: [placed[0].longitude, placed[0].latitude], zoom: 17 });
      else {
        const b = new maplibregl.LngLatBounds();
        for (const r of placed) b.extend([r.longitude, r.latitude]);
        map.fitBounds(b, { padding: 70, maxZoom: 17.3, duration: 0, pitch: CAMPUS.pitch, bearing: CAMPUS.bearing });
      }
    }
  }

  function select(id) {
    selected = id;
    for (const [rid, m] of markers) m.el.classList.toggle("selected", rid === id);
    const m = markers.get(id);
    if (m && map) map.easeTo({ center: m.marker.getLngLat(), duration: 700, zoom: Math.max(map.getZoom(), 16.6) });
  }

  function destroy() {
    destroyed = true;
    for (const m of markers.values()) m.marker.remove();
    markers.clear();
    if (map) map.remove();
  }

  return { setRacks, select, destroy };
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
        zoom: initial ? 18.6 : 17, pitch: 0, bearing: 0, maxPitch: 70, canvasContextAttributes: { antialias: true } });
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
