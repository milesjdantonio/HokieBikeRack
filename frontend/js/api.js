// Talks to the backend. Every request carries the HTTP Basic login.
//
// Where is the password kept? In sessionStorage: it disappears when the tab
// closes, and it's only readable by pages from this same server. Good enough
// for a local demo; a real deployment would use proper login sessions/tokens
// over HTTPS. See docs/notes/frontend.md.

import { apiUrl, backendReady } from "./backend.js";

const AUTH_KEY = "hbr.auth";
let onUnauthorized = () => {};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Base64 that also works for non-English characters in passwords. */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Saves the login for this tab (sent with every request). */
export function setCredentials(username, password) {
  sessionStorage.setItem(AUTH_KEY, base64(`${username}:${password}`));
}

/** Forgets the login (Sign Out). */
export function clearCredentials() {
  sessionStorage.removeItem(AUTH_KEY);
}

/** Whether this tab has a login saved. */
export function hasCredentials() {
  return sessionStorage.getItem(AUTH_KEY) !== null;
}

/** What to do when the server says "log in first" (401), e.g. show the sign-in screen. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/**
 * api("/racks") -> parsed JSON. Throws ApiError with the server's message.
 * @param {string} path  path after /api/v1
 */
export async function api(path, { method = "GET", body, query } = {}) {
  await backendReady();   // "Starting the Server" while a sleeping backend wakes (backend.js)
  const url = new URL(apiUrl(path));
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const headers = { Accept: "application/json" };
  const auth = sessionStorage.getItem(AUTH_KEY);
  if (auth) headers.Authorization = `Basic ${auth}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the backend. Is it running?", 0);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError("Please sign in again.", 401, data);
  }
  if (!res.ok) {
    const message = (data && (data.detail || data.message)) || `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status, data);
  }
  return data;
}
