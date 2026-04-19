import express from "express";
import kanbanRouter from "./kanban.js";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import {
  accountExists,
  addAccountNotification,
  appendChatMessage,
  createAccount,
  saveAccountsNow,
  createCombatReport,
  authenticateAccount,
  getAccountById,
  getDummyAccount,
  getAllAccountIds,
  getState,
  hasRefreshToken,
  listAccountNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markWalkthroughCompleted,
  revokeRefreshToken,
  resetDummyAccountProgress,
  resetWalkthroughCompletion,
  storeRefreshToken,
  mutateAccountState,
  mutateState,
  listAccountMessages,
  markMessageRead,
  moveMessage,
  sendPlayerMessage,
  saveDraft,
  deleteDraft,
  addSystemMessageToAccount,
  flushPendingPersist,
  rehydrateFromSupabase,
  getEffectiveExchangeTaxRate,
  CEO_INSIGHT_LIBRARY,
  applyRefineryOperations,
  REFINERY_CHAINS,
  MISSION_TEMPLATES,
  refreshContractOfferings,
  SYSTEM_DETAILS
} from "./gameState.js";

const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV !== "production";

const RESEARCH_LIBRARY = {
  "tt-basic-extraction": {
    id: "tt-basic-extraction",
    name: "Basic Extraction Analytics",
    effect: "+10% raw extraction throughput",
    durationHours: 2,
    costCredits: 2000,
    prereqs: [],
    tier: 1
  },
  "tt-industrial-safety": {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 2000,
    prereqs: ["tt-basic-extraction"],
    tier: 1
  },
  "tt-supply-forecast": {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "-6% extractor build cost, +6% mining yield",
    durationHours: 4,
    costCredits: 3000,
    prereqs: ["tt-basic-extraction"],
    tier: 1
  },
  "tt-energy-routing": {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 4000,
    prereqs: ["tt-industrial-safety", "tt-supply-forecast"],
    tier: 2
  },
  "tt-material-compression": {
    id: "tt-material-compression",
    name: "Material Compression I",
    effect: "+8% refining throughput",
    durationHours: 9,
    costCredits: 6000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  "tt-nano-lattice": {
    id: "tt-nano-lattice",
    name: "Nano-Lattice Weaving",
    effect: "Unlocks Aerogel and Quantum Insulator refinery chains",
    durationHours: 12,
    costCredits: 8000,
    prereqs: ["tt-material-compression"],
    tier: 3
  },
  "tt-containment-physics": {
    id: "tt-containment-physics",
    name: "Containment Physics I",
    effect: "Unlocks Helium-3 refinery chain",
    durationHours: 10,
    costCredits: 8000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  "tt-exotic-energy-routing": {
    id: "tt-exotic-energy-routing",
    name: "Exotic Energy Routing",
    effect: "Unlocks Dark-Matter Capacitor synthesis",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-containment-physics"],
    tier: 3
  },
  "tt-fleet-coordination": {
    id: "tt-fleet-coordination",
    name: "Fleet Coordination Matrix",
    effect: "+12 fleet cap",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  "tt-proxima-navigation": {
    id: "tt-proxima-navigation",
    name: "Near-Star Navigation Array",
    effect: "Enables travel to Alpha Centauri and Barnard's Star",
    durationHours: 8,
    costCredits: 10000,
    prereqs: ["tt-fleet-coordination"],
    tier: 2,
    requiresCorpLevel: 5
  },
  "tt-deep-star-navigation": {
    id: "tt-deep-star-navigation",
    name: "Deep-Star Cartography Suite",
    effect: "Enables travel to all charted star systems",
    durationHours: 14,
    costCredits: 20000,
    prereqs: ["tt-proxima-navigation"],
    tier: 3,
    requiresCorpLevel: 10
  },
  "tt-assembly-fabrication": {
    id: "tt-assembly-fabrication",
    name: "Assembly & Fabrication Systems",
    effect: "Unlocks Assembly Facility construction",
    durationHours: 6,
    costCredits: 5000,
    prereqs: ["tt-energy-routing"],
    tier: 2
  },
  "tt-asteroid-prospecting": {
    id: "tt-asteroid-prospecting",
    name: "Asteroid Prospecting Arrays",
    effect: "Unlocks Mining Probe fabrication",
    durationHours: 8,
    costCredits: 8000,
    prereqs: ["tt-assembly-fabrication", "tt-supply-forecast"],
    tier: 2
  }
};

const TIER_1_TECH_IDS = Object.values(RESEARCH_LIBRARY).filter((t) => t.tier === 1).map((t) => t.id);

// Travel time in ms between two stations (station registry loaded after __dirname is defined)
function getTravelTimeMs(fromId, toId) {
  const from = STATION_REGISTRY[fromId];
  const to = STATION_REGISTRY[toId];
  if (!from || !to) return 0;

  if (from.body === to.body) {
    // Same body: 1 minute
    return 1 * 60 * 1000;
  }
  if (from.systemId === to.systemId) {
    // Same system, different body: 1 minute
    return 1 * 60 * 1000;
  }
  // Different system: 1 minute (placeholder — will increase later)
  return 1 * 60 * 1000;
}

const NEAR_STAR_SYSTEMS = new Set(["alpha-centauri", "barnards-star"]);

const ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const DUMMY_ACCESS_TOKEN_SECONDS = 2 * 60 * 60; // 2 hours
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const JWT_SECRET = process.env.JWT_SECRET || "isp-dev-insecure-secret-change-me";
const ALLOW_DUMMY_AUTH = true;
const DIRECT_INVESTMENT_UNLOCK_LEVEL = 2;

function stripHtml(input) {
  return String(input || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function signAccessToken(accountId) {
  const expiresIn = accountId === "dummy" ? DUMMY_ACCESS_TOKEN_SECONDS : ACCESS_TOKEN_SECONDS;
  return jwt.sign({ sub: accountId, kind: "access" }, JWT_SECRET, { expiresIn });
}

function signRefreshToken(accountId) {
  return jwt.sign({ sub: accountId, kind: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_SECONDS });
}

function issueTokens(accountId) {
  const accessExpiry = accountId === "dummy" ? DUMMY_ACCESS_TOKEN_SECONDS : ACCESS_TOKEN_SECONDS;
  const accessToken = signAccessToken(accountId);
  const refreshToken = signRefreshToken(accountId);
  const refreshExpiresAt = Date.now() + REFRESH_TOKEN_SECONDS * 1000;
  storeRefreshToken(accountId, refreshToken, refreshExpiresAt);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: Date.now() + accessExpiry * 1000,
    refreshTokenExpiresAt: refreshExpiresAt
  };
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.kind !== "access") {
      res.status(401).json({ error: "Invalid token type." });
      return;
    }

    req.auth = { accountId: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token." });
  }
}

function requireAccountAccess(req, res, next) {
  if (!req.auth?.accountId || req.auth.accountId !== req.params.accountId) {
    res.status(403).json({ error: "Forbidden account scope." });
    return;
  }

  if (!accountExists(req.params.accountId)) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  next();
}

function formatCredits(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString("en-US")} credits`;
}

function fundingRequirementMessage(actionLabel, corp, requiredCredits, extra = "") {
  const parts = [
    `${actionLabel} requires ${formatCredits(requiredCredits)}.`,
    `Current reserves: ${formatCredits(corp.finances.credits)} credits.`
  ];

  if (extra) {
    parts.push(extra);
  }

  return parts.join(" ");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { version: APP_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

// ─── Station & Travel constants ──────────────────────────────────────────────
const STATIONS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8"));
const STATION_REGISTRY = {};
for (const s of STATIONS_DATA.stations) {
  STATION_REGISTRY[s.id] = s;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});

app.use(express.json());

// ─── Serverless Supabase sync ─────────────────────────────────────────────────
// On Vercel, each request may land on a different instance with stale in-memory
// state.  This middleware reloads the full accountsStore from Supabase before
// every API request, and flushes any dirty writes before the response leaves.
if (process.env.VERCEL) {
  app.use("/api", async (req, res, next) => {
    try {
      await rehydrateFromSupabase();
    } catch (err) {
      console.error("[middleware] rehydrate failed:", err?.message || err);
    }

    const origJson = res.json.bind(res);
    res.json = function (body) {
      flushPendingPersist()
        .catch((err) => { console.error("[middleware] flush failed:", err?.message || err); })
        .then(() => origJson(body));
    };
    next();
  });
}

app.use(express.static(path.join(__dirname, "..", "public")));
// Serve /kanban as the Kanban board root, defaulting to kanban.html
app.use("/kanban", (req, res, next) => {
  if (req.path === "/" || req.path === "") {
    res.sendFile(path.join(__dirname, "..", "kanban", "kanban.html"));
  } else {
    express.static(path.join(__dirname, "..", "kanban"))(req, res, next);
  }
});
app.use("/kanban", kanbanRouter);

// ─── NPC buy-order daily reset ────────────────────────────────────────────────
function getESTDateString() {
  // "sv-SE" locale produces YYYY-MM-DD which is unambiguous
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
}

function checkAndResetNpcBuyOrders() {
  const today = getESTDateString();
  const orders = getState().market?.npcBuyOrders || [];
  if (!orders.some((o) => o.lastResetDate !== today)) return;

  mutateState((draft) => {
    (draft.market.npcBuyOrders || []).forEach((order) => {
      if (order.lastResetDate !== today) {
        order.remainingQty = order.totalQtyPerDay;
        order.lastResetDate = today;
      }
    });
  });
  io.emit("market:updated", getState().market);
}

// Check on startup and every minute thereafter
checkAndResetNpcBuyOrders();
setInterval(checkAndResetNpcBuyOrders, 60_000);

// ─── R&D auto-completion tick ────────────────────────────────────────────────
// ─── Mining tick: process downtime, recovery, and mining progress ─────────────
import { applyMiningOperations, getStationInventory } from "./gameState.js";
import { applyAsteroidExpeditions, BELT_COMPOSITIONS, EXPEDITION_DURATIONS, EXPEDITION_LAUNCH_COST, PROBE_BUILD_COST, PROBE_ASSET_VALUE, BASE_MAX_PROBES, BASE_MAX_DEPLOYMENTS } from "./gameState.js";

function miningTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyMiningOperations(state.corp, now);
        io.emit("mining:updated", {
          accountId,
          extractors: state.corp.mining?.silicateExtractors || [],
          inventory: state.corp.inventory || {},
          credits: state.corp.finances?.credits ?? 0
        });
      }
    });
  }
}

setInterval(miningTick, 5000); // Every 5 seconds

function refineryTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyRefineryOperations(state.corp, now);
      }
    });
  }
}

setInterval(refineryTick, 10_000); // Every 10 seconds

// ─── Asteroid expedition tick ────────────────────────────────────────────────
function asteroidExpeditionTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedExpeditions = [];
    mutateAccountState(accountId, (state) => {
      if (!state?.corp) return;
      const prevActive = (state.corp.asteroidMining?.activeExpeditions || []).length;
      applyAsteroidExpeditions(state.corp, now);
      const afterActive = (state.corp.asteroidMining?.activeExpeditions || []).length;
      if (afterActive < prevActive) {
        // Some expeditions completed — gather details for notifications
        completedExpeditions = (state.corp.asteroidMining?.completedExpeditions || [])
          .filter(e => e.completedAt && e.completedAt >= now - 15000);
      }
    });

    for (const exp of completedExpeditions) {
      const yieldSummary = Object.entries(exp.yields || {}).map(([r, q]) => `${q} ${r}`).join(", ") || "no resources";
      const notification = addAccountNotification(accountId, {
        type: "mining",
        title: "Expedition Complete",
        body: `Mining probe has returned from ${exp.beltKey.split(":")[1] || "asteroid belt"}. Yields: ${yieldSummary}. Resources deposited at ${exp.depositStationId || "nearest station"}.`
      });
      if (notification) {
        io.emit("notifications:new", { accountId, notification });
      }
    }

    if (completedExpeditions.length > 0) {
      io.emit("expedition:completed", { accountId });
    }
  }
}

setInterval(asteroidExpeditionTick, 10_000); // Every 10 seconds

// ─── Travel arrival tick ─────────────────────────────────────────────────────
function travelTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let arrived = false;
    let travelResult = null;

    mutateAccountState(accountId, (state) => {
      const travel = state.corp?.travel;
      if (!travel || !travel.arrivesAt) return;
      if (now < travel.arrivesAt) return;

      if (travel.travelType === "interstellar") {
        // Arrive in a new system — not docked at any station
        state.corp.currentSystemId = travel.toSystemId;
        state.corp.currentStationId = null;
        state.corp.location = travel.toSystemId;
        travelResult = { type: "interstellar", systemId: travel.toSystemId };
      } else {
        // Local dock — arrive at station
        const dest = STATION_REGISTRY[travel.toStationId];
        if (dest) {
          state.corp.currentStationId = travel.toStationId;
          state.corp.currentSystemId = dest.systemId;
          state.corp.location = dest.body;
          travelResult = { type: "local", stationId: travel.toStationId };
        }
      }
      state.corp.travel = null;
      arrived = true;
    });

    if (arrived && travelResult) {
      let notification;
      if (travelResult.type === "interstellar") {
        const sysLabel = travelResult.systemId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        notification = addAccountNotification(accountId, {
          type: "travel",
          title: "System Arrival",
          body: `Your ship has arrived in the ${sysLabel} system. You are in open space — select a station to dock.`
        });
        io.emit("travel:arrived", { accountId, systemId: travelResult.systemId });
      } else {
        const station = STATION_REGISTRY[travelResult.stationId];
        if (station) {
          notification = addAccountNotification(accountId, {
            type: "travel",
            title: "Docking Complete",
            body: `Your ship has arrived at ${station.name} (${station.body}, ${station.systemId.toUpperCase()}).`
          });
          io.emit("travel:arrived", { accountId, stationId: travelResult.stationId });
        }
      }
      if (notification) {
        io.emit("notifications:new", { accountId, notification });
      }
    }
  }
}

setInterval(travelTick, 5000); // Every 5 seconds

function processRndCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.corporateRnD;
      if (!Array.isArray(queue) || queue.length === 0) return;

      completedItems = queue.filter(
        (item) => item.startedAt && item.durationHours &&
          now >= item.startedAt + item.durationHours * 3_600_000
      );
      if (completedItems.length === 0) return;

      if (!Array.isArray(state.corp.unlockedTech)) state.corp.unlockedTech = [];
      for (const item of completedItems) {
        if (item.techId && !state.corp.unlockedTech.includes(item.techId)) {
          state.corp.unlockedTech.push(item.techId);
        }
      }
      state.queues.corporateRnD = queue.filter(
        (item) => !completedItems.some((c) => c.id === item.id)
      );
    });

    if (completedItems.length === 0) continue;

    io.emit("rnd:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "research",
        title: "R&D Complete",
        body: `${item.name} has been completed and applied to your corporation.`
      });
      if (notification) {
        io.emit("notifications:new", { accountId, notification });
      }
    }
  }
}

setInterval(processRndCompletions, 30_000);

function processCeoInsightCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.ceoInsight;
      if (!Array.isArray(queue) || queue.length === 0) return;

      completedItems = queue.filter(
        (item) => item.startedAt && item.durationHours &&
          now >= item.startedAt + item.durationHours * 3_600_000
      );
      if (completedItems.length === 0) return;

      if (!Array.isArray(state.corp.completedInsights)) state.corp.completedInsights = [];
      for (const item of completedItems) {
        if (item.programId) {
          state.corp.completedInsights.push(item.programId);
        }
      }

      // Recalculate effective tax rate after insight completions
      state.corp.finances.exchangeSalesTaxPct = getEffectiveExchangeTaxRate(state);

      state.queues.ceoInsight = queue.filter(
        (item) => !completedItems.some((c) => c.id === item.id)
      );
    });

    if (completedItems.length === 0) continue;

    io.emit("ceo:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "insight",
        title: "CEO Insight Complete",
        body: `${item.name} has been completed.`
      });
      if (notification) {
        io.emit("notifications:new", { accountId, notification });
      }
    }
  }
}

setInterval(processCeoInsightCompletions, 30_000);

app.get("/api/bootstrap", (_req, res) => {
  res.json({ ...getState(), version: APP_VERSION });
});

app.get("/api/stations", (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Stations data unavailable." });
  }
});

app.get("/api/buildings", (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "data", "buildings.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Buildings data unavailable." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, ceoName, corpName } = req.body ?? {};
    const result = await createAccount({ email, password, ceoName, corpName });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    const account = result.account;
    const tokens = issueTokens(account.id);
    res.status(201).json({ account, ...tokens });
  } catch (error) {
    console.error("[auth/register]", error);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/dummy-login", (_req, res) => {
  if (!ALLOW_DUMMY_AUTH) {
    res.status(403).json({ error: "Dummy access is disabled." });
    return;
  }

  const account = getDummyAccount();
  const tokens = issueTokens(account.id);
  res.json({ account, ...tokens });
});

app.post("/api/auth/dummy-reset", (_req, res) => {
  if (!ALLOW_DUMMY_AUTH) {
    res.status(403).json({ error: "Dummy access is disabled." });
    return;
  }

  const account = resetDummyAccountProgress();
  if (!account) {
    res.status(404).json({ error: "Dummy account not found." });
    return;
  }

  res.json(account);
});

app.post("/api/dev/set-credits", (req, res) => {
  if (!ALLOW_DUMMY_AUTH) {
    res.status(403).json({ error: "Dev endpoints are disabled in production." });
    return;
  }

  const { accountId = "dummy", credits } = req.body ?? {};
  if (typeof credits !== "number" || !isFinite(credits)) {
    res.status(400).json({ error: "credits must be a finite number." });
    return;
  }

  const account = mutateAccountState(accountId, (state) => {
    state.corp.finances.credits = credits;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json({ ok: true, credits: account.state.corp.finances.credits });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    const account = await authenticateAccount(email, password);

    if (!account) {
      res.status(401).json({ error: "Invalid account credentials." });
      return;
    }

    const tokens = issueTokens(account.id);
    res.json({ account, ...tokens });
  } catch (error) {
    console.error("[auth/login]", error);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/refresh", (req, res) => {
  const token = String(req.body?.refreshToken || "").trim();
  if (!token) {
    res.status(400).json({ error: "Refresh token is required." });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.kind !== "refresh") {
      res.status(401).json({ error: "Invalid token type." });
      return;
    }

    if (!hasRefreshToken(payload.sub, token)) {
      res.status(401).json({ error: "Refresh token has been revoked." });
      return;
    }

    revokeRefreshToken(payload.sub, token);
    const tokens = issueTokens(payload.sub);
    const account = getAccountById(payload.sub);
    res.json({ account, ...tokens });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const token = String(req.body?.refreshToken || "").trim();
  const accountId = String(req.body?.accountId || "").trim();
  if (token && accountId) {
    revokeRefreshToken(accountId, token);
  }
  res.json({ ok: true });
});

app.get("/api/auth/session", requireAuth, (req, res) => {
  const account = getAccountById(req.auth.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json({ account });
});

app.use("/api/accounts/:accountId", requireAuth, requireAccountAccess);

app.get("/api/accounts/:accountId", (req, res) => {
  const account = getAccountById(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/walkthrough-complete", (req, res) => {
  const account = markWalkthroughCompleted(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "onboarding",
    title: "Walkthrough Completed",
    body: "Onboarding has been marked complete for this profile."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/walkthrough-reset", (req, res) => {
  const account = resetWalkthroughCompletion(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "onboarding",
    title: "Walkthrough Reset",
    body: "Onboarding flow has been reset and can be replayed."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.get("/api/accounts/:accountId/notifications", (req, res) => {
  const payload = listAccountNotifications(req.params.accountId);
  if (!payload) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json(payload);
});

app.post("/api/accounts/:accountId/notifications/:notificationId/read", (req, res) => {
  const updated = markNotificationRead(req.params.accountId, req.params.notificationId);
  if (!updated) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }

  res.json({ notification: updated });
});

app.post("/api/accounts/:accountId/notifications/read-all", (req, res) => {
  const payload = markAllNotificationsRead(req.params.accountId);
  if (!payload) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json(payload);
});

app.post("/api/accounts/:accountId/gameplay/hire", (req, res) => {
  const count = Math.max(1, Number(req.body?.count || 1));
  let outcome = "ok";
  let hiredCount = 0;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const available = Math.max(0, corp.employeeCap - corp.employeeCount);
    const hired = Math.min(count, available);
    const hireCost = hired * 2000;

    if (hired <= 0) {
      outcome = "no-capacity";
      return;
    }

    if (corp.finances.credits < hireCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.employeeCount += hired;
    corp.finances.credits -= hireCost;
    corp.finances.dailyCosts += hired * 150;
    hiredCount = hired;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "no-capacity": `Employee cap reached. Current staffing is ${corp.employeeCount}/${corp.employeeCap}.`,
      "insufficient-credits": fundingRequirementMessage("Hiring", corp, count * 2000)
    };
    res.status(400).json({ error: messageMap[outcome] || "Hire action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "workforce",
    title: "Hiring Order Confirmed",
    body: `${hiredCount} employee(s) were added to your workforce.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/rent-office", (req, res) => {
  const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
  const VALID_DURATIONS = [7, 14, 21, 28];
  const durationDays = VALID_DURATIONS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
  const officeCost = durationDays * 1000;
  let outcome = "ok";
  let stationName = "Earth Station Prime";

  let stationsData;
  try {
    stationsData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8")).stations;
  } catch {
    res.status(500).json({ error: "Station registry unavailable." });
    return;
  }

  const station = stationsData.find((s) => s.id === requestedStationId);
  if (!station) {
    res.status(400).json({ error: "Station not found." });
    return;
  }

  stationName = station.name;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (!Array.isArray(corp.offices)) {
      corp.offices = [];
    }

    if (corp.offices.some((o) => o.stationId === station.id && o.rentedUntil > Date.now())) {
      outcome = "already-rented";
      return;
    }

    if (corp.finances.credits < officeCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= officeCost;
    const now = Date.now();
    corp.offices.push({
      stationId: station.id,
      name: station.name,
      body: station.body,
      systemId: station.systemId,
      tier: station.tier,
      rentedAt: now,
      rentedUntil: now + durationDays * 86_400_000,
      durationDays
    });
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "already-rented": `Your corporation already maintains an office at ${stationName}.`,
      "insufficient-credits": `Leasing an office at ${stationName} for ${durationDays} days requires ${formatCredits(officeCost)}. Current reserves: ${formatCredits(corp.finances.credits)} credits.`
    };
    res.status(400).json({ error: messageMap[outcome] || "Office rental failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "administration",
    title: "Office Lease Confirmed",
    body: `Your corporation now maintains a registered operational office at ${stationName}.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Orbital Executive Suites: Renew an office lease ───────────────────────
app.post("/api/accounts/:accountId/gameplay/renew-office", (req, res) => {
  const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
  const VALID_DURATIONS = [7, 14, 21, 28];
  const durationDays = VALID_DURATIONS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
  const renewalCost = durationDays * 1000;
  let outcome = "ok";
  let stationName = "Earth Station Prime";

  let stationsData;
  try {
    stationsData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8")).stations;
  } catch {
    res.status(500).json({ error: "Station registry unavailable." });
    return;
  }

  const station = stationsData.find((s) => s.id === requestedStationId);
  if (!station) {
    res.status(400).json({ error: "Station not found." });
    return;
  }
  stationName = station.name;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    if (!Array.isArray(corp.offices)) {
      outcome = "no-office";
      return;
    }
    const office = corp.offices.find((o) => o.stationId === station.id);
    if (!office) {
      outcome = "no-office";
      return;
    }
    if (corp.finances.credits < renewalCost) {
      outcome = "insufficient-credits";
      return;
    }
    corp.finances.credits -= renewalCost;
    const extensionMs = durationDays * 86_400_000;
    const now = Date.now();
    office.rentedUntil = Math.max(office.rentedUntil || now, now) + extensionMs;
    office.durationDays = (office.durationDays || 0) + durationDays;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "no-office": `Your corporation does not have an office at ${stationName} to renew.`,
      "insufficient-credits": `Renewing for ${durationDays} days requires ${formatCredits(renewalCost)}. Current reserves: ${formatCredits(corp.finances.credits)} credits.`
    };
    res.status(400).json({ error: messageMap[outcome] || "Lease renewal failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "administration",
    title: "Office Lease Renewed",
    body: `Your office lease at ${stationName} has been extended by ${durationDays} days.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── ISA Claims & Leases Division: Purchase a mining lease ─────────────────
app.post("/api/accounts/:accountId/gameplay/purchase-lease", (req, res) => {
  const requestedBody = String(req.body?.body || "").trim();
  if (!requestedBody) {
    res.status(400).json({ error: "A celestial body must be specified." });
    return;
  }

  const LEASE_COSTS = { Earth: 20000, Mars: 25000, Luna: 30000 };
  const leaseCost = LEASE_COSTS[requestedBody] ?? 25000;
  const EMPLOYEES_PER_LEASE = 5;
  let outcome = "ok";
  let existingLeaseOnBody = false;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    const hasOffice = Array.isArray(corp.offices) && corp.offices.length > 0;
    if (!hasOffice) {
      outcome = "no-office";
      return;
    }

    if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];

    existingLeaseOnBody = corp.miningLeases.some((l) => (l.body || l) === requestedBody);
    if (existingLeaseOnBody) {
      outcome = "duplicate-lease";
      return;
    }

    const requiredEmployees = (corp.miningLeases.length + 1) * EMPLOYEES_PER_LEASE;
    if ((corp.employeeCount || 0) < requiredEmployees) {
      outcome = "insufficient-employees";
      return;
    }

    if ((corp.finances.credits || 0) < leaseCost) {
      outcome = "insufficient-credits";
      return;
    }

    const now = Date.now();
    const leaseId = `lease-${now}-${Math.random().toString(36).slice(2, 8)}`;
    corp.miningLeases.push({
      id: leaseId,
      body: requestedBody,
      leaseType: "Silicate Extraction",
      issuedAt: now,
      cost: leaseCost,
      buildingSlots: 2,
      extractorIds: []
    });

    corp.finances.credits -= leaseCost;
    corp.buildingSlots = (corp.buildingSlots || 2) + 2;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const requiredEmployees = ((corp.miningLeases || []).length + 1) * EMPLOYEES_PER_LEASE;
    const messageMap = {
      "no-office": "You must lease a corporate office before filing extraction claims with the ISA.",
      "duplicate-lease": `Your corporation already holds an active mining lease on ${requestedBody}.`,
      "insufficient-employees": `ISA regulations require at least ${requiredEmployees} employees on payroll before issuing an additional mining lease. Current headcount: ${corp.employeeCount || 0}.`,
      "insufficient-credits": fundingRequirementMessage(`${requestedBody} mining lease acquisition`, corp, leaseCost)
    };
    res.status(400).json({ error: messageMap[outcome] || "Lease application failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "administration",
    title: "Mining Lease Approved",
    body: `ISA Claims & Leases has approved your extraction rights application for ${requestedBody}. Two building slots have been allocated to your lease.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  // Commit to disk immediately — critical state that must survive server restarts.
  saveAccountsNow();

  res.json(account);
});

// ─── Logistics: transfer resources between stations ──────────────────────────
const LOGISTICS_FEE_PER_UNIT = 2;

app.post("/api/accounts/:accountId/gameplay/transfer-resources", (req, res) => {
  const fromStationId = String(req.body?.fromStationId || "").trim();
  const item = String(req.body?.item || "").trim();
  const quantity = Math.max(1, Math.floor(Number(req.body?.quantity || 0)));

  if (!fromStationId || !STATION_REGISTRY[fromStationId]) {
    res.status(400).json({ error: "Invalid source station." });
    return;
  }
  if (!item) {
    res.status(400).json({ error: "Item must be specified." });
    return;
  }

  let outcome = "ok";
  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const toStationId = corp.currentStationId || "earth-station-prime";

    if (fromStationId === toStationId) {
      outcome = "same-station";
      return;
    }

    const fromInv = getStationInventory(corp, fromStationId);
    const available = Number(fromInv[item] || 0);
    if (available < quantity) {
      outcome = "insufficient";
      return;
    }

    const fee = LOGISTICS_FEE_PER_UNIT * quantity;
    if ((corp.finances.credits || 0) < fee) {
      outcome = "insufficient-credits";
      return;
    }

    // Deduct from source, add to destination, charge fee
    fromInv[item] = available - quantity;
    if (fromInv[item] <= 0) delete fromInv[item];

    const toInv = getStationInventory(corp, toStationId);
    toInv[item] = (toInv[item] || 0) + quantity;

    corp.finances.credits -= fee;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const messages = {
      "same-station": "Cannot transfer to the same station you are docked at.",
      "insufficient": `Insufficient ${item} at the source station.`,
      "insufficient-credits": `Not enough credits. Transfer fee: ${(LOGISTICS_FEE_PER_UNIT * quantity).toLocaleString()} credits (${LOGISTICS_FEE_PER_UNIT}/unit).`
    };
    res.status(400).json({ error: messages[outcome] || "Transfer failed." });
    return;
  }

  res.json(account);
});

// ─── Travel: interstellar (system-to-system) or local (dock at station) ──────
app.post("/api/accounts/:accountId/gameplay/travel", (req, res) => {
  const toSystemId = String(req.body?.toSystemId || "").trim();
  const toStationId = String(req.body?.toStationId || "").trim();

  // Must specify exactly one destination type
  const isInterstellar = Boolean(toSystemId);
  const isLocal = Boolean(toStationId);
  if ((!isInterstellar && !isLocal) || (isInterstellar && isLocal)) {
    res.status(400).json({ error: "Specify either toSystemId (interstellar) or toStationId (dock)." });
    return;
  }

  if (isLocal && !STATION_REGISTRY[toStationId]) {
    res.status(400).json({ error: "Invalid destination station." });
    return;
  }

  if (isInterstellar && !SYSTEM_DETAILS[toSystemId]) {
    res.status(400).json({ error: "Invalid destination system." });
    return;
  }

  let outcome = "ok";
  let travelInfo = null;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (corp.travel) {
      outcome = "already-traveling";
      return;
    }

    if (isInterstellar) {
      // ── Interstellar jump ──
      const fromSystemId = corp.currentSystemId || "sol";
      if (fromSystemId === toSystemId) {
        outcome = "already-in-system";
        return;
      }

      // Research gate
      const unlocked = new Set(corp.unlockedTech || []);
      if (NEAR_STAR_SYSTEMS.has(toSystemId)) {
        if (!unlocked.has("tt-proxima-navigation")) { outcome = "missing-research"; return; }
      } else {
        if (!unlocked.has("tt-deep-star-navigation")) { outcome = "missing-research"; return; }
      }

      const durationMs = IS_DEV ? 5 * 1000 : 1 * 60 * 1000;
      const now = Date.now();

      corp.travel = {
        travelType: "interstellar",
        fromSystemId,
        toSystemId,
        fromStationId: corp.currentStationId || null,
        departedAt: now,
        arrivesAt: now + durationMs
      };

      // Undock from current station
      corp.currentStationId = null;
      travelInfo = { ...corp.travel };

    } else {
      // ── Local docking ──
      const station = STATION_REGISTRY[toStationId];
      const currentSystemId = corp.currentSystemId || "sol";

      if (station.systemId !== currentSystemId) {
        outcome = "wrong-system";
        return;
      }

      if (corp.currentStationId === toStationId) {
        outcome = "already-docked";
        return;
      }

      const durationMs = IS_DEV ? 5 * 1000 : 1 * 60 * 1000;
      const now = Date.now();

      corp.travel = {
        travelType: "local",
        fromStationId: corp.currentStationId || null,
        toStationId,
        toSystemId: currentSystemId,
        departedAt: now,
        arrivesAt: now + durationMs
      };

      // Undock from current station (if docked)
      corp.currentStationId = null;
      travelInfo = { ...corp.travel };
    }
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const messageMap = {
      "already-traveling": "Your ship is already in transit. Wait for arrival before initiating a new course.",
      "already-docked": "You are already docked at this station.",
      "already-in-system": "You are already in this system.",
      "missing-research": "You lack the required navigation research to travel to that system.",
      "wrong-system": "That station is in a different system. Travel to the system first."
    };
    res.status(400).json({ error: messageMap[outcome] || "Travel request failed." });
    return;
  }

  // Notification
  let notifBody;
  if (travelInfo.travelType === "interstellar") {
    const sysName = SYSTEM_DETAILS[travelInfo.toSystemId]?.bodies?.[0]?.name || travelInfo.toSystemId;
    notifBody = `Initiating interstellar jump to the ${travelInfo.toSystemId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())} system. ETA ${Math.round((travelInfo.arrivesAt - travelInfo.departedAt) / 60000)} minute(s).`;
  } else {
    const dest = STATION_REGISTRY[travelInfo.toStationId];
    notifBody = `Setting course for ${dest.name} (${dest.body}). ETA ${Math.round((travelInfo.arrivesAt - travelInfo.departedAt) / 60000)} minute(s).`;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "travel",
    title: travelInfo.travelType === "interstellar" ? "Interstellar Jump Initiated" : "Undocking — Course Set",
    body: notifBody
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  saveAccountsNow();
  res.json(account);
});

// ─── Lease-scoped: Build an extractor yard on a specific lease ──────────────
app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor", (req, res) => {
  const { leaseId } = req.params;
  const BASE_BUILD_COST = 50000;
  const ASSET_VALUE = 36000;
  let outcome = "ok";
  let slotInfo = "";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const hasSupplyForecast = (corp.unlockedTech || []).includes("tt-supply-forecast");
    const buildCost = hasSupplyForecast ? Math.round(BASE_BUILD_COST * 0.94) : BASE_BUILD_COST;

    if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];
    const lease = corp.miningLeases.find((l) => l.id === leaseId);
    if (!lease) {
      outcome = "no-lease";
      return;
    }

    if (!Array.isArray(lease.extractorIds)) lease.extractorIds = [];
    if (lease.extractorIds.length >= lease.buildingSlots) {
      outcome = "lease-slots-full";
      slotInfo = `${lease.extractorIds.length}/${lease.buildingSlots}`;
      return;
    }

    if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) {
      outcome = "no-corp-slot";
      slotInfo = `${corp.buildings.length}/${corp.buildingSlots}`;
      return;
    }

    if ((corp.finances.credits || 0) < buildCost) {
      outcome = "insufficient-credits";
      return;
    }

    if (!Array.isArray(corp.buildings)) corp.buildings = [];
    if (!corp.mining || typeof corp.mining !== "object") corp.mining = {};
    if (!Array.isArray(corp.mining.silicateExtractors)) corp.mining.silicateExtractors = [];

    const nextIndex = corp.mining.silicateExtractors.length + 1;
    const newExtractorId = `ext-basic-${nextIndex}`;

    corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });
    corp.mining.silicateExtractors.push({
      id: newExtractorId,
      name: `Basic Extractor Yard #${nextIndex}`,
      tier: 1,
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      totalSpent: 0,
      lastCompletedAt: null,
      leaseId
    });

    lease.extractorIds.push(newExtractorId);
    corp.finances.credits -= buildCost;
    corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "no-lease": "The specified lease could not be found on your account.",
      "lease-slots-full": `This lease has used all ${slotInfo} building slots. Upgrade your lease tier or acquire an additional claim to expand capacity.`,
      "no-corp-slot": `No corporation building slots available. Current usage: ${slotInfo}. Upgrade your headquarters or release an existing building.`,
      "insufficient-credits": fundingRequirementMessage("Basic Extractor Yard construction", corp, BASE_BUILD_COST)
    };
    res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Extractor Commissioned",
    body: "Basic Extractor Yard is now operational and linked to your mining lease."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Lease-scoped: Start a mining cycle on a lease extractor ───────────────
app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/start-mining", (req, res) => {
  const { leaseId } = req.params;
  const amount = Math.max(10, Number(req.body?.amount || 40));
  const requestedHours = Math.max(1, Math.min(72, Number(req.body?.hours || 24)));
  const requestedExtractorId = String(req.body?.extractorId || "").trim();
  let outcome = "ok";
  let targetExtractorLabel = "";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    // Check for expired office lease
    if (!Array.isArray(corp.offices) || corp.offices.length === 0) {
      outcome = "no-office";
      return;
    }
    const now = Date.now();
    const activeOffice = corp.offices.find((o) => o.rentedUntil > now);
    if (!activeOffice) {
      outcome = "office-lease-expired";
      return;
    }

    if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];
    const lease = corp.miningLeases.find((l) => l.id === leaseId);
    if (!lease) {
      outcome = "no-lease";
      return;
    }

    if (!Array.isArray(corp.mining?.silicateExtractors) || corp.mining.silicateExtractors.length === 0) {
      outcome = "missing-extractor";
      return;
    }

    const leaseExtractors = corp.mining.silicateExtractors.filter((ex) => ex.leaseId === leaseId);
    if (leaseExtractors.length === 0) {
      outcome = "no-lease-extractors";
      return;
    }

    const extractorCycle = requestedExtractorId
      ? leaseExtractors.find((ex) => ex.id === requestedExtractorId)
      : leaseExtractors[0];

    targetExtractorLabel = extractorCycle?.name || requestedExtractorId || "Extractor";

    if (!extractorCycle) {
      outcome = "missing-extractor-target";
      return;
    }

    if (extractorCycle.active) {
      outcome = "already-active";
      return;
    }

    let throughputPerHour = Math.max(10, Math.min(250, amount));
    if (!Number.isFinite(throughputPerHour) || throughputPerHour <= 0) throughputPerHour = 40;
    let operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
    if (!Number.isFinite(operationCostPerHour) || operationCostPerHour <= 0) operationCostPerHour = 640;
    const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));

    if ((corp.finances.credits || 0) < startupCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= startupCost;

    extractorCycle.active = true;
    extractorCycle.startedAt = now;
    extractorCycle.lastTickAt = now;
    extractorCycle.endsAt = now + requestedHours * 60 * 60 * 1000;
    extractorCycle.throughputPerHour = throughputPerHour;
    extractorCycle.operationCostPerHour = operationCostPerHour;
    extractorCycle.totalSpent += startupCost;

    corp.mining.silicateExtractor = corp.mining.silicateExtractors[0];
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const messageMap = {
      "no-office": "You must have an active office lease to operate mining facilities.",
      "office-lease-expired": "Your office lease has expired. Renew your lease to resume mining operations.",
      "no-lease": "The specified lease could not be found on your account.",
      "missing-extractor": "No extraction facilities are available.",
      "no-lease-extractors": "No extraction facilities are assigned to this lease.",
      "missing-extractor-target": `Extractor "${requestedExtractorId}" not found on this lease.`,
      "already-active": `${targetExtractorLabel} already has an active mining cycle in progress.`,
      "insufficient-credits": `Insufficient credits to start the mining cycle. Check your finances.`
    };
    res.status(400).json({ error: messageMap[outcome] || "Mining cycle failed to start." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "mining",
    title: "Mining Cycle Started",
    body: `${targetExtractorLabel} has begun silicate extraction operations.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/build-extractor", (req, res) => {
  let outcome = "ok";
  let currentExtractorCount = 0;
  let extractorCap = 1;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    if (!corp.unlocks || typeof corp.unlocks !== "object") {
      corp.unlocks = {};
    }
    extractorCap = Number(corp.unlocks.maxBasicExtractorYards || 1);
    currentExtractorCount = (corp.buildings || []).filter((b) => b.name === "Basic Extractor Yard").length;
    const hasSupplyForecast = (corp.unlockedTech || []).includes("tt-supply-forecast");
    const buildCost = hasSupplyForecast ? Math.round(50000 * 0.94) : 50000;

    if (currentExtractorCount >= extractorCap) {
      outcome = "extractor-cap";
      return;
    }

    if (corp.buildings.length >= corp.buildingSlots) {
      outcome = "no-slot";
      return;
    }

    if (corp.finances.credits < buildCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });

    if (!corp.mining || typeof corp.mining !== "object") {
      corp.mining = {};
    }
    if (!Array.isArray(corp.mining.silicateExtractors)) {
      corp.mining.silicateExtractors = [];
    }
    const nextExtractorIndex = corp.mining.silicateExtractors.length + 1;
    corp.mining.silicateExtractors.push({
      id: `ext-basic-${nextExtractorIndex}`,
      name: `Basic Extractor Yard #${nextExtractorIndex}`,
      tier: 1,
      active: false,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      throughputPerHour: 0,
      operationCostPerHour: 0,
      totalMined: 0,
      totalSpent: 0,
      lastCompletedAt: null
    });

    corp.finances.credits -= buildCost;
    corp.finances.assets += 42000;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "extractor-cap": `Basic Extractor Yard cap reached (${currentExtractorCount}/${extractorCap}). Additional capacity requires future corporation perks.`,
      "no-slot": `Basic Extractor Yard requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`,
      "insufficient-credits": fundingRequirementMessage(
        "Basic Extractor Yard construction",
        corp,
        50000,
        `It also requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`
      )
    };
    res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Extractor Commissioned",
    body: "Basic Extractor Yard is now operational."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Asteroid Mining: Assembly Facility, Probes, Expeditions ─────────────────

app.post("/api/accounts/:accountId/gameplay/build-assembly-facility", (req, res) => {
  const BUILD_COST = 60000;
  const ASSET_VALUE = 40000;
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (!(corp.unlockedTech || []).includes("tt-assembly-fabrication")) {
      outcome = "missing-research";
      return;
    }

    const hasOne = (corp.buildings || []).some((b) => b.name === "Assembly Facility");
    if (hasOne) {
      outcome = "already-built";
      return;
    }

    if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) {
      outcome = "no-slot";
      return;
    }

    if ((corp.finances.credits || 0) < BUILD_COST) {
      outcome = "insufficient-credits";
      return;
    }

    if (!Array.isArray(corp.buildings)) corp.buildings = [];
    corp.buildings.push({ name: "Assembly Facility", tier: 1, status: "Operational" });
    corp.finances.credits -= BUILD_COST;
    corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
  });

  if (!account) { res.status(404).json({ error: "Account not found." }); return; }

  if (outcome !== "ok") {
    const msgs = {
      "missing-research": "Assembly & Fabrication Systems research is required before constructing an Assembly Facility.",
      "already-built": "Your corporation already operates an Assembly Facility.",
      "no-slot": `No building slots available (${account.state.corp.buildings.length}/${account.state.corp.buildingSlots}).`,
      "insufficient-credits": fundingRequirementMessage("Assembly Facility construction", account.state.corp, BUILD_COST)
    };
    res.status(400).json({ error: msgs[outcome] || "Build failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Assembly Facility Online",
    body: "Your Assembly Facility is now operational. You may begin fabricating units."
  });
  if (notification) io.emit("notifications:new", { accountId: req.params.accountId, notification });
  saveAccountsNow();
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/build-mining-probe", (req, res) => {
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) {
      outcome = "missing-research";
      return;
    }

    const hasAssembly = (corp.buildings || []).some((b) => b.name === "Assembly Facility");
    if (!hasAssembly) {
      outcome = "no-assembly";
      return;
    }

    if (!corp.asteroidMining) corp.asteroidMining = {};
    const am = corp.asteroidMining;
    if (typeof am.probeCount !== "number") am.probeCount = 0;
    if (typeof am.maxProbes !== "number") am.maxProbes = BASE_MAX_PROBES;

    if (am.probeCount >= am.maxProbes) {
      outcome = "probe-cap";
      return;
    }

    if ((corp.finances.credits || 0) < PROBE_BUILD_COST) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= PROBE_BUILD_COST;
    corp.finances.assets = (corp.finances.assets || 0) + PROBE_ASSET_VALUE;
    am.probeCount += 1;
  });

  if (!account) { res.status(404).json({ error: "Account not found." }); return; }

  if (outcome !== "ok") {
    const am = account.state.corp.asteroidMining || {};
    const msgs = {
      "missing-research": "Asteroid Prospecting Arrays research is required before fabricating mining probes.",
      "no-assembly": "You must construct an Assembly Facility before fabricating probes.",
      "probe-cap": `Probe hangar is full (${am.probeCount || 0}/${am.maxProbes || BASE_MAX_PROBES}). Research or level up to increase capacity.`,
      "insufficient-credits": fundingRequirementMessage("Mining Probe fabrication", account.state.corp, PROBE_BUILD_COST)
    };
    res.status(400).json({ error: msgs[outcome] || "Probe fabrication failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Mining Probe Fabricated",
    body: "A new Mining Probe has been manufactured and is ready for deployment."
  });
  if (notification) io.emit("notifications:new", { accountId: req.params.accountId, notification });
  saveAccountsNow();
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/scout-belt", (req, res) => {
  const beltKey = String(req.body?.beltKey || "").trim();
  if (!beltKey || !BELT_COMPOSITIONS[beltKey]) {
    res.status(400).json({ error: "Invalid asteroid belt identifier." });
    return;
  }

  let outcome = "ok";
  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    if (!corp.asteroidMining) corp.asteroidMining = {};
    if (!Array.isArray(corp.asteroidMining.scoutedBelts)) corp.asteroidMining.scoutedBelts = [];

    if (corp.asteroidMining.scoutedBelts.includes(beltKey)) {
      outcome = "already-scouted";
      return;
    }

    corp.asteroidMining.scoutedBelts.push(beltKey);
  });

  if (!account) { res.status(404).json({ error: "Account not found." }); return; }
  if (outcome === "already-scouted") {
    res.json(account); // Idempotent — no error, just return current state
    return;
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/launch-expedition", (req, res) => {
  const beltKey = String(req.body?.beltKey || "").trim();
  const duration = String(req.body?.duration || "standard").trim();

  if (!beltKey || !BELT_COMPOSITIONS[beltKey]) {
    res.status(400).json({ error: "Invalid asteroid belt identifier." });
    return;
  }

  if (!EXPEDITION_DURATIONS[duration]) {
    res.status(400).json({ error: "Invalid expedition duration. Choose: short, standard, or extended." });
    return;
  }

  let outcome = "ok";
  let launchCost = EXPEDITION_LAUNCH_COST;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (!(corp.unlockedTech || []).includes("tt-asteroid-prospecting")) {
      outcome = "missing-research";
      return;
    }

    if (!corp.asteroidMining) corp.asteroidMining = {};
    const am = corp.asteroidMining;
    if (typeof am.probeCount !== "number") am.probeCount = 0;
    if (typeof am.maxDeployments !== "number") am.maxDeployments = BASE_MAX_DEPLOYMENTS;
    if (!Array.isArray(am.activeExpeditions)) am.activeExpeditions = [];

    if (am.probeCount <= 0) {
      outcome = "no-probes";
      return;
    }

    if (am.activeExpeditions.length >= am.maxDeployments) {
      outcome = "deployment-cap";
      return;
    }

    // Player must be in the same system as the belt
    const beltSystemId = beltKey.split(":")[0];
    if ((corp.currentSystemId || "sol") !== beltSystemId) {
      outcome = "wrong-system";
      return;
    }

    if ((corp.finances.credits || 0) < launchCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= launchCost;
    am.probeCount -= 1;

    const now = Date.now();
    const durationMs = EXPEDITION_DURATIONS[duration].ms;

    am.activeExpeditions.push({
      id: `exp-${now}-${Math.random().toString(36).slice(2, 8)}`,
      beltKey,
      systemId: beltSystemId,
      duration,
      deployedAt: now,
      completesAt: now + durationMs,
      lastTickAt: now,
      launchCost,
      yields: {},
      status: "active"
    });
  });

  if (!account) { res.status(404).json({ error: "Account not found." }); return; }

  if (outcome !== "ok") {
    const am = account.state.corp.asteroidMining || {};
    const msgs = {
      "missing-research": "Asteroid Prospecting Arrays research must be completed before launching expeditions.",
      "no-probes": "No mining probes available. Fabricate probes at your Assembly Facility.",
      "deployment-cap": `All deployment slots are occupied (${am.activeExpeditions?.length || 0}/${am.maxDeployments || BASE_MAX_DEPLOYMENTS}). Wait for a probe to return or research additional capacity.`,
      "wrong-system": "You must be in the same system as the asteroid belt to launch an expedition.",
      "insufficient-credits": fundingRequirementMessage("Expedition launch", account.state.corp, launchCost)
    };
    res.status(400).json({ error: msgs[outcome] || "Expedition launch failed." });
    return;
  }

  const durationLabel = EXPEDITION_DURATIONS[duration]?.label || duration;
  const notification = addAccountNotification(req.params.accountId, {
    type: "mining",
    title: "Expedition Launched",
    body: `Mining probe deployed to ${beltKey.split(":")[1] || "asteroid belt"} on a ${durationLabel} mission. Resources will be deposited upon return.`
  });
  if (notification) io.emit("notifications:new", { accountId: req.params.accountId, notification });
  saveAccountsNow();
  res.json(account);
});

