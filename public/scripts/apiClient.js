// AB#738 (ISP-52): the session, the authenticated fetch and the socket, moved out of app.js.
import { appState, STORAGE_KEYS, LOGIN_PAGE_PATH } from "./state.js";

// An expired session tears down the game screen, which app.js owns; app.js hands those two over at load
// (connectApiClient) rather than this module importing the entry point back.
let appHooks = null;
export function connectApiClient(hooks) {
  appHooks = hooks;
}
function stopMiningUiTicker() {
  appHooks.stopMiningUiTicker();
}
function showAuthScreen() {
  appHooks.showAuthScreen();
}

// Bug #710: the socket carries the access token, so the server knows who is chatting. The callback runs on every
// (re)connect, so a refreshed token is picked up; the page's own origin needs no CORS. AB#757: the token is the one
// in memory; until the page has refreshed from its cookie the socket is anonymous, and the refresh reconnects it.
// Bug AB#2154: the token each (re)connect was made with. The auth callback runs when the CONNECT is sent, not when the
// server answers it.
let connectedWith = null;
// Bug #4840: null until the game opens. The logged-out landing never loads the socket.io client (37 KB) or connects,
// so connectSocket() is called only once boot knows it is entering the game. An `export let`: importers see it appear.
export let socket = null;
let socketReady = null;

function openSocket() {
  if (typeof io === "undefined") return null;
  socket = io({ auth: (cb) => { connectedWith = appState.accessToken ?? null; cb({ token: appState.accessToken }); } });
  // Bug AB#2154: a page loads, its socket sends CONNECT with no token (none until the page refreshes from its cookie),
  // and the refresh can finish before the server answers. reauthenticateSocket() then finds the socket not yet
  // connected and does nothing, and it connects anonymously: outside the account's room, so no mining:updated ever
  // arrives and the lease view's "Mined this cycle" stays at 0. Whenever the socket connects with a token that is no
  // longer current, it reconnects with the current one, whichever way the race went.
  socket.on("connect", () => {
    if (connectedWith !== (appState.accessToken ?? null)) socket.disconnect().connect();
  });
  return socket;
}

/** Load the socket.io client if it is not on the page yet, then connect, once; resolves to the socket (null if it cannot load). */
export function connectSocket() {
  socketReady ??= typeof io !== "undefined" || typeof document === "undefined"
    ? Promise.resolve(openSocket())
    : new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "/socket.io/socket.io.js";
      script.onload = () => resolve(openSocket());
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
  return socketReady;
}

/** Reconnect so the socket authenticates with the current token (after a refresh or a login on this page). */
export function reauthenticateSocket() {
  if (socket?.connected) socket.disconnect().connect();
}

// AB#757 (D-0.5-2): no token is ever written to storage. The refresh token is an HttpOnly cookie the page cannot
// read, and the access token lives in appState only; only the account id, which is not a credential, is kept.
export function persistSession() {
  if (appState.accountId) {
    localStorage.setItem(STORAGE_KEYS.accountId, appState.accountId);
  }
}

// Where tokens were kept before AB#757. Removed on every load, so a player who last signed in on an older build
// does not keep a readable 30-day refresh token in this origin's storage.
const LEGACY_TOKEN_KEYS = ["isp.accessToken", "isp.refreshToken"];
function forgetLegacyTokens() {
  for (const key of LEGACY_TOKEN_KEYS) localStorage.removeItem(key);
}

export function clearSession() {
  clearTimeout(renewal);
  appState.accountId = null;
  appState.accountEmail = null;
  appState.accessToken = null;
  appState.inbox = { messages: [], folder: "inbox", subtype: "official", openMessageId: null, composeDraftId: null, loaded: false };
  localStorage.removeItem(STORAGE_KEYS.accountId);
  forgetLegacyTokens();
}

let _sessionExpiredHandled = false;
export function redirectToLoginPage(reason = "expired") {
  const loginUrl = new URL(LOGIN_PAGE_PATH, window.location.origin);
  if (reason) {
    loginUrl.searchParams.set("reason", reason);
  }
  window.location.replace(`${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`);
}

