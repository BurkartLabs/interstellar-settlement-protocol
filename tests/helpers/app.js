// Helper that imports the server app once per test file. Because
// tests/setup.js sets ISP_DISABLE_TICKERS=1, importing this won't spawn the
// 8 setInterval tickers.
//
// Each test file using this helper gets its own evaluation of server/index.js
// thanks to ESM caching at the URL level — repeated calls in the same file
// return the cached module.

let cached;

export async function getApp() {
  if (cached) return cached;
  const mod = await import("../../server/index.js");
  cached = mod;
  return cached;
}
