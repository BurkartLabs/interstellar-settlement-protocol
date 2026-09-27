import "./loadEnv.js";
// ISP-196 (AB#890): the conglomerate catalog is checked here, before anything listens; a bad one stops the start.
import "./conglomerates.js";
import express from "express";
import kanbanRouter from "./kanban.js";
import fs from "node:fs";
import path from "node:path";
import { accountActionLimiter } from "./rateLimiters.js";
import { saveAccountsNow, getAccountById, getState, CEO_INSIGHT_LIBRARY, REFINERY_CHAINS, RESEARCH_LIBRARY, MISSION_TEMPLATES, SALVAGE_ASSIGNMENT_ID, SYSTEMS_BY_ID } from "./gameState.js";
import { BELT_KEYS, EXPEDITION_DURATIONS } from "./gameState.js";
// AB#731: every gameplay route's numbers and ids are checked against server/gameplayInput.js here, after the login and
// ownership checks and before any handler, so a refused request has touched nothing. Imported beside its one use.
import { gameplayInputMiddleware, ACCOUNT_INPUT, MARKET_INPUT, FORUM_INPUT } from "./gameplayInput.js";
import { FORUM_CATEGORIES } from "./gameState.js";
import { app, __dirname, DEV_SURFACE, server, io } from "./app.js";
import { requireAuth, requireAccountAccess, verifyAccessToken, getBearerToken } from "./auth.js";
import { STATION_REGISTRY, SYSTEMS_CATALOG } from "./travel.js";
import { beltTick, checkAndResetNpcBuyOrders, miningTick, refineryTick, asteroidExpeditionTick, fabricationTick, travelTick, processRndCompletions, processCeoInsightCompletions, financialSnapshotTick, FINANCIAL_SNAPSHOT_INTERVAL_MS, shipmentTick } from "./ticks.js";
import { registerRealtime } from "./realtime.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerCorporationRoutes } from "./routes/corporation.js";
import { registerLoanRoutes } from "./routes/loans.js"; // ISP-149 (AB#843)
import { loanServicingTick } from "./loanServicing.js"; // ISP-150 (AB#844)
import { registerBondRoutes } from "./routes/bonds.js"; // ISP-154 (AB#848)
import { bondWindowTick } from "./bonds.js";
import { bondServicingTick } from "./bondServicing.js"; // ISP-155 (AB#849)
import { registerCreditRatingRoutes } from "./routes/creditRating.js"; // ISP-148 (AB#842)
import { registerConglomerateRoutes } from "./routes/conglomerates.js"; // ISP-197 (AB#891)
import { registerLogisticsRoutes } from "./routes/logistics.js";
import { registerMiningRoutes } from "./routes/mining.js";
import { registerAsteroidRoutes } from "./routes/asteroids.js";
import { registerShipyardRoutes } from "./routes/shipyard.js"; // ISP-171 (AB#865)
import { SHIP_IDS } from "./shipyard.js";
import { registerTrainingRoutes } from "./routes/training.js"; // ISP-172 (AB#866)
import { TROOP_IDS } from "./training.js";
import { registerFleetRoutes } from "./routes/fleets.js"; // ISP-174 (AB#868)
import { registerRefiningRoutes } from "./routes/refining.js";
import { registerConstructionRoutes } from "./routes/construction.js"; // ISP-94 (AB#784)
import { registerUpgradeRoutes } from "./routes/upgrades.js"; // ISP-101 (AB#793)
import { PLAYER_BUILDING_CATALOGUE } from "./playerBuildings.js";
import { registerMissionRoutes } from "./routes/missions.js";
import { registerResearchRoutes } from "./routes/research.js";
import { registerMessagingRoutes } from "./routes/messaging.js";
import { registerConversationRoutes } from "./routes/conversations.js"; // AB#910
import { migrateLegacyMailOnce } from "./game/conversations.js"; // AB#911
import { registerForumRoutes } from "./routes/forums.js";
import { registerMarketRoutes } from "./routes/market.js";

process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "public")));
// ISP-70 (AB#759): the style guide's static pages without their .html, so the token specimen is /styleguide/tokens.
// Static files, like the rest of public/: no route, no game data.
app.use("/styleguide", express.static(path.join(__dirname, "..", "public", "styleguide"), { extensions: ["html"] }));
// Serve /kanban as the Kanban board root, defaulting to kanban.html. A developer tool: its API writes any request body
// to disk, so it exists only on the dev surface (Bug #1069).
if (DEV_SURFACE) {
  app.use("/kanban", (req, res, next) => {
    if (req.path === "/" || req.path === "") {
      res.sendFile(path.join(__dirname, "..", "kanban", "kanban.html"));
    } else {
      express.static(path.join(__dirname, "..", "kanban"))(req, res, next);
    }
  });
  app.use("/kanban", kanbanRouter);
}

