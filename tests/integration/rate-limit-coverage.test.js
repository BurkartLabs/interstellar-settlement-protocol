// AB#958 (ISP-262): every mutating route the app registers is behind a rate limit. The route list is the app's own,
// walked the way tests/integration/route-auth.test.js walks it, so a route added tomorrow is in it; each group's
// per-address limit is set to one here (before server/index.js is imported: this file gets its own module instance,
// tests/helpers/app.js), and every route, from an address of its own, must answer 429 by its second request. A route
// that nothing limits answers whatever its handler says, twice, and fails this.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { MUTATION_GROUPS, groupEnvName, groupOf } from "../../server/rateLimitConfig.js";

for (const g of MUTATION_GROUPS) process.env[groupEnvName(g.name, "address")] = "1";

let app;
beforeAll(async () => {
  ({ app } = await import("../../server/index.js"));
});

function routes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods).map((m) => ({ method: m.toUpperCase(), path: prefix + layer.route.path }));
    }
    if (layer.name === "router" && layer.handle?.stack) {
      const mount = (layer.regexp.source.match(/^\^\\\/([^\\?]+)/) || [])[1];
      return routes(layer.handle.stack, mount ? `${prefix}/${mount.replace(/\\\//g, "/")}` : prefix);
    }
    return [];
  });
}

describe("every mutating route is rate-limited (AB#958)", () => {
  it("answers 429 by the second request from one address, on every POST, PUT, PATCH and DELETE route", async () => {
    const mutating = routes(app._router.stack).filter((r) => ["POST", "PUT", "PATCH", "DELETE"].includes(r.method));
    expect(mutating.length).toBeGreaterThan(100); // the walk found the app, not an empty stack
    const unlimited = [];
    let i = 0;
    for (const r of mutating) {
      i += 1;
      const address = `10.58.${Math.floor(i / 250)}.${(i % 250) + 1}`;
      const url = r.path.replace(/:[A-Za-z]+/g, "x1");
      const statuses = [];
      for (let n = 0; n < 2; n++) {
        statuses.push((await request(app)[r.method.toLowerCase()](url).set("X-Forwarded-For", address).send({})).status);
      }
      if (!statuses.includes(429)) unlimited.push(`${r.method} ${r.path} (${groupOf(r.path)}): ${statuses.join(", ")}`);
    }
    expect(unlimited).toEqual([]);
  }, 120_000);

  it("names a group for every path, the default one for a path no group names", () => {
    const names = MUTATION_GROUPS.map((g) => g.name);
    for (const r of routes(app._router.stack)) expect(names).toContain(groupOf(r.path));
    expect(groupOf("/api/some-new-thing")).toBe("default");
  });
});
