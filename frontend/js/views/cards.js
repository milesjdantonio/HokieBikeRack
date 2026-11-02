// Cards page: who may unlock which racks. Also the shared "Register card" dialog.
import { api } from "../api.js";
import { badge, clear, confirmDialog, emptyRow, errorBox, formatTime, h, loading, modal, panel, relativeTime,
  shortRef, statusBadge, toast } from "../ui.js";

/** <input type="datetime-local"> value <-> ISO string (in the browser's time zone). */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function rackCheckboxes(racks, selectedIds) {
  return h("fieldset", { class: "rack-checks" }, h("legend", {}, "Allowed racks"),
    racks.length ? racks.map((r) => h("label", { class: "checkbox" },
      h("input", { type: "checkbox", name: "rack", value: r.id, checked: selectedIds.includes(r.id) }), ` ${r.name}`))
      : h("p", { class: "muted" }, "No racks yet."));
}

function selectedRacks(form) {
  return [...form.querySelectorAll("input[name=rack]:checked")].map((i) => i.value);
}

/**
 * Register a card. `prefill.credentialReference` usually comes from an
 * "Access denied" event, i.e. someone just tapped it on a rack.
 */
export async function openRegisterDialog(ctx, prefill = {}, onDone = () => {}) {
  let racks = [];
  try { racks = await api("/racks"); } catch (err) { toast(err.message, "error"); return; }
  const form = h("form", { class: "stack-form", id: "register-form" },
    h("label", {}, "Card reference",
      h("input", { name: "ref", value: prefill.credentialReference || "", required: true, pattern: "[0-9a-fA-F]{64}",
        placeholder: "64 hex characters (from a denied tap or the serial monitor)", class: "mono" })),
    h("label", {}, "Name / label",
      h("input", { name: "label", required: true, maxlength: 120, placeholder: "e.g. Miles' student ID" })),
    h("label", { class: "checkbox" }, h("input", { type: "checkbox", name: "allRacks" }), " Allowed at every rack"),
    rackCheckboxes(racks, prefill.rackId ? [prefill.rackId] : []),
    h("label", {}, "Valid until (optional)", h("input", { name: "until", type: "datetime-local" })));
  const m = modal({
    title: "Register card",
    body: [form, h("p", { class: "muted small-text" },
      "Racks pick up the change on their next sync (about a minute while online).")],
    actions: [
      h("button", { class: "ghost", type: "button", onClick: () => m.close() }, "Cancel"),
      h("button", { type: "submit", form: "register-form" }, "Register"),
    ],
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/credentials", { method: "POST", body: {
        credentialReference: form.elements.ref.value.trim().toLowerCase(),
        displayLabel: form.elements.label.value.trim(),
        allRacks: form.elements.allRacks.checked,
        rackIds: selectedRacks(form),
        validUntil: fromLocalInput(form.elements.until.value),
      } });
      toast("Card registered", "ok");
      m.close();
      onDone();
    } catch (err) { toast(err.message, "error"); }
  });
  if (prefill.credentialReference) form.elements.label.focus();
}

async function openEditDialog(card, onDone) {
  let racks = [];
  try { racks = await api("/racks"); } catch (err) { toast(err.message, "error"); return; }
  const form = h("form", { class: "stack-form", id: "edit-card-form" },
    h("p", { class: "muted small-text mono" }, card.credentialReference),
    h("label", {}, "Name / label", h("input", { name: "label", value: card.displayLabel, required: true, maxlength: 120 })),
    h("label", { class: "checkbox" }, h("input", { type: "checkbox", name: "active", checked: card.active }), " Enabled"),
    h("label", { class: "checkbox" }, h("input", { type: "checkbox", name: "allRacks", checked: card.allRacks }), " Allowed at every rack"),
    rackCheckboxes(racks, card.rackIds),
    h("label", {}, "Valid until (empty = no end)", h("input", { name: "until", type: "datetime-local", value: toLocalInput(card.validUntil) })));
  const m = modal({
    title: `Edit ${card.displayLabel}`,
    body: form,
    actions: [
      h("button", { class: "ghost", type: "button", onClick: () => m.close() }, "Cancel"),
      h("button", { type: "submit", form: "edit-card-form" }, "Save"),
    ],
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const until = fromLocalInput(form.elements.until.value);
    try {
      await api(`/credentials/${card.id}`, { method: "PATCH", body: {
        displayLabel: form.elements.label.value.trim(),
        active: form.elements.active.checked,
        allRacks: form.elements.allRacks.checked,
        rackIds: selectedRacks(form),
        validUntil: until,
        clearValidUntil: until === null,
      } });
      toast("Card saved", "ok");
      m.close();
      onDone();
    } catch (err) { toast(err.message, "error"); }
  });
}

export async function revokeCard(card, onDone) {
  const yes = await confirmDialog("Revoke card?",
    `“${card.displayLabel}” will stop working at every rack after their next sync. This can't be undone (you'd register it again).`,
    "Revoke", true);
  if (!yes) return;
  try {
    await api(`/credentials/${card.id}/revoke`, { method: "POST" });
    toast("Card revoked", "ok");
    onDone();
  } catch (err) { toast(err.message, "error"); }
}

export function render(container, ctx) {
  const body = h("div", {}, loading());
  let showRevoked = false;
  const revokedToggle = h("label", { class: "checkbox" }, h("input", { type: "checkbox", onChange: (e) => { showRevoked = e.target.checked; load(); } }), " Show revoked");

  async function load() {
    try {
      const [cards, racks] = await Promise.all([api("/credentials"), api("/racks")]);
      const rackName = Object.fromEntries(racks.map((r) => [r.id, r.name]));
      const visible = cards.filter((c) => showRevoked || c.status !== "REVOKED");
      clear(body).append(h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Card", "Status", "Racks", "Valid until", "Last used", "Uses", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, visible.length ? visible.map((c) => h("tr", { class: c.status === "REVOKED" ? "row-muted" : "" },
          h("td", {}, h("strong", {}, c.displayLabel), h("div", { class: "muted small-text" }, h("code", { title: c.credentialReference }, shortRef(c.credentialReference)))),
          h("td", {}, statusBadge(c.status)),
          h("td", {}, c.allRacks ? badge("all racks", "info") : (c.rackIds.length ? c.rackIds.map((id) => rackName[id] || "?").join(", ") : h("span", { class: "warn-text" }, "none"))),
          h("td", {}, c.validUntil ? formatTime(c.validUntil) : "—"),
          h("td", { title: c.lastUsedAt || "" }, relativeTime(c.lastUsedAt)),
          h("td", {}, String(c.grantedCount)),
          h("td", { class: "actions-cell" }, ctx.canEdit && c.status !== "REVOKED" ? [
            h("button", { class: "small ghost", type: "button", onClick: () => openEditDialog(c, load) }, "Edit"),
            h("button", { class: "small danger-ghost", type: "button", onClick: () => revokeCard(c, load) }, "Revoke"),
          ] : null)))
          : emptyRow(7, "No cards registered. Tap a card on a rack, then register it from the Overview page.")))));
      ctx.markUpdated();
    } catch (err) {
      clear(body).append(errorBox(err, load));
    }
  }

  container.append(panel("Cards", "Cards are stored as a keyed hash (credential reference), never the raw card ID.",
    h("div", { class: "panel-actions" }, revokedToggle,
      ctx.canEdit ? h("button", { type: "button", onClick: () => openRegisterDialog(ctx, {}, load) }, "Register card") : null),
    body));
  load();
  return null;
}
