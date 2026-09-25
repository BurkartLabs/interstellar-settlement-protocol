// server/routes/catalog.js: the catalog routes, split out of server/index.js (AB#1815).
import fs from "node:fs";
import path from "node:path";
import { ECONOMY } from "../economy.js";
import { getState, CEO_INSIGHT_LIBRARY, RESEARCH_LIBRARY, MISSION_AGENTS_DATA, REPUTATION_TIERS_DATA } from "../gameState.js";
import { APP_VERSION, __dirname } from "../app.js";
import { verifyAccessToken, getBearerToken } from "../auth.js";
import { checkAndResetNpcBuyOrders } from "../ticks.js";
import { sharedStateView } from "../realtime.js";

export function registerCatalogRoutes(app) {
  // TODO(AB#737): Consider moving API to a dedicated api.js file

  // AB#735: the container platform's health probe. Public, and says nothing but that the server is up: by the time it
  // listens, the world and the accounts have loaded (both are read before the module finishes). No version, path or
  // environment detail.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/bootstrap", (req, res) => {
    // Public, but a signed-in caller also gets their own older orders (Bug #425: the book is capped when read), and is
    // told which posts and listings are theirs. Nobody is sent an account id (Bugs #1134, #1145).
    const viewer = verifyAccessToken(getBearerToken(req)).accountId || null;
    // ISP-86: the extractor panel projects an hour's profit before the player starts a cycle, so it needs the
    // running-cost constants and what silicates fetch. Numbers only; the rule itself stays in server/economy.js.
    // AB#1736: what silicates fetch is the standing bid's *live* price, not its static base — ISP-87 drifts the
    // bid with the day's volume, and a rate advised against the base price can be a rate that loses money.
    checkAndResetNpcBuyOrders();
    const silicatesOrder = (getState().market?.npcBuyOrders || []).find((o) => o.item === "Silicates");
    const silicates = ECONOMY.npcBuyers.find((b) => b.item === "Silicates");
    res.json({
      ...sharedStateView(viewer),
      version: APP_VERSION,
      economy: {
        operations: ECONOMY.operations,
        salesTaxPct: ECONOMY.exchange.salesTaxPct,
        silicateUnitPrice: silicatesOrder ? Number(silicatesOrder.unitPrice) : (silicates ? silicates.unitPrice : 0),
        // AB#1430: the prices the panels quote (hire, payroll, construction, probes) come from here, not from copies
        // in the browser, so a balance change to data/economy.json reaches the page it is shown on.
        employees: ECONOMY.employees,
        buildings: ECONOMY.buildings,
        probes: ECONOMY.probes
      }
    });
  });

  app.get("/api/stations", (_req, res) => {
    try {
      const raw = fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8");
      // AB#718: the transfer rates ride with the stations, so the Logistics tab quotes what the server charges.
      res.json({ ...JSON.parse(raw), logistics: ECONOMY.logistics });
    } catch {
      res.status(500).json({ error: "Stations data unavailable." });
    }
  });

  // The CEO Insight catalogue, with each program's live or planned status: the client's only copy (Bug #983).
  app.get("/api/ceo-insight", (_req, res) => {
    res.json({ programs: Object.values(CEO_INSIGHT_LIBRARY) });
  });

  // AB#1051: the mission agent registry and reputation tiers, the client's only copy of either (the CEO Insight
  // pattern above). Bio, dialogue, station and availability are data; the agent's name, title and portrait stay
  // owned by ASSIGNED_COORDINATOR (public/scripts/liaison.js, AB#585) and are merged in client-side.
  app.get("/api/mission-agents", (_req, res) => {
    res.json({ agents: MISSION_AGENTS_DATA, reputationTiers: REPUTATION_TIERS_DATA });
  });

  // AB#1049: the research tree, the client's only copy (same pattern as /api/ceo-insight above).
  app.get("/api/research", (_req, res) => {
    res.json({ nodes: Object.values(RESEARCH_LIBRARY) });
  });

  app.get("/api/buildings", (_req, res) => {
    try {
      const raw = fs.readFileSync(path.join(__dirname, "..", "data", "buildings.json"), "utf8");
      res.json(JSON.parse(raw));
    } catch {
      res.status(500).json({ error: "Buildings data unavailable." });
    }
  });
}
