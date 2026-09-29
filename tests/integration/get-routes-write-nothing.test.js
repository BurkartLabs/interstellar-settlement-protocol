import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { getApp } from "../helpers/app.js";
import request from "supertest";
import { registerAccount } from "../helpers/api.js";
import * as store from "../../server/game/store.js";

// ISP-267 (AB#963): no GET route writes to the store. Every GET route the app registers is called, as a signed-in
// corporation, under a write-counting wrapper: a debounced write it scheduled (the accounts snapshot's or the world
// state's timer) or a synchronous write it made (fs.writeFileSync) is a write. Before Bug #4815's fix every account
// read scheduled a full snapshot write, so under load the whole store was rewritten about once a second.

/** Every GET route's path, from the app's router (Express 4). */
function getRoutes(app) {
  const paths = [];
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route?.methods?.get && typeof layer.route.path === "string") paths.push(layer.route.path);
      else if (layer.route?.methods?.get && Array.isArray(layer.route.path)) paths.push(...layer.route.path.filter((p) => typeof p === "string"));
      else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk(app._router?.stack);
  return [...new Set(paths)];
}

/** A path with real values for the parameters a signed-in corporation's own requests carry, and a stand-in for the rest. */
function fill(route, account) {
  const known = {
    accountId: account.id, systemId: "sol", stationId: "earth-station-prime", beltKey: "sol:asteroid-belt",
    corpId: account.state?.corp?.publicId || "x", item: "Silicates", channel: "global"
  };
  return route.replace(/:(\w+)\??/g, (_, name) => encodeURIComponent(known[name] ?? "x"));
}

afterEach(() => vi.restoreAllMocks());

describe("no GET route writes to the store (ISP-267, AB#963)", () => {
  it("every GET route, called as a signed-in corporation, schedules no write and writes no file", async () => {
    const { app } = await getApp();
    const { account, accessToken } = await registerAccount(app);
    const routes = getRoutes(app);
    expect(routes.length).toBeGreaterThan(50); // the enumeration found the app's routes
    const direct = vi.spyOn(fs, "writeFileSync");
    const writers = [];
    for (const route of routes) {
      store.writeAccountsSnapshotToDiskNow(); // start each request with nothing pending
      store.saveStateNow();
      direct.mockClear();
      const url = fill(route, account);
      const res = await request(app).get(url).set("Authorization", `Bearer ${accessToken}`);
      const scheduled = [store._diskSnapshotTimer ? "accounts snapshot" : null, store.saveTimer ? "world state" : null].filter(Boolean);
      const files = direct.mock.calls.map((c) => String(c[0]).replace(/\\/g, "/").replace(/^.*\//, ""));
      if (scheduled.length || files.length) writers.push(`GET ${route} (${res.status}): ${[...scheduled, ...files].join(", ")}`);
    }
    expect(writers, `GET routes that wrote:\n${writers.join("\n")}`).toEqual([]);
  }, 120_000);

  it("a dominance reading a read computed is written by the next tick, once, with the day's control", async () => {
    const { app } = await getApp();
    const { dominanceTick } = await import("../../server/dominanceService.js");
    const direct = vi.spyOn(fs, "writeFileSync");
    const read = await request(app).get("/api/starmap/dominance"); // computed now, or by the test above: in memory either way
    expect(read.status).toBe(200);
    expect(direct.mock.calls.filter((c) => String(c[0]).includes("dominance.json"))).toEqual([]);
    expect(dominanceTick(Date.now())).toBe("persisted");
    expect(direct.mock.calls.some((c) => String(c[0]).includes("dominance.json"))).toBe(true);
    expect(direct.mock.calls.some((c) => String(c[0]).includes("control-history.json"))).toBe(true);
    expect(dominanceTick(Date.now())).toBe("cached");
  });
});
