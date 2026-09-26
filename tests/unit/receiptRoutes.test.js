import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { CONSTRUCTIONS } from "../../server/construction.js";

// AB#744 (ISP-58): every committing action shows the confirmation modal from the server's answer. This lists the
// routes that commit something - every POST under /gameplay/ and on the exchange - and fails for any route that is
// neither mapped to its receipt here nor exempted with a reason, so a new action cannot ship without its modal.

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

/** Route -> the receipt builder its handler calls, and where the page shows the modal for it. */
const RECEIPTS = {
  // AB#743's six
  "/api/accounts/:accountId/gameplay/rent-office": { builder: "rentOfficeReceipt", client: ["public/scripts/views/station.js", "/gameplay/rent-office`"] },
  "/api/accounts/:accountId/gameplay/renew-office": { builder: "renewOfficeReceipt", client: ["public/scripts/views/station.js", "/gameplay/renew-office`"] },
  "/api/accounts/:accountId/gameplay/hire": { builder: "hireReceipt", client: ["public/scripts/views/station.js", "/gameplay/hire`"] },
  "/api/accounts/:accountId/gameplay/purchase-lease": { builder: "purchaseLeaseReceipt", client: ["public/scripts/views/station.js", "/gameplay/purchase-lease`"] },
  "/api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor": { builder: "buildExtractorReceipt", client: ["public/scripts/views/station.js", "/build-extractor`"] },
  "/api/accounts/:accountId/gameplay/lease/:leaseId/start-mining": { builder: "startMiningReceipt", client: ["public/scripts/views/station.js", "/start-mining`"] },
  // AB#744: the rest
  "/api/accounts/:accountId/gameplay/build-assembly-facility": { builder: "buildAssemblyReceipt", client: ["public/scripts/views/station.js", "onBuilt:"] },
  "/api/accounts/:accountId/gameplay/build-refinery": { builder: "buildRefineryReceipt", client: ["public/scripts/views/refinery.js", "/gameplay/build-refinery`"] },
  "/api/accounts/:accountId/gameplay/start-refinery": { builder: "startRefineryReceipt", client: ["public/scripts/views/refinery.js", "/gameplay/start-refinery`"] },
  "/api/accounts/:accountId/gameplay/build-mining-probe": { builder: "probeFabricationReceipt", client: ["public/scripts/views/station.js", "/gameplay/build-mining-probe`"] },
  "/api/accounts/:accountId/gameplay/scout-belt": { builder: "scoutBeltReceipt", client: ["public/scripts/views/starmap.js", "/gameplay/scout-belt`"] },
  "/api/accounts/:accountId/gameplay/launch-expedition": { builder: "launchExpeditionReceipt", client: ["public/scripts/views/starmap.js", "/gameplay/launch-expedition`"] },
  "/api/accounts/:accountId/gameplay/queue-rnd": { builder: "queueResearchReceipt", client: ["public/scripts/views/research.js", "/gameplay/queue-rnd`"] },
  "/api/accounts/:accountId/gameplay/queue-ceo": { builder: "queueInsightReceipt", client: ["public/scripts/views/ceoInsight.js", "/gameplay/queue-ceo`"] },
  "/api/market/orders": { builder: "listingReceipt", client: ["public/scripts/views/exchange.js", 'apiFetch("/api/market/orders"'] },
  "/api/market/orders/:orderId/buy": { builder: "buyReceipt", client: ["public/scripts/views/exchange.js", "/buy`"] },
  "/api/market/npc-orders/:orderId/sell": { builder: "sellToOrderReceipt", client: ["public/scripts/views/exchange.js", "/api/market/npc-orders/"] },
  "/api/accounts/:accountId/gameplay/transfer-resources": { builder: "transferReceipt", client: ["public/scripts/views/logistics.js", "/gameplay/transfer-resources`"] },
  "/api/accounts/:accountId/gameplay/travel": { builder: "travelReceipt", client: ["public/scripts/views/travel.js", "/gameplay/travel`"] },
  "/api/accounts/:accountId/gameplay/accept-mission": { builder: "acceptMissionReceipt", client: ["public/scripts/views/assignments.js", "/gameplay/accept-mission`"] },
  "/api/accounts/:accountId/gameplay/complete-mission": { builder: "completeMissionReceipt", client: ["public/scripts/views/assignments.js", "/gameplay/complete-mission`"] },
  // ISP-103 (AB#795): the upgrade control on an extractor yard
  "/api/accounts/:accountId/gameplay/buildings/:buildingId/upgrade": { builder: "upgradeReceipt", client: ["public/scripts/views/station.js", "upgradePath(appState.accountId"] }
};

/** Routes that commit nothing new: each undoes or stops something the player already has, and says why. */
const EXEMPT = {
  "/api/accounts/:accountId/gameplay/lease/:leaseId/stop-mining": "stops a running cycle (AB#1052); it has its own confirmation before it runs",
  "/api/market/orders/:orderId/cancel": "withdraws the player's own listing and returns the goods; nothing is bought or spent",
  "/api/accounts/:accountId/gameplay/abandon-mission": "gives a contract back; nothing is delivered, paid or charged"
};