// Check on startup and every minute thereafter
checkAndResetNpcBuyOrders();
if (!process.env.ISP_DISABLE_TICKERS) setInterval(checkAndResetNpcBuyOrders, 60_000);

if (!process.env.ISP_DISABLE_TICKERS) setInterval(miningTick, 5000); // Every 5 seconds

if (!process.env.ISP_DISABLE_TICKERS) setInterval(refineryTick, 10_000); // Every 10 seconds

if (!process.env.ISP_DISABLE_TICKERS) setInterval(asteroidExpeditionTick, 10_000); // Every 10 seconds

if (!process.env.ISP_DISABLE_TICKERS) setInterval(fabricationTick, 5_000); // Every 5 seconds

if (!process.env.ISP_DISABLE_TICKERS) setInterval(travelTick, 5000); // Every 5 seconds

if (!process.env.ISP_DISABLE_TICKERS) setInterval(processRndCompletions, 5_000);

if (!process.env.ISP_DISABLE_TICKERS) setInterval(processCeoInsightCompletions, 5_000);

if (!process.env.ISP_DISABLE_TICKERS) {
  setInterval(financialSnapshotTick, FINANCIAL_SNAPSHOT_INTERVAL_MS);
}

registerCatalogRoutes(app);

registerAuthRoutes(app);
// AB#987: email verification's routes, imported beside their one caller (P-SHARED-LINE).
import { registerVerificationRoutes } from "./routes/verification.js";
registerVerificationRoutes(app);
// AB#988: password reset's routes.
import { registerPasswordResetRoutes } from "./routes/passwordReset.js";
import { PRICE_HISTORY_ITEMS } from "./priceHistory.js"; // ISP-130 (AB#824): what the exchange may name
registerPasswordResetRoutes(app);

// AB#734 (ISP-48): the per-account throttle runs right after requireAuth sets req.auth, so it always has the
// verified account to key on.
app.use("/api/accounts/:accountId", requireAuth, requireAccountAccess, accountActionLimiter);
const INPUT_CHECKS = {
  catalogs: {
    stations: new Set(Object.keys(STATION_REGISTRY)),
    systems: new Set(SYSTEMS_BY_ID.keys()),
    leaseBodies: new Set(SYSTEMS_CATALOG.flatMap((s) => (s.bodies || []).filter((b) => Number(b.leaseCost) > 0).flatMap((b) => [b.name, b.id])).map((x) => String(x).toLowerCase())),
    techs: new Set(Object.keys(RESEARCH_LIBRARY)),
    programs: new Set(Object.keys(CEO_INSIGHT_LIBRARY)),
    // ISP-297 (AB#1789): the Salvage Assignment is not one of MISSION_TEMPLATES' static ids — it is materialized
    // from ECONOMY.salvage when a corporation is eligible — so it is added to the catalog by hand.
    missions: new Set([...MISSION_TEMPLATES.map((m) => m.id), SALVAGE_ASSIGNMENT_ID]),
    belts: new Set(BELT_KEYS),
    expeditionDurations: new Set(Object.keys(EXPEDITION_DURATIONS)),
    refineryChains: new Set(Object.keys(REFINERY_CHAINS)),
    playerBuildings: new Set(PLAYER_BUILDING_CATALOGUE.map((b) => b.id)), // ISP-94: POST /gameplay/build
    ships: new Set(SHIP_IDS), // ISP-171 (AB#865): POST /gameplay/shipyard/queue
    troops: new Set(TROOP_IDS), // ISP-172 (AB#866): POST /gameplay/training/queue
    // AB#732: what can be listed or charted (every raw resource and refinery output), standing orders, forum categories.
    // ISP-130 (AB#824): the price history's set, which the server holds to data/items.json at load: one list, not two.
    tradeItems: PRICE_HISTORY_ITEMS,
    npcOrders: { has: (orderId) => (getState().market?.npcBuyOrders || []).some((o) => o.id === orderId) },
    forumCategories: new Set(FORUM_CATEGORIES)
  },
  stationNames: Object.fromEntries(Object.entries(STATION_REGISTRY).map(([sid, st]) => [sid, st.name])),
  corpOf: (accountId) => getAccountById(accountId)?.state?.corp
};
app.use("/api/accounts/:accountId/gameplay", gameplayInputMiddleware(INPUT_CHECKS));
// AB#732: the same checks for the caller's account and mail routes, and for the market and forum routes, whose login
// is checked per route: there the caller comes from a verified token, and a request without one is left to that check.
const callerFromToken = (req) => verifyAccessToken(getBearerToken(req)).accountId || null;
app.use("/api/accounts/:accountId", gameplayInputMiddleware({ ...INPUT_CHECKS, routes: ACCOUNT_INPUT }));
app.use("/api/market", gameplayInputMiddleware({ ...INPUT_CHECKS, routes: MARKET_INPUT, callerOf: callerFromToken }));
app.use("/api/forums", gameplayInputMiddleware({ ...INPUT_CHECKS, routes: FORUM_INPUT, callerOf: callerFromToken }));

