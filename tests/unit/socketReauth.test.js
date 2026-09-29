// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";

// Bug AB#2154: a page's socket sends CONNECT before the page has a token, and the token refresh can finish before the
// server answers. The socket then connected anonymously, outside its account's room, and the lease view's "Mined this
// cycle" never moved. A socket that connects with a token no longer current reconnects. (e2e/socket-reauth.spec.js
// forces the race in a real page.)

/** A socket.io client socket as far as apiClient.js uses it: connect runs the auth callback, as the real one does. */
function fakeIo() {
  const handlers = new Map();
  const sock = {
    connected: false,
    sentTokens: [],
    reconnects: 0,
    auth: null,
    on(ev, fn) { handlers.set(ev, [...(handlers.get(ev) || []), fn]); return sock; },
    send() { sock.auth((data) => sock.sentTokens.push(data.token ?? null)); }, // the CONNECT packet leaves
    ack() { sock.connected = true; for (const fn of handlers.get("connect") || []) fn(); }, // the server answers it
    disconnect() { sock.connected = false; return sock; },
    connect() { sock.reconnects += 1; sock.send(); return sock; },
  };
  return { io: (opts) => { sock.auth = opts.auth; return sock; }, sock };
}

let api, state, sock;
beforeAll(async () => {
  const fake = fakeIo();
  sock = fake.sock;
  vi.stubGlobal("io", fake.io);
  state = await import("../../public/scripts/state.js");
  api = await import("../../public/scripts/apiClient.js");
});

describe("the socket always ends up on the page's current token (Bug AB#2154)", () => {
  it("a refresh that finishes before the server answers the anonymous CONNECT reconnects once it connects", () => {
    state.appState.accessToken = null;
    sock.send(); // page load: CONNECT with no token
    state.appState.accessToken = "token-1"; // the refresh finishes first
    api.reauthenticateSocket(); // not connected yet: nothing it can do
    expect(sock.reconnects).toBe(0);
    sock.ack(); // the anonymous CONNECT is answered
    expect(sock.reconnects).toBe(1); // and it reconnects at once
    expect(sock.sentTokens.at(-1)).toBe("token-1");
    sock.ack(); // the new CONNECT is answered with the current token: settled
    expect(sock.reconnects).toBe(1);
  });

  it("a socket already on the current token does not reconnect when it connects", () => {
    const before = sock.reconnects;
    sock.connected = false;
    sock.send(); // CONNECT sent with token-1, still current
    sock.ack();
    expect(sock.reconnects).toBe(before);
  });

  it("a refresh after the socket has connected reconnects it with the new token, as before", () => {
    const before = sock.reconnects;
    state.appState.accessToken = "token-2";
    api.reauthenticateSocket();
    expect(sock.reconnects).toBe(before + 1);
    expect(sock.sentTokens.at(-1)).toBe("token-2");
    sock.ack();
    expect(sock.reconnects).toBe(before + 1);
  });
});
