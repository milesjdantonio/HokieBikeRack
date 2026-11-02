// "Where does this rack stand?" Click the map to drop a pin, drag it to fine-tune, then save.
// Same interaction as TerraSim's land outline (click, drag, Enter finishes, Escape cancels, a
// live hint says what to do next), plus TerraSim's place search to jump to a building.
import { h } from "../../js/dom.js";
import { placeMap, searchPlaces } from "./map.js";
import { button } from "./ui.js";

/**
 * Returns { el, destroy }. onSave({ latitude, longitude }) may return a promise; the panel shows
 * "Saving" until it settles. `fields` are extra inputs shown above the map (e.g. a name).
 */
export function placementPanel({ initial = null, saveLabel = "Save Location", fields = [], onSave, onCancel }) {
  let point = initial ? { latitude: initial.latitude, longitude: initial.longitude } : null;
  const hint = h("p", { class: "place-hint", "aria-live": "polite" });
  const readout = h("p", { class: "small faint place-readout" });
  const save = button(saveLabel, () => submit(), { kind: "primary" });
  const results = h("div", { class: "place-results", role: "listbox", "aria-label": "Search results", hidden: true });
  const query = h("input", { class: "input", type: "search", placeholder: "Torgersen Hall", autocomplete: "off",
    enterkeyhint: "search" });
  const mapEl = h("div");
  const error = h("p", { class: "form-error", role: "alert" });

  function describe() {
    hint.textContent = point
      ? "Drag the pin to fine-tune it, then save."
      : "Click the map where the rack stands. Zoom in close: the satellite view shows racks and paths.";
    readout.textContent = point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "";
    save.disabled = !point;
  }

  const map = placeMap(mapEl, { initial, onPick: (p) => { point = p; describe(); } });

  // Search as you type (debounced), like TerraSim's place search.
  let searchTimer = null;
  let searchSeq = 0;
  query.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = query.value.trim();
    if (q.length < 3) { results.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const found = await searchPlaces(q);
        if (seq !== searchSeq) return;   // a newer search is on its way
        results.replaceChildren(...(found.length ? found.map((f) =>
          h("button", { type: "button", class: "place-result", role: "option", onClick: () => {
            map.flyTo(f.lng, f.lat);
            results.hidden = true;
            query.value = f.name;
            hint.textContent = point ? hint.textContent : `Now click the exact spot near ${f.name}.`;
          } }, h("span", {}, f.name), f.detail ? h("span", { class: "small muted" }, f.detail) : null))
          : [h("p", { class: "small muted place-none" }, "No places found.")]));
        results.hidden = false;
      } catch (e) {
        results.replaceChildren(h("p", { class: "small muted place-none" }, e.message));
        results.hidden = false;
      }
    }, 300);
  });
  query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); results.querySelector(".place-result")?.click(); }
  });

  async function submit() {
    if (!point || save.disabled) return;
    error.textContent = "";
    save.disabled = true;
    const label = save.lastChild.textContent;
    save.lastChild.textContent = "Saving";
    try {
      await onSave(point);
    } catch (e) {
      error.textContent = e.message;
      save.disabled = false;
    }
    save.lastChild.textContent = label;
  }

  const el = h("div", { class: "form placing", onKeydown: (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") { e.preventDefault(); submit(); }
  } },
  fields,
  h("label", { class: "field" }, h("span", {}, "Jump to a place"), h("div", { class: "place-search" }, query, results)),
  hint, mapEl, readout, error,
  h("div", { class: "btn-row" }, save, button("Cancel", () => onCancel(), { kind: "quiet" })));
  describe();
  return { el, destroy: () => { clearTimeout(searchTimer); map.destroy(); } };
}
