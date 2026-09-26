// Helper that imports the server app once per test file. Because
// tests/setup.js sets ISP_DISABLE_TICKERS=1, importing this won't spawn the
// 8 setInterval tickers.
//
// Each test file using this helper gets its own evaluation of server/index.js
// thanks to ESM caching at the URL level — repeated calls in the same file
// return the cached module.

import { beforeAll } from "vitest";

let cached;

// Bug #2051: most integration files call getApp() inside their first test, so the server import was charged to that
// test's timeout (5s by default) rather than a hook's. Under CPU load the import alone outlasted it, and the tests
// after it failed too while they waited on the same import. Importing this helper now boots the server in a beforeAll
// of the file's root suite, under hookTimeout; every later getApp() returns the cached module. Files that set
// process.env before the server loads do it at their top level, which runs before any hook.
beforeAll(() => getApp());

export async function getApp() {
  if (cached) return cached;
  const mod = await import("../../server/index.js");
  cached = mod;
  return cached;
}

/** The server module if this file has loaded it, without loading it: undefined before the helper's beforeAll has run. */
export function loadedApp() {
  return cached;
}

/** The address of the server the app module started (it always listens; tests/setup.js sets PORT=0, any free port). */
export async function serverUrl() {
  const { server } = await getApp();
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