export function handleSessionExpired(reason = "expired") {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;
  clearSession();
  appState.authenticated = false;
  appState.data = null;
  appState.profileMode = null;
  stopMiningUiTicker();
  showAuthScreen();
  redirectToLoginPage(reason);
  setTimeout(() => {
    _sessionExpiredHandled = false;
  }, 1000);
}

export function createInvalidSessionError(message) {
  const error = new Error(message || "Session is invalid.");
  error.code = "AUTH_SESSION_INVALID";
  return error;
}

export function hydrateSession() {
  appState.accountId = localStorage.getItem(STORAGE_KEYS.accountId);
  appState.accessToken = null;
  forgetLegacyTokens();
}

// One refresh at a time: each refresh rotates the cookie, so two in flight would present the same token twice and
// the loser, finding it revoked, would sign the player out.
let refreshing = null;

// Bug #2300: the cookie is shared by every tab, so one at a time must hold across tabs too; two tabs whose sockets
// were told "auth:expired" by the same tick refresh in the same instant. The lock makes the second tab wait and then
// present the cookie the first one's answer rotated to. Without Web Locks, only this page's refreshes are serialized.
function acrossTabs(work) {
  return globalThis.navigator?.locks ? navigator.locks.request("isp-refresh", work) : work();
}

// AB#2294: the access token lives 30 minutes. A socket that holds an expired one is told "auth:expired" only when the
// server next has something for it, and that event, or a chat message the player sends then, is lost while the page
// refreshes; so the page renews two minutes early. The token's life is read against the server's own clock (the
// answer's Date header), not this device's, which may be off by more than the whole lifetime.
const RENEW_EARLY_MS = 2 * 60 * 1000;
const RENEW_AT_LEAST_MS = 30 * 1000;
let renewal = null;

function scheduleRenewal(response, payload) {
  clearTimeout(renewal);
  const expiresAt = Number(payload.accessTokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return;
  const serverNow = Date.parse(response.headers.get("Date") || "") || Date.now();
  const delay = Math.max(RENEW_AT_LEAST_MS, expiresAt - serverNow - RENEW_EARLY_MS);
  renewal = setTimeout(() => { if (appState.accountId) refreshSessionToken(); }, Math.min(delay, 2 ** 31 - 1));
}

/** Exchange the refresh cookie for a new access token (AB#757). A page load starts here; so does any 401. */
export function refreshSessionToken() {
  refreshing ??= (async () => {
    try {
      const response = await acrossTabs(() => fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }));
      if (!response.ok) {
        handleSessionExpired();
        return false;
      }

      const payload = await response.json();
      appState.accessToken = payload.accessToken;
      scheduleRenewal(response, payload);
      if (payload.account?.id) {
        appState.accountId = payload.account.id;
      }
      persistSession();
      // A socket that connected with the expired token is unauthenticated, and its chat would be dropped (Bug #710).
      reauthenticateSocket();
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function apiFetch(url, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (appState.accessToken) {
    headers.set("Authorization", `Bearer ${appState.accessToken}`);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && allowRetry) {
    if (appState.accountId) {
      const refreshed = await refreshSessionToken();
      if (refreshed) {
        return apiFetch(url, options, false);
      }
    } else if (appState.authenticated) {
      handleSessionExpired();
    }
  }

  return response;
}

export async function parseJsonResponse(response) {
  if (!response.ok) {
    const fallback = { error: "Request failed." };
    let payload = fallback;
    try {
      payload = await response.json();
    } catch {
      payload = fallback;
    }

    // ISP-254 (AB#4811): the refusal's own code and status ride on the error, so a screen can tell an unfunded
    // request from any other refusal (public/scripts/protocol.js) without reading the words
    const error = new Error(payload.error || "Request failed.");
    if (typeof payload.code === "string") error.code = payload.code;
    error.status = response.status;
    throw error;
  }

  return response.json();
}
