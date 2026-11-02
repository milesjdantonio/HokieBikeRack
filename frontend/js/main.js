// Entry point: login, the top bar, and switching between pages ("views").
// Each view is a module with render(container, ctx) that may return
// { cleanup } (e.g. to stop its auto-refresh timer when you leave the page).
import { api, clearCredentials, hasCredentials, setCredentials, setUnauthorizedHandler } from "./api.js";
import { clear, errorBox, h } from "./ui.js";
import * as overview from "./views/overview.js";
import * as events from "./views/events.js";
import * as racks from "./views/racks.js";
import * as cards from "./views/cards.js";
import * as reports from "./views/reports.js";
import * as audit from "./views/audit.js";
import { openAppPreview } from "./app-preview.js";
import { riveIcon } from "./rive.js";

const VIEWS = { overview, events, racks, cards, reports, audit };

const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const viewEl = document.querySelector("#view");
const liveIndicator = document.querySelector("#live-indicator");
const liveText = document.querySelector("#live-text");
const livePulse = riveIcon("pulse", { size: 22, inputs: { status: 1 } });
liveIndicator.prepend(livePulse.el);
const loginLock = riveIcon("lock", { size: 72, inputs: { unlocked: false }, label: "Locked" });
document.querySelector("#login-lock").append(loginLock.el);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let current = null;
const ctx = {
  me: null,
  canEdit: false,
  navigate(hash) { window.location.hash = hash; },
  /** Views call this after a successful refresh so the "Live" chip shows the time. */
  markUpdated() {
    liveText.textContent = `Live · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    liveIndicator.classList.remove("chip-error");
    livePulse.set("status", 1);
  },
  markError() {
    liveText.textContent = "Backend unreachable";
    liveIndicator.classList.add("chip-error");
    livePulse.set("status", 0);
  },
};

function showLogin(message = "") {
  if (current && current.cleanup) current.cleanup();
  current = null;
  appView.hidden = true;
  loginView.hidden = false;
  document.querySelector("#login-error").textContent = message;
  document.querySelector("#login-form [name=password]").focus();
}

async function startApp(fromLogin = false) {
  try {
    ctx.me = await api("/me");
  } catch (err) {
    clearCredentials();
    showLogin(err.status === 401 ? "Wrong username or password." : err.message);
    return;
  }
  if (fromLogin) {
    // Little reward: the padlock opens, then the card slides away.
    loginLock.set("unlocked", true);
    document.querySelector("#login-form").classList.add("unlocking");
    await sleep(900);
    document.querySelector("#login-form").classList.remove("unlocking");
    loginLock.set("unlocked", false);
  }
  ctx.canEdit = Boolean(ctx.me.canEdit);
  document.body.classList.toggle("read-only", !ctx.canEdit);
  document.querySelector("#user-chip").textContent =
    `${ctx.me.username} · ${ctx.canEdit ? "Admin" : "Read-only"}`;
  loginView.hidden = true;
  appView.hidden = false;
  renderRoute();
}

function renderRoute() {
  if (appView.hidden) return;
  const name = (window.location.hash.slice(1) || "overview").split("?")[0];
  const view = VIEWS[name] || overview;
  if (current && current.cleanup) current.cleanup();
  for (const link of document.querySelectorAll(".tabs a")) {
    link.classList.toggle("active", link.dataset.view === (VIEWS[name] ? name : "overview"));
    if (link.classList.contains("active")) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  clear(viewEl);
  try {
    current = view.render(viewEl, ctx) || null;
  } catch (err) {
    viewEl.append(errorBox(err));
  }
  viewEl.focus({ preventScroll: true });
}

document.querySelector("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  setCredentials(form.get("username").trim(), form.get("password"));
  e.target.querySelector("[name=password]").value = "";
  await startApp(true);
});

document.querySelector("#logout-button").addEventListener("click", () => {
  clearCredentials();
  showLogin("Signed out.");
});

document.querySelector("#app-preview-button").addEventListener("click", () => openAppPreview(ctx));

setUnauthorizedHandler(() => {
  clearCredentials();
  showLogin("Your session ended. Please sign in again.");
});

window.addEventListener("hashchange", renderRoute);

if (hasCredentials()) startApp();
else showLogin();

// Exported for views that want to build links.
export { h };