// Provide belt compositions to the client (only scouted belts return data)
app.get("/api/accounts/:accountId/gameplay/belt-compositions", (req, res) => {
  const account = getAccountById(req.params.accountId);
  if (!account) { res.status(404).json({ error: "Account not found." }); return; }

  const scouted = account.state?.corp?.asteroidMining?.scoutedBelts || [];
  const result = {};
  for (const key of scouted) {
    if (BELT_COMPOSITIONS[key]) {
      result[key] = BELT_COMPOSITIONS[key];
    }
  }
  res.json({ compositions: result, allBeltKeys: Object.keys(BELT_COMPOSITIONS) });
});

// ─── Refinery ────────────────────────────────────────────────────────────────

app.post("/api/accounts/:accountId/gameplay/build-refinery", (req, res) => {
  const BUILD_COST = 75000;
  const ASSET_VALUE = 55000;
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const unlockedTech = corp.unlockedTech || [];

    // Require both Material Compression I and Nano-Lattice Weaving
    if (!unlockedTech.includes("tt-material-compression") || !unlockedTech.includes("tt-nano-lattice")) {
      outcome = "missing-research";
      return;
    }

    if ((corp.buildings || []).length >= (corp.buildingSlots || 2)) {
      outcome = "no-slot";
      return;
    }

    if ((corp.finances.credits || 0) < BUILD_COST) {
      outcome = "insufficient-credits";
      return;
    }

    if (!Array.isArray(corp.buildings)) corp.buildings = [];
    corp.buildings.push({ name: "Refinery", tier: 1, status: "Operational" });

    if (!Array.isArray(corp.refineries)) corp.refineries = [];
    const nextIndex = corp.refineries.length + 1;
    corp.refineries.push({
      id: `ref-${nextIndex}`,
      name: `Refinery #${nextIndex}`,
      tier: 1,
      active: false,
      chainId: null,
      startedAt: null,
      lastTickAt: null,
      endsAt: null,
      cyclesCompleted: 0,
      totalInputConsumed: 0,
      totalOutputProduced: 0
    });

    corp.finances.credits -= BUILD_COST;
    corp.finances.assets = (corp.finances.assets || 0) + ASSET_VALUE;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "missing-research": "Refinery construction requires Material Compression I and Nano-Lattice Weaving research.",
      "no-slot": `Refinery requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`,
      "insufficient-credits": fundingRequirementMessage("Refinery construction", corp, BUILD_COST)
    };
    res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Refinery Commissioned",
    body: "A new Refinery is now operational and ready for production runs."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/start-refinery", (req, res) => {
  const refineryId = String(req.body?.refineryId || "").trim();
  const chainId = String(req.body?.chainId || "").trim();
  let outcome = "ok";
  let targetLabel = "";

  const chain = REFINERY_CHAINS[chainId];
  if (!chain) {
    res.status(400).json({ error: "Unknown refinery chain." });
    return;
  }

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const unlockedTech = corp.unlockedTech || [];

    // Check tech prerequisites for this chain
    if (Array.isArray(chain.requiresTechIds) && !chain.requiresTechIds.every((t) => unlockedTech.includes(t))) {
      outcome = "missing-research";
      return;
    }

    if (!Array.isArray(corp.refineries) || !corp.refineries.length) {
      outcome = "no-refinery";
      return;
    }

    const refinery = refineryId
      ? corp.refineries.find((r) => r.id === refineryId)
      : corp.refineries.find((r) => !r.active);
    targetLabel = refinery?.name || refineryId || "Refinery";

    if (!refinery) {
      outcome = refineryId ? "refinery-not-found" : "all-busy";
      return;
    }

    if (refinery.active) {
      outcome = "already-active";
      return;
    }

    // Check input material availability at current station
    const inputQty = chain.inputQuantityPerCycle;
    const refStationId = corp.currentStationId || "earth-station-prime";
    const refInv = getStationInventory(corp, refStationId);
    const available = Number(refInv[chain.input] || 0);
    if (available < inputQty) {
      outcome = "insufficient-input";
      return;
    }

    // Consume input
    refInv[chain.input] -= inputQty;
    if (refInv[chain.input] <= 0) delete refInv[chain.input];

    const now = Date.now();
    refinery.active = true;
    refinery.chainId = chain.id;
    refinery.startedAt = now;
    refinery.lastTickAt = now;
    refinery.endsAt = now + chain.cycleDurationHours * 60 * 60 * 1000;
    refinery.totalInputConsumed += inputQty;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const messageMap = {
      "missing-research": `This chain requires: ${chain.requiresResearch.join(", ")}.`,
      "no-refinery": "Build a Refinery before starting a production run.",
      "refinery-not-found": `Refinery "${refineryId}" was not found.`,
      "all-busy": "All refineries are currently running cycles.",
      "already-active": `${targetLabel} already has an active production cycle.`,
      "insufficient-input": `Not enough ${chain.input} at this station. Need ${chain.inputQuantityPerCycle} but only have ${Number(getStationInventory(account.state.corp, account.state.corp.currentStationId || "earth-station-prime")[chain.input] || 0)}.`
    };
    res.status(400).json({ error: messageMap[outcome] || "Refinery cycle failed to start." });
    return;
  }

  const outputNames = chain.outputs.map((o) => `${o.quantityPerCycle} ${o.item}`).join(", ");
  const notification = addAccountNotification(req.params.accountId, {
    type: "operations",
    title: "Refinery Cycle Started",
    body: `${targetLabel} processing ${chain.inputQuantityPerCycle} ${chain.input} → ${outputNames} (${chain.cycleDurationHours}h).`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ── Mission contract endpoints ──────────────────────────────

app.post("/api/accounts/:accountId/gameplay/accept-mission", (req, res) => {
  const missionId = String(req.body?.missionId || "").trim();
  if (!missionId) return res.status(400).json({ error: "Missing missionId." });

  let outcome = "ok";
  const account = mutateAccountState(req.params.accountId, (state) => {
    if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
    if (state.corp.activeMissions.some((m) => m.id === missionId)) { outcome = "already-active"; return; }

    // Look up mission from the account's current contract offerings
    const offerings = refreshContractOfferings(state.corp);
    const mission = offerings.missions.find((m) => m.id === missionId);
    if (!mission) {
      // Also check the full template pool as fallback
      const template = MISSION_TEMPLATES.find((m) => m.id === missionId);
      if (!template) { outcome = "not-found"; return; }
      state.corp.activeMissions.push({ ...template });
    } else {
      state.corp.activeMissions.push({ ...mission });
      // Remove from current offerings so it can't be double-accepted
      offerings.missions = offerings.missions.filter((m) => m.id !== missionId);
    }
  });

  if (!account) return res.status(404).json({ error: "Account not found." });
  if (outcome === "not-found") return res.status(400).json({ error: "Mission not found in current offerings." });
  if (outcome === "already-active") return res.status(400).json({ error: "Mission already accepted." });
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/abandon-mission", (req, res) => {
  const missionId = String(req.body?.missionId || "").trim();
  if (!missionId) return res.status(400).json({ error: "Missing missionId." });

  const account = mutateAccountState(req.params.accountId, (state) => {
    if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
    state.corp.activeMissions = state.corp.activeMissions.filter((m) => m.id !== missionId);
  });

  if (!account) return res.status(404).json({ error: "Account not found." });
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/complete-mission", (req, res) => {
  const missionId = String(req.body?.missionId || "").trim();
  if (!missionId) return res.status(400).json({ error: "Missing missionId." });

  let outcome = "ok";
  const account = mutateAccountState(req.params.accountId, (state) => {
    if (!Array.isArray(state.corp.activeMissions)) state.corp.activeMissions = [];
    const mission = state.corp.activeMissions.find((m) => m.id === missionId);
    if (!mission) { outcome = "not-active"; return; }
    if (!mission.quota) { outcome = "no-quota"; return; }

    const stationId = state.corp.currentStationId || "earth-station-prime";
    if (!state.corp.inventory) state.corp.inventory = {};
    if (!state.corp.inventory[stationId]) state.corp.inventory[stationId] = {};
    const stationInv = state.corp.inventory[stationId];

    const resource = mission.quota.resource || "";
    const required = mission.quota.amount || 0;
    const have = stationInv[resource] || 0;
    if (have < required) { outcome = "insufficient"; return; }

    // Deduct resources
    stationInv[resource] = have - required;
    if (stationInv[resource] <= 0) delete stationInv[resource];

    // Credit reward
    const rewardCredits = parseInt(String(mission.reward).replace(/[^0-9]/g, ""), 10);
    if (rewardCredits) {
      state.corp.credits = (state.corp.credits || 0) + rewardCredits;
    }

    // Remove from active
    state.corp.activeMissions = state.corp.activeMissions.filter((m) => m.id !== missionId);

    // Remove from current offerings so it doesn't reappear until next rotation
    if (state.corp.contractOfferings && Array.isArray(state.corp.contractOfferings.missions)) {
      state.corp.contractOfferings.missions = state.corp.contractOfferings.missions.filter((m) => m.id !== missionId);
    }

    // Record completion
    if (!Array.isArray(state.corp.completedMissions)) state.corp.completedMissions = [];
    state.corp.completedMissions.unshift({
      id: mission.id,
      title: mission.title,
      type: mission.type,
      agentId: mission.agentId || null,
      reward: mission.reward,
      completedAt: Date.now()
    });
    state.corp.completedMissions = state.corp.completedMissions.slice(0, 200);

    // Update agent reputation
    if (!state.corp.agentReputation || typeof state.corp.agentReputation !== "object") state.corp.agentReputation = {};
    const agentId = mission.agentId || "unknown";
    if (!state.corp.agentReputation[agentId]) state.corp.agentReputation[agentId] = { completedCount: 0 };
    state.corp.agentReputation[agentId].completedCount += 1;
  });

  if (!account) return res.status(404).json({ error: "Account not found." });
  if (outcome === "not-active") return res.status(400).json({ error: "Mission is not active." });
  if (outcome === "no-quota") return res.status(400).json({ error: "Mission has no quota to complete." });
  if (outcome === "insufficient") return res.status(400).json({ error: "Insufficient resources at this station." });
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/mine", (req, res) => {
  const amount = Math.max(10, Number(req.body?.amount || 40));
  const requestedHours = Math.max(1, Math.min(72, Number(req.body?.hours || 24)));
  const requestedExtractorId = String(req.body?.extractorId || "").trim();
  let outcome = "ok";
  let targetExtractorLabel = "";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const hasExtractor = corp.buildings.some((b) => b.name === "Basic Extractor Yard");
    const cycleHours = requestedHours;
    const throughputPerHour = Math.max(10, Math.min(250, amount));
    const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
    const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));

    if (!hasExtractor) {
      outcome = "missing-extractor";
      return;
    }

    if (!corp.mining || typeof corp.mining !== "object") {
      corp.mining = {};
    }
    if (!Array.isArray(corp.mining.silicateExtractors)) {
      corp.mining.silicateExtractors = [];
    }
    if (!corp.mining.silicateExtractors.length) {
      corp.mining.silicateExtractors.push({
        id: "ext-basic-1",
        name: "Basic Extractor Yard #1",
        tier: 1,
        active: false,
        startedAt: null,
        lastTickAt: null,
        endsAt: null,
        throughputPerHour: 0,
        operationCostPerHour: 0,
        totalMined: 0,
        totalSpent: 0,
        lastCompletedAt: null
      });
    }

    const extractorCycle = requestedExtractorId
      ? corp.mining.silicateExtractors.find((ex) => ex.id === requestedExtractorId)
      : corp.mining.silicateExtractors[0];
    targetExtractorLabel = extractorCycle?.name || requestedExtractorId || "Extractor";

    if (!extractorCycle) {
      outcome = "missing-extractor-target";
      return;
    }

    if (extractorCycle.active) {
      outcome = "already-active";
      return;
    }

    if (corp.finances.credits < startupCost) {
      outcome = "insufficient-credits";
      return;
    }

    const now = Date.now();
    corp.finances.credits -= startupCost;

    extractorCycle.active = true;
    extractorCycle.startedAt = now;
    extractorCycle.lastTickAt = now;
    extractorCycle.endsAt = now + cycleHours * 60 * 60 * 1000;
    extractorCycle.throughputPerHour = throughputPerHour;
    extractorCycle.operationCostPerHour = operationCostPerHour;
    extractorCycle.totalSpent += startupCost;

    // Keep legacy mirror for compatibility
    corp.mining.silicateExtractor = corp.mining.silicateExtractors[0];
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const throughputPerHour = Math.max(10, Math.min(250, amount));
    const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
    const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));
    const messageMap = {
      "missing-extractor": "Build a Basic Extractor Yard before mining.",
      "missing-extractor-target": "Selected extractor yard was not found.",
      "already-active": `${targetExtractorLabel} already has an active cycle. Wait for completion before launching another cycle on that yard.`,
      "insufficient-credits": fundingRequirementMessage(
        "Silicate extraction cycle launch",
        corp,
        startupCost,
        `Requested throughput: ${throughputPerHour}/hour over ${requestedHours} hours, with ${formatCredits(operationCostPerHour)}/hour operating spend.`
      )
    };
    res.status(400).json({ error: messageMap[outcome] || "Mining action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "operations",
    title: "Mining Cycle Started",
    body: `${targetExtractorLabel} started a ${requestedHours}h silicate cycle with current throughput settings.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/complete-rnd", (req, res) => {
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const techId = "tt-basic-extraction";
    const rdCost = 40000;

    if ((corp.unlockedTech || []).includes(techId)) {
      outcome = "already-unlocked";
      return;
    }

    if (corp.finances.credits < rdCost) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= rdCost;
    corp.unlockedTech.push(techId);
    corp.military.modifiers.rdBonusPct = Math.max(corp.military.modifiers.rdBonusPct || 0, 4);
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "already-unlocked": "This R&D project has already been completed.",
      "insufficient-credits": fundingRequirementMessage("Basic Extraction Analytics", corp, 40000)
    };
    res.status(400).json({ error: messageMap[outcome] || "R&D action failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "research",
    title: "R&D Completed",
    body: "Basic Extraction Analytics has been completed and applied."
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/queue-rnd", (req, res) => {
  const techId = String(req.body?.techId || "").trim();
  const tech = RESEARCH_LIBRARY[techId];
  let outcome = "ok";

  if (!tech) {
    res.status(400).json({ error: "Unknown research node." });
    return;
  }

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const queue = state.queues?.corporateRnD || [];
    const unlocked = new Set(corp.unlockedTech || []);
    const queued = new Set(queue.map((item) => item.techId).filter(Boolean));

    if (unlocked.has(tech.id)) {
      outcome = "already-unlocked";
      return;
    }

    if (queued.has(tech.id)) {
      outcome = "already-queued";
      return;
    }

    if (!tech.prereqs.every((prereq) => unlocked.has(prereq))) {
      outcome = "missing-prereq";
      return;
    }

    // Corp level gate for certain research
    if (tech.requiresCorpLevel && (corp.level || 0) < tech.requiresCorpLevel) {
      outcome = "corp-level-too-low";
      return;
    }

    // Tier 2+ requires all Tier 1 research to be completed
    if (tech.tier >= 2 && !TIER_1_TECH_IDS.every((id) => unlocked.has(id))) {
      outcome = "tier-gate";
      return;
    }

    if (corp.finances.credits < tech.costCredits) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= tech.costCredits;
    state.queues.corporateRnD.push({
      id: `rnd-${Date.now()}`,
      techId: tech.id,
      name: tech.name,
      effect: tech.effect,
      durationHours: IS_DEV ? 0 : tech.durationHours,
      startedAt: Date.now(),
      costCredits: tech.costCredits
    });
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "already-unlocked": `${tech.name} has already been completed.`,
      "already-queued": `${tech.name} is already in the corporate R&D queue.`,
      "missing-prereq": `${tech.name} requires: ${tech.prereqs.map((id) => RESEARCH_LIBRARY[id]?.name || id).join(", ")}.`,
      "corp-level-too-low": `${tech.name} requires Corp Level ${tech.requiresCorpLevel}.`,
      "tier-gate": `${tech.name} is Tier ${tech.tier} research. All Tier 1 research must be completed first.`,
      "insufficient-credits": fundingRequirementMessage(`${tech.name} queueing`, corp, tech.costCredits)
    };
    res.status(400).json({ error: messageMap[outcome] || "Unable to queue research." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "research",
    title: "R&D Queued",
    body: `${tech.name} has been queued in corporate research.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── CEO Insight ─────────────────────────────────────────────────────────────

app.post("/api/accounts/:accountId/gameplay/queue-ceo", (req, res) => {
  const programId = String(req.body?.programId || "").trim();
  const prog = CEO_INSIGHT_LIBRARY[programId];
  let outcome = "ok";

  if (!prog) {
    res.status(400).json({ error: "Unknown insight program." });
    return;
  }

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const queue = state.queues?.ceoInsight || [];
    const completed = corp.completedInsights || [];

    // Only one CEO Insight program can be in progress at a time
    if (queue.length > 0) {
      outcome = "queue-full";
      return;
    }

    // For multi-level programs, count completions towards max
    const completionCount = completed.filter((id) => id === prog.id).length;
    const maxLevels = prog.maxLevels || 1;

    if (completionCount >= maxLevels) {
      outcome = "max-level";
      return;
    }

    if (!prog.prereqs.every((prereq) => completed.includes(prereq))) {
      outcome = "missing-prereq";
      return;
    }

    if (corp.finances.credits < prog.costCredits) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= prog.costCredits;
    state.queues.ceoInsight.push({
      id: `ceo-${Date.now()}`,
      programId: prog.id,
      name: prog.name,
      effect: prog.effect,
      durationHours: IS_DEV ? 0 : prog.durationHours,
      startedAt: Date.now(),
      costCredits: prog.costCredits
    });
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "max-level": `${prog.name} is already at maximum level.`,
      "queue-full": "Only one CEO Insight program can be in progress at a time.",
      "missing-prereq": `${prog.name} requires: ${prog.prereqs.map((id) => CEO_INSIGHT_LIBRARY[id]?.name || id).join(", ")}.`,
      "insufficient-credits": fundingRequirementMessage(`${prog.name} enrollment`, corp, prog.costCredits)
    };
    res.status(400).json({ error: messageMap[outcome] || "Unable to enqueue insight program." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "insight",
    title: "CEO Insight Queued",
    body: `${prog.name} has been enrolled in the CEO Insight Program.`
  });
  if (notification) {
    io.emit("notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Messages ────────────────────────────────────────────────────────────────

app.get("/api/accounts/:accountId/messages", (req, res) => {
  const messages = listAccountMessages(req.params.accountId);
  if (!messages) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json({ messages });
});

// Specific named routes FIRST (before :messageId wildcards)
app.post("/api/accounts/:accountId/messages/send", (req, res) => {
  const { toCorpName, subject, body } = req.body ?? {};
  const result = sendPlayerMessage(req.params.accountId, {
    toCorpName: String(toCorpName || "").trim(),
    subject: String(subject || "").trim(),
    body: String(body || "").trim()
  });
  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }
  // Delete the draft if a draftId was provided
  if (req.body?.draftId) {
    deleteDraft(req.params.accountId, String(req.body.draftId));
  }
  const messages = listAccountMessages(req.params.accountId);
  res.json({ ok: true, toName: result.toName, messages });
});

app.post("/api/accounts/:accountId/messages/draft", (req, res) => {
  const { draftId, toCorpName, subject, body } = req.body ?? {};
  const draft = saveDraft(req.params.accountId, {
    draftId: draftId ? String(draftId).trim() : null,
    toCorpName: String(toCorpName || "").trim(),
    subject: String(subject || "").trim(),
    body: String(body || "").trim()
  });
  if (!draft) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json({ draft });
});

app.delete("/api/accounts/:accountId/messages/draft/:draftId", (req, res) => {
  const deleted = deleteDraft(req.params.accountId, req.params.draftId);
  res.json({ ok: deleted });
});

// Parameterised routes AFTER named routes
app.post("/api/accounts/:accountId/messages/:messageId/read", (req, res) => {
  const msg = markMessageRead(req.params.accountId, req.params.messageId);
  if (!msg) {
    res.status(404).json({ error: "Message not found." });
    return;
  }
  res.json({ message: msg });
});

app.post("/api/accounts/:accountId/messages/:messageId/move", (req, res) => {
  const folder = String(req.body?.folder || "").trim();
  const msg = moveMessage(req.params.accountId, req.params.messageId, folder);
  if (!msg) {
    res.status(400).json({ error: "Invalid folder or message not found." });
    return;
  }
  res.json({ message: msg });
});

app.post("/api/market/orders", requireAuth, (req, res) => {
  const { type, item, quantity, unitPrice } = req.body ?? {};

  const account = getAccountById(req.auth.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (!type || !item || !quantity || !unitPrice || type !== "sell") {
    res.status(400).json({ error: "Missing required order fields." });
    return;
  }

  const normalizedQty = Math.max(1, Number(quantity));
  const normalizedUnitPrice = Math.max(1, Number(unitPrice));

  let rejectReason = "";
  const updatedSeller = mutateAccountState(req.auth.accountId, (state) => {
    const stationId = state.corp.currentStationId || "earth-station-prime";
    const inventory = getStationInventory(state.corp, stationId);
    const available = Number(inventory[item] || 0);
    if (available < normalizedQty) {
      rejectReason = "Quantity exceeds available inventory at this station.";
      return;
    }

    inventory[item] = available - normalizedQty;
    if (inventory[item] <= 0) {
      delete inventory[item];
    }

    if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
    state.corp.tradeHistory.unshift({
      id: `th-${Date.now()}`,
      type: "listed",
      item,
      quantity: normalizedQty,
      unitPrice: normalizedUnitPrice,
      total: normalizedQty * normalizedUnitPrice,
      counterparty: "Market",
      at: Date.now()
    });
    state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
  });

  if (!updatedSeller || rejectReason) {
    res.status(400).json({ error: rejectReason || "Unable to create sell order." });
    return;
  }

  const order = {
    id: `ord-${Date.now()}`,
    type,
    item,
    quantity: normalizedQty,
    unitPrice: normalizedUnitPrice,
    seller: updatedSeller.state?.corp?.corporationName || updatedSeller.email || "Anonymous",
    sellerAccountId: updatedSeller.id,
    createdAt: Date.now()
  };

  mutateState((draft) => {
    draft.market.orderBook.unshift(order);
    draft.market.orderBook = draft.market.orderBook.slice(0, 200);
  });

  io.emit("market:updated", getState().market);
  res.json({ ok: true, order, account: updatedSeller });
});

app.post("/api/market/orders/:orderId/buy", requireAuth, (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const requestedQty = Math.max(1, Number(req.body?.quantity || 1));
  const normalizeIdentity = (value) => String(value || "").trim().toLowerCase();

  const buyerAccount = getAccountById(req.auth.accountId);
  if (!buyerAccount) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  const market = getState().market;
  const order = (market.orderBook || []).find((entry) => entry.id === orderId && entry.type === "sell");
  if (!order) {
    res.status(404).json({ error: "Sell order not found." });
    return;
  }

  if (requestedQty > Number(order.quantity || 0)) {
    res.status(400).json({ error: "Requested quantity exceeds available sell order volume." });
    return;
  }

  const buyerCorpName = normalizeIdentity(buyerAccount.state?.corp?.corporationName);
  const buyerEmail = normalizeIdentity(buyerAccount.email);
  const sellerName = normalizeIdentity(order.seller);
  const isOwnOrderByAccount = Boolean(order.sellerAccountId) && order.sellerAccountId === req.auth.accountId;
  const isOwnOrderByIdentity = !order.sellerAccountId && Boolean(sellerName) && (sellerName === buyerCorpName || sellerName === buyerEmail);

  if (isOwnOrderByAccount || isOwnOrderByIdentity) {
    res.status(400).json({ error: "You cannot buy your own sell order." });
    return;
  }

  const tradeQuantity = requestedQty;
  const tradeTotal = tradeQuantity * Number(order.unitPrice || 0);
  let rejectReason = "";

  const buyer = mutateAccountState(req.auth.accountId, (state) => {
    const corp = state.corp;
    if (Number(corp.finances.credits || 0) < tradeTotal) {
      rejectReason = "Insufficient credits to execute this buy order.";
      return;
    }

    corp.finances.credits -= tradeTotal;
    const buyerStationId = corp.currentStationId || "earth-station-prime";
    const buyerInv = getStationInventory(corp, buyerStationId);
    buyerInv[order.item] = (buyerInv[order.item] || 0) + tradeQuantity;

    if (!Array.isArray(corp.tradeHistory)) corp.tradeHistory = [];
    corp.tradeHistory.unshift({
      id: `th-${Date.now()}`,
      type: "bought",
      item: order.item,
      quantity: tradeQuantity,
      unitPrice: Number(order.unitPrice || 0),
      total: tradeTotal,
      counterparty: order.seller || "Unknown",
      at: Date.now()
    });
    corp.tradeHistory = corp.tradeHistory.slice(0, 200);
  });

  if (!buyer || rejectReason) {
    res.status(400).json({ error: rejectReason || "Unable to execute buy order." });
    return;
  }

  if (order.sellerAccountId) {
    mutateAccountState(order.sellerAccountId, (state) => {
      const taxPct = getEffectiveExchangeTaxRate(state);
      const taxAmount = Math.round(tradeTotal * taxPct / 100);
      const sellerProceeds = tradeTotal - taxAmount;
      state.corp.finances.credits += sellerProceeds;
      state.corp.finances.dailyRevenue += Math.round(sellerProceeds / 24);

      if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
      state.corp.tradeHistory.unshift({
        id: `th-${Date.now() + 1}`,
        type: "sold",
        item: order.item,
        quantity: tradeQuantity,
        unitPrice: Number(order.unitPrice || 0),
        total: tradeTotal,
        taxPct,
        taxAmount,
        proceeds: sellerProceeds,
        counterparty: buyerAccount.state?.corp?.corporationName || buyerAccount.email || "Anonymous",
        at: Date.now()
      });
      state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
    });
  }

  mutateState((draft) => {
    const target = draft.market.orderBook.find((entry) => entry.id === orderId && entry.type === "sell");
    if (!target) {
      return;
    }
    target.quantity = Math.max(0, Number(target.quantity || 0) - tradeQuantity);
    if (target.quantity <= 0) {
      draft.market.orderBook = draft.market.orderBook.filter((entry) => entry.id !== target.id);
    }
  });

  io.emit("market:updated", getState().market);
  res.json({
    ok: true,
    traded: {
      orderId,
      item: order.item,
      quantity: tradeQuantity,
      unitPrice: Number(order.unitPrice || 0),
      total: tradeTotal
    },
    account: buyer
  });
});

// ─── Sell player resources into an NPC standing buy order ────────────────────
app.post("/api/market/npc-orders/:orderId/sell", requireAuth, (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const requestedQty = Math.max(1, Math.floor(Number(req.body?.quantity || 1)));

  checkAndResetNpcBuyOrders();

  const npcOrder = (getState().market?.npcBuyOrders || []).find((o) => o.id === orderId);
  if (!npcOrder) {
    res.status(404).json({ error: "Standing buy order not found." });
    return;
  }

  if (npcOrder.remainingQty <= 0) {
    res.status(400).json({ error: "This order has been fully filled for today. It resets at midnight EST." });
    return;
  }

  if (requestedQty > npcOrder.remainingQty) {
    res.status(400).json({ error: `Only ${Number(npcOrder.remainingQty).toLocaleString()} units remaining in today's order.` });
    return;
  }

  const tradeTotal = requestedQty * npcOrder.unitPrice;
  let rejectReason = "";
  let tradeTaxPct = 0;
  let tradeTaxAmount = 0;
  let tradeProceeds = tradeTotal;

  const seller = mutateAccountState(req.auth.accountId, (state) => {
    const npcStationId = state.corp.currentStationId || "earth-station-prime";
    const inventory = getStationInventory(state.corp, npcStationId);
    const available = Number(inventory[npcOrder.item] || 0);
    if (available < requestedQty) {
      rejectReason = `Insufficient ${npcOrder.item} at this station (have ${available.toLocaleString()}, need ${requestedQty.toLocaleString()}).`;
      return;
    }

    inventory[npcOrder.item] = available - requestedQty;
    if (inventory[npcOrder.item] <= 0) delete inventory[npcOrder.item];

    const taxPct = getEffectiveExchangeTaxRate(state);
    const taxAmount = Math.round(tradeTotal * taxPct / 100);
    const sellerProceeds = tradeTotal - taxAmount;
    tradeTaxPct = taxPct;
    tradeTaxAmount = taxAmount;
    tradeProceeds = sellerProceeds;
    state.corp.finances.credits = (state.corp.finances.credits || 0) + sellerProceeds;
    state.corp.finances.dailyRevenue = (state.corp.finances.dailyRevenue || 0) + Math.round(sellerProceeds / 24);

    if (!state.corp.stats) state.corp.stats = {};
    state.corp.stats.silicateSoldOnExchange = (Number(state.corp.stats.silicateSoldOnExchange) || 0) + requestedQty;

    if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
    state.corp.tradeHistory.unshift({
      id: `th-${Date.now()}`,
      type: "sold-npc",
      item: npcOrder.item,
      quantity: requestedQty,
      unitPrice: npcOrder.unitPrice,
      total: tradeTotal,
      taxPct,
      taxAmount,
      proceeds: sellerProceeds,
      counterparty: npcOrder.buyer,
      at: Date.now()
    });
    state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
  });

  if (!seller || rejectReason) {
    res.status(400).json({ error: rejectReason || "Trade failed." });
    return;
  }

  mutateState((draft) => {
    const target = (draft.market.npcBuyOrders || []).find((o) => o.id === orderId);
    if (target) {
      target.remainingQty = Math.max(0, target.remainingQty - requestedQty);
    }
  });

  io.emit("market:updated", getState().market);
  res.json({
    ok: true,
    traded: { orderId, item: npcOrder.item, quantity: requestedQty, unitPrice: npcOrder.unitPrice, total: tradeTotal, taxPct: tradeTaxPct, taxAmount: tradeTaxAmount, proceeds: tradeProceeds },
    account: seller
  });
});

app.post("/api/investments", requireAuth, (req, res) => {
  const { targetCorp, amount, instrument } = req.body ?? {};

  if (!targetCorp || !amount || !instrument) {
    res.status(400).json({ error: "Missing investment fields." });
    return;
  }

  const investment = {
    id: `inv-${Date.now()}`,
    targetCorp,
    amount: Number(amount),
    instrument,
    createdAt: Date.now()
  };

  let rejectReason = "";

  const account = mutateAccountState(req.auth.accountId, (state) => {
    const draft = state;
    const spend = Number(amount);

    if (Number(draft.corp.level || 0) < DIRECT_INVESTMENT_UNLOCK_LEVEL) {
      rejectReason = `Direct investments unlock at Corporation Level ${DIRECT_INVESTMENT_UNLOCK_LEVEL}.`;
      return;
    }

    if (draft.corp.finances.credits < spend) {
      rejectReason = "Insufficient credits to place investment.";
      return;
    }

    if (!draft.corp.investments) {
      draft.corp.investments = [];
    }

    draft.corp.investments.unshift(investment);
    draft.corp.finances.credits -= spend;
  });

  if (!account || rejectReason) {
    res.status(400).json({ error: rejectReason || "Investment request rejected." });
    return;
  }

  io.emit("finance:updated", account.state.corp.finances);
  res.json({ ok: true, investment, account });
});

app.post("/api/combat/simulate", (req, res) => {
  const {
    attackerName,
    attackerAttack,
    attackerDefense,
    defenderName,
    defenderAttack,
    defenderDefense,
    counterModifier = 1
  } = req.body ?? {};

  const atkTotal = Number(attackerAttack) + Number(attackerDefense);
  const defTotal = (Number(defenderAttack) + Number(defenderDefense)) * Number(counterModifier);
  const attackerWin = atkTotal >= defTotal;

  const report = createCombatReport({
    attackerName,
    defenderName,
    attackerPower: atkTotal,
    defenderPower: defTotal,
    counterModifier: Number(counterModifier),
    winner: attackerWin ? attackerName : defenderName,
    summary: attackerWin
      ? `${attackerName} overwhelms ${defenderName} after modifiers.`
      : `${defenderName} holds position and repels ${attackerName}.`
  });

  io.emit("combat:newReport", report);
  res.json({ ok: true, report });
});

app.use((error, _req, res, _next) => {
  console.error("[http] unhandled route error", error);
  res.status(500).json({ error: "Internal server error." });
});

io.on("connection", (socket) => {
  socket.emit("state:init", getState());

  socket.on("chat:send", (payload) => {
    const content = stripHtml(payload?.content || "");
    if (!content) {
      return;
    }

    const message = {
      id: `msg-${Date.now()}`,
      channel: payload?.channel || "global",
      author: stripHtml(payload?.author || "Anonymous") || "Anonymous",
      content,
      createdAt: Date.now()
    };

    appendChatMessage(message.channel, message);
    io.emit("chat:new", message);
  });

  socket.on("disconnect", () => {
    // Placeholder for future presence tracking and local system channel cleanup.
  });
});

const port = Number(process.env.PORT || 3000);
if (!process.env.VERCEL) {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`ISP prototype server running on http://localhost:${port}`);
  });

  // Flush pending debounced saves on graceful shutdown (e.g. node --watch restart)
  function onShutdown() {
    saveAccountsNow();
    process.exit(0);
  }
  process.on("SIGTERM", onShutdown);
  process.on("SIGINT", onShutdown);
}

export default app;
