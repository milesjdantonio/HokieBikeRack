// A short guided tour (Miles: "add a tutorial because I was confused"). Each step lights up one
// real part of the screen and says what it's for, in one or two sentences. Skippable at any
// point, keyboard friendly (Enter/Right = next, Left = back, Escape = close), shown once per
// app on this device and replayable from Settings.
import { h } from "../../js/dom.js";

const KEY = (name) => `hbr.tour.${name}`;
export const tourSeen = (name) => localStorage.getItem(KEY(name)) === "done";
export const resetTours = () => { for (const k of Object.keys(localStorage)) if (k.startsWith("hbr.tour.")) localStorage.removeItem(k); };

let active = null;

/**
 * steps: [{ target: selector | null, title, text }]. A step whose target isn't on the page (e.g.
 * an admin-only button for a viewer) is skipped. Returns a promise that settles when it closes.
 */
export function runTour(name, steps, { force = false } = {}) {
  if (active || (!force && tourSeen(name))) return Promise.resolve();
  const usable = steps.filter((s) => !s.target || document.querySelector(s.target));
  if (!usable.length) return Promise.resolve();

  return new Promise((resolve) => {
    let i = 0;
    const previousFocus = document.activeElement;
    const spot = h("div", { class: "tour-spot", "aria-hidden": "true" });
    const title = h("h2", { class: "tour-title", id: "tour-title" });
    const text = h("p", { class: "tour-text", id: "tour-text" });
    const dots = h("div", { class: "tour-dots", "aria-hidden": "true" });
    const back = h("button", { type: "button", class: "btn btn-quiet btn-small", onClick: () => go(i - 1) }, "Back");
    const next = h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => go(i + 1) }, "Next");
    const skip = h("button", { type: "button", class: "tour-skip", onClick: () => close() }, "Skip Tour");
    const card = h("div", { class: "tour-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title", "aria-describedby": "tour-text" },
      h("div", { class: "tour-head" }, dots, skip), title, text, h("div", { class: "tour-nav" }, back, next));
    const layer = h("div", { class: "tour", onClick: (e) => { if (e.target === layer) go(i + 1); } }, spot, card);
    document.body.append(layer);
    active = layer;

    function place() {
      const step = usable[i];
      const el = step.target && document.querySelector(step.target);
      const vw = innerWidth, vh = innerHeight;
      if (!el) {
        spot.hidden = true;
        card.style.left = `${Math.max(16, (vw - card.offsetWidth) / 2)}px`;
        card.style.top = `${Math.max(16, (vh - card.offsetHeight) / 2)}px`;
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 8;
      spot.hidden = false;
      spot.style.left = `${r.left - pad}px`;
      spot.style.top = `${r.top - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
      // The card goes below the target if it fits, else above, else centred.
      const cw = card.offsetWidth, ch = card.offsetHeight;
      let top = r.bottom + pad + 14;
      if (top + ch > vh - 12) top = r.top - pad - 14 - ch;
      if (top < 12) top = Math.max(12, (vh - ch) / 2);
      const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    function go(n) {
      if (n < 0) return;
      if (n >= usable.length) { close(true); return; }
      i = n;
      const step = usable[i];
      const el = step.target && document.querySelector(step.target);
      if (el) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      title.textContent = step.title;
      text.textContent = step.text;
      back.hidden = i === 0;
      next.textContent = i === usable.length - 1 ? "Done" : "Next";
      dots.replaceChildren(...usable.map((_, k) => h("span", { class: k === i ? "on" : "" })));
      requestAnimationFrame(() => { place(); next.focus(); });
      setTimeout(place, 420);   // after a smooth scroll settles
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Tab") {
        // Keep focus inside the card while the tour is open.
        const f = [...card.querySelectorAll("button:not([hidden])")];
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    const onResize = () => place();

    function close() {
      localStorage.setItem(KEY(name), "done");
      removeEventListener("keydown", onKey, true);
      removeEventListener("resize", onResize);
      removeEventListener("scroll", onResize, true);
      layer.remove();
      active = null;
      if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
      resolve();
    }

    addEventListener("keydown", onKey, true);
    addEventListener("resize", onResize);
    addEventListener("scroll", onResize, true);
    go(0);
  });
}

// ---------- the tours ----------

export const TOURS = {
  rider: [
    { target: null, title: "Welcome to HokieBikeRack", text: "See which bike racks are working, where they are, and what happens when you tap your card." },
    { target: ".split .map", title: "Every Rack on Campus", text: "The ring around each rack shows how it's doing: green is ready, amber needs attention, grey is offline." },
    { target: ".find-near", title: "Find the Closest One", text: "Uses your location on this device only. Nothing is sent anywhere." },
    { target: ".list .row", title: "Open a Rack", text: "See it up close, how busy it's been today, and try a tap to see what the lock does." },
    { target: '.tab[data-tab="card"]', title: "Your Card", text: "Where your card works and every time you've used it." },
    { target: '.tab[data-tab="alerts"]', title: "Alerts", text: "If someone tampers with a rack you use, you'll see it here." },
    { target: '.tab[data-tab="settings"]', title: "Settings", text: "Sound, and this tour again whenever you want it." },
  ],
  rack: [
    { target: ".stage", title: "This Is the Rack", text: "The lock module sits on the rack's right leg: a light on top, the card reader below it." },
    { target: ".try-tap", title: "See What a Tap Does", text: "Plays what happens when an allowed card taps: green light, one beep, open for 5 seconds. Nothing really unlocks." },
    { target: ".facts", title: "Today at This Rack", text: "Its status, when it last checked in, and how many unlocks and tamper alerts it had today." },
  ],
  staff: [
    { target: null, title: "Staff App", text: "Keep racks working: their health, alerts to look at, and new cards to register." },
    { target: ".split .map", title: "Rack Health", text: "Every rack on the map and in the list. Open one to see its lock modules and recent activity." },
    { target: ".add-rack", title: "Add a Rack", text: "Name it, then click the map where it stands. Drag the pin to fine-tune." },
    { target: '.tab[data-tab="alerts"]', title: "Alerts", text: "Tamper alarms and sensor problems. Mark them Handled once someone has checked." },
    { target: '.tab[data-tab="cards"]', title: "Cards", text: "When someone taps a card that isn't registered, it waits here. Register it and it works within a minute." },
    { target: '.tab[data-tab="settings"]', title: "Settings", text: "Replay this tour, switch to the rider app, or open the admin console." },
  ],
};