/** ISP-94/95: the one build route answers with the receipt of whichever building it built; checked on its own below. */
const BUILD_ROUTE = "/api/accounts/:accountId/gameplay/build";

function committingRoutes() {
  const out = new Map();
  for (const file of readdirSync(new URL("server/routes/", ROOT)).filter((f) => f.endsWith(".js"))) {
    const src = read(`server/routes/${file}`);
    const re = /app\.post\(\s*"([^"]+)"/g;
    const starts = [...src.matchAll(re)];
    starts.forEach((m, i) => {
      const path = m[1];
      if (!path.includes("/gameplay/") && !path.startsWith("/api/market/")) return;
      out.set(path, { file, handler: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined) });
    });
  }
  return out;
}

describe("every committing action has its confirmation modal (AB#744)", () => {
  const routes = committingRoutes();

  it("finds the routes", () => {
    expect(routes.size).toBeGreaterThan(20);
  });

  it("each committing route is mapped to a receipt or exempted with a reason, never both, and no entry is stale", () => {
    const unaccounted = [...routes.keys()].filter((p) => !(p in RECEIPTS) && !(p in EXEMPT) && p !== BUILD_ROUTE);
    expect(unaccounted, "a committing route with no confirmation mapping").toEqual([]);
    expect(Object.keys(RECEIPTS).filter((p) => p in EXEMPT)).toEqual([]);
    expect([...Object.keys(RECEIPTS), ...Object.keys(EXEMPT)].filter((p) => !routes.has(p)), "an entry naming no route").toEqual([]);
  });

  it.each(Object.entries(RECEIPTS))("%s answers with the receipt its builder makes", (path, { builder }) => {
    const { handler } = routes.get(path);
    // ISP-94 (AB#784): a build route is the one build handler with its building fixed. Its receipt is that building's
    // construction's (server/construction.js), and the handler answers with it (buildHandler, server/routes/helpers.js).
    const building = handler.match(/buildHandler\(.*?buildingId: "([^"]+)"/)?.[1];
    if (building) {
      expect(CONSTRUCTIONS[building]?.receipt.toString(), path).toContain(builder); // vitest rewrites the call itself
      expect(read("server/routes/helpers.js"), path).toMatch(/res\.json\(\{[^;]*\breceipt\b/);
      return;
    }
    expect(handler, path).toContain(`${builder}(`);
    expect(handler, path).toMatch(/res\.json\(\{[^;]*\breceipt\b/);
  });

  it.each(Object.entries(RECEIPTS))("%s is shown in the modal by the page, after a successful answer", (path, { client: [file, fragment] }) => {
    const src = read(file);
    const at = src.indexOf(fragment);
    expect(at, `${file} calls ${fragment}`).toBeGreaterThanOrEqual(0);
    // The handler that makes the request: from the call to its catch or its closing, whichever is first.
    const rest = src.slice(at, at + 4000);
    const end = Math.min(...["} catch", "\n  });", "\n    },"].map((e) => rest.indexOf(e)).filter((i) => i > 0));
    expect(rest.slice(0, end), `${file}: showActionReceipt after ${fragment}`).toContain("showActionReceipt(");
  });

  it("the one build route answers with its building's receipt, and the construction panel shows it (ISP-94, ISP-95)", () => {
    expect(routes.has(BUILD_ROUTE)).toBe(true);
    for (const [id, construction] of Object.entries(CONSTRUCTIONS)) expect(typeof construction.receipt, id).toBe("function");
    expect(read("server/routes/helpers.js")).toMatch(/res\.json\(\{[^;]*\breceipt\b/);
    const station = read("public/scripts/views/station.js");
    const at = station.indexOf("renderConstructionPanel(document");
    expect(at, "station.js draws the construction panel").toBeGreaterThanOrEqual(0);
    const call = station.slice(at, station.indexOf("\n  });", at));
    expect(call.slice(call.indexOf("onBuilt:"), call.indexOf("onError:")), "showActionReceipt in the panel's onBuilt").toContain("showActionReceipt(");
  });

  it("the receipts module has a builder for every mapped route, and no builder nothing uses", () => {
    const receipts = read("server/receipts.js");
    const builders = [...receipts.matchAll(/export function (\w+Receipt)\(/g)].map((m) => m[1]);
    // ISP-96 (AB#786): a building added since ISP-94 is built through the one build route only, so its receipt
    // builder is used by its construction (server/construction.js) and by no mapped route.
    const byConstruction = builders.filter((b) => Object.values(CONSTRUCTIONS).some((c) => c.receipt.toString().includes(b)));
    const used = new Set([...Object.values(RECEIPTS).map((r) => r.builder), ...byConstruction]);
    expect(builders.filter((b) => !used.has(b)), "a builder nothing uses").toEqual([]);
    expect(Object.values(RECEIPTS).map((r) => r.builder).filter((b) => !builders.includes(b)), "a mapped builder the module lacks").toEqual([]);
  });
});
