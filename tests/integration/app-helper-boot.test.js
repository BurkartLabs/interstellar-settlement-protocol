import { describe, it, expect } from "vitest";
import { loadedApp } from "../helpers/app.js";

// Bug #2051: a file that imports tests/helpers/app.js has the server loaded by the helper's beforeAll, under
// hookTimeout, before its first test runs. Most files call getApp() inside their first test, which charged the server
// import to that test's timeout, and under CPU load the import alone outlasted it. This file never calls getApp().
describe("tests/helpers/app.js", () => {
  it("has the server loaded before the file's first test runs", () => {
    const mod = loadedApp();
    expect(mod, "the server module").toBeDefined();
    expect(mod.server, "the server the module started").toBeDefined();
  });
});
