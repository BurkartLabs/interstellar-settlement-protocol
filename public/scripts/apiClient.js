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
// (re)connect, so a refreshed token is picked up; the page's own origin needs no CORS.
export const socket = typeof io !== "undefined"
  ? io({ auth: (cb) => cb({ token: appState.accessToken || localStorage.getItem(STORAGE_KEYS.accessToken) }) })
  : null;

/** Reconnect so the socket authenticates with the current token (after a refresh or a login on this page). */
export function reauthenticateSocket() {
  if (socket?.connected) socket.disconnect().connect();
}

export function persistSession() {
  if (appState.accountId) {
    localStorage.setItem(STORAGE_KEYS.accountId, appState.accountId);
  }

  if (appState.accessToken) {
    localStorage.setItem(STORAGE_KEYS.accessToken, appState.accessToken);
  }

  if (appState.refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, appState.refreshToken);
  }
}

export function clearSession() {
  appState.accountId = null;
  appState.accountEmail = null;
  appState.accessToken = null;
  appState.refreshToken = null;
  appState.inbox = { messages: [], folder: "inbox", subtype: "official", openMessageId: null, composeDraftId: null, loaded: false };
  localStorage.removeItem(STORAGE_KEYS.accountId);
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
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
  appState.accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
  appState.refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
}

export async function refreshSessionToken() {
  if (!appState.refreshToken) {
    handleSessionExpired();
    return false;
  }

  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: appState.refreshToken })
  });

  if (!response.ok) {
    handleSessionExpired();
    return false;
  }

  const payload = await response.json();
  appState.accessToken = payload.accessToken;
  appState.refreshToken = payload.refreshToken;
  if (payload.account?.id) {
    appState.accountId = payload.account.id;
  }
  persistSession();
  // A socket that connected with the expired token is unauthenticated, and its chat would be dropped (Bug #710).
  reauthenticateSocket();
  return true;
}

export async function apiFetch(url, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (appState.accessToken) {
    headers.set("Authorization", `Bearer ${appState.accessToken}`);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && allowRetry) {
    if (appState.refreshToken) {
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

    throw new Error(payload.error || "Request failed.");
  }

  return response.json();
}