registerAccountRoutes(app);

registerCorporationRoutes(app);
registerLoanRoutes(app);
registerBondRoutes(app);
registerCreditRatingRoutes(app);
registerConglomerateRoutes(app);

registerLogisticsRoutes(app);

if (!process.env.ISP_DISABLE_TICKERS) setInterval(shipmentTick, 5000); // Every 5 seconds
// AB#2329: an empty belt slot draws on the hour; checked every minute, so a draw is at most a minute late.
if (!process.env.ISP_DISABLE_TICKERS) setInterval(beltTick, 60_000);
// ISP-150 (AB#844): loans' daily payments, arrears and penalty interest; a day due is collected within a minute
if (!process.env.ISP_DISABLE_TICKERS) setInterval(() => loanServicingTick(Date.now()), 60_000);
if (!process.env.ISP_DISABLE_TICKERS) setInterval(() => bondWindowTick(Date.now()), 60_000); // ISP-154 (AB#848)
if (!process.env.ISP_DISABLE_TICKERS) setInterval(() => bondServicingTick(Date.now()), 60_000); // ISP-155 (AB#849)

registerMiningRoutes(app);

registerAsteroidRoutes(app);
registerShipyardRoutes(app);
registerTrainingRoutes(app);
registerFleetRoutes(app);

registerRefiningRoutes(app);

registerConstructionRoutes(app);
registerUpgradeRoutes(app);

registerMissionRoutes(app);

registerResearchRoutes(app);

registerMessagingRoutes(app);
registerConversationRoutes(app);
// AB#911: the Inbox's Players tab reads conversations, so older player mail is copied into them once, at startup.
try {
  const migrated = migrateLegacyMailOnce();
  if (migrated) console.log(`[conversations] old player mail copied: ${migrated.written} written, ${migrated.alreadyPresent} already there, ${migrated.skippedMissingAccount} skipped`);
} catch (error) {
  console.error("[conversations] the old player mail was not copied; run scripts/migrate-mail.mjs:", error?.message || error);
}

registerForumRoutes(app);

registerMarketRoutes(app);

// Bug #1123: a request the server cannot read is the client's mistake, not a server fault. express.json() and the
// router hand these on with a 4xx status (a body that is not JSON, too large, in a charset or content encoding it does
// not take, or a path that does not decode); they are answered with that status and fixed text, never the parser's
// message, the body or a stack. They reach here before any route runs, so nothing has changed. Everything else is 500.
const CLIENT_ERROR_TEXT = {
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.too.large": "The request body is too large.",
  "charset.unsupported": "The request body must be UTF-8.",
  "encoding.unsupported": "The request body's content encoding is not supported."
};

// AB#753: a path nothing answers is a 404 from here, not Express's default, which clears every header already set
// (the content security policy, frame-ancestors, the referrer policy) and writes only its own. Same status, and the
// same shape as every other refusal.
app.use((_req, res) => {
  res.status(404).json({ error: "This request could not be processed: nothing is at that address." });
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.status ?? error?.statusCode);
  if (error?.expose !== false && status >= 400 && status < 500) {
    console.warn(`[http] rejected request: ${status} ${error?.type || "client error"}`);
    res.status(status).json({ error: CLIENT_ERROR_TEXT[error?.type] || "The request could not be read." });
    return;
  }
  console.error("[http] unhandled route error", error);
  res.status(500).json({ error: "Internal server error." });
});

registerRealtime();

// Bug #578: the server is one long-lived process and always listens: socket.io, the tickers and the data directory all
// depend on it (Decision #591). PORT=0 takes any free port, which is what the test process uses.
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ISP server listening on port ${server.address().port}`);
});

// Save everything before exiting on a graceful stop: Ctrl+C, node --watch, or the container platform's SIGTERM when it
// replaces a revision (Bug #1153).
async function onShutdown() {
  await saveAccountsNow();
  process.exit(0);
}
process.on("SIGTERM", onShutdown);
process.on("SIGINT", onShutdown);

export default app;
export { app, server, io };
export {
  beltTick,
  miningTick,
  refineryTick,
  asteroidExpeditionTick,
  fabricationTick,
  travelTick,
  shipmentTick,
  processRndCompletions,
  processCeoInsightCompletions,
  checkAndResetNpcBuyOrders,
  financialSnapshotTick
};
