import "./loadEnv.js";
import express from "express";
import kanbanRouter from "./kanban.js";
import { resolveJwtSecret } from "./jwtSecret.js";
import { bodyNumber } from "./bodyNumber.js";
import { bodyCount } from "./bodyNumber.js";
import { marketView } from "./marketView.js";
import { forumsView, postView, threadView, UNNAMED_CORPORATION } from "./publicViews.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { SYSTEM_SENDERS } from "./corporationName.js";
import jwt from "jsonwebtoken";
import { resolveLeaseBody } from "./leases.js";
import { isInsightProgramLive, officeRenewalCost, missionRewardCredits } from "../public/scripts/ceoEffects.js";
import { officeLeaseCost, OFFICE_TERMS_DAYS } from "../public/scripts/ceoEffects.js";
import { canReachSystem, leaseFilingRefusal } from "../public/scripts/navigation.js";
import {
  accountExists,
  addAccountNotification,
  appendChatMessage,
  createAccount,
  saveAccountsNow,
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
  findCorporations,
  saveDraft,
  deleteDraft,
  addSystemMessageToAccount,
  getEffectiveExchangeTaxRate,
  CEO_INSIGHT_LIBRARY,
  applyRefineryOperations,
  REFINERY_CHAINS,
  MISSION_TEMPLATES,
  refreshContractOfferings,
  SYSTEM_DETAILS
} from "./gameState.js";

// TODO(AB#737): Move this to a single file so that we aren't redefining it everywhere
const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV !== "production";

// TODO(AB#1049): This should be extracted from the DB or from research.json
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

// ── System adjacency graph (for hop-distance calculation) ──
// TODO(AB#804): Store in DB
const SYSTEM_ADJACENCY = {
  "sol":              ["alpha-centauri", "barnards-star"],
  "alpha-centauri":   ["sol", "wolf-359"],
  "barnards-star":    ["sol", "tau-ceti"],
  "wolf-359":         ["alpha-centauri", "tau-ceti", "epsilon-eridani"],
  "tau-ceti":         ["barnards-star", "wolf-359", "epsilon-eridani"],
  "epsilon-eridani":  ["wolf-359", "tau-ceti"]
};

function getSystemHops(fromId, toId) {
  if (fromId === toId) return 0;
  const visited = new Set([fromId]);
  let frontier = [fromId];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const next = [];
    for (const sys of frontier) {
      for (const neighbor of SYSTEM_ADJACENCY[sys] || []) {
        if (neighbor === toId) return depth;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return 99; // unreachable fallback
}

// ── Planet ordering within each system (for intra-system hop distance) ──
// Only planets/fields count as "orbital positions"; moons inherit their parent's index.
const BODY_ORBITAL_INDEX = {}; // bodyName → positional index within its system
const BODY_PARENT = {};        // moonName → parentPlanetName
const _earlyDir = path.dirname(fileURLToPath(import.meta.url));
/** The body catalog. Also what a mining lease is resolved against (server/leases.js, Bug #691). */
const SYSTEMS_CATALOG = JSON.parse(fs.readFileSync(path.join(_earlyDir, "..", "data", "systems.json"), "utf8"));
for (const sys of SYSTEMS_CATALOG) {
  let idx = 0;
  for (const b of sys.bodies) {
    if (b.type === "Moon") {
      BODY_PARENT[b.name] = sys.bodies.find(p => p.id === b.parentId)?.name || b.name;
    } else {
      BODY_ORBITAL_INDEX[b.name] = idx;
      idx++;
    }
  }
}

// Travel time in ms between two stations
function getTravelTimeMs(fromId, toId) {
  const from = STATION_REGISTRY[fromId];
  const to = STATION_REGISTRY[toId];
  if (!from || !to) return 0;

  if (IS_DEV) return 5 * 1000; // 5 seconds in dev

  // Same body: 1 minute
  if (from.body === to.body) return 1 * 60 * 1000;

  // Resolve to parent planet if the body is a moon
  const fromPlanet = BODY_PARENT[from.body] || from.body;
  const toPlanet = BODY_PARENT[to.body] || to.body;

  if (from.systemId === to.systemId) {
    // Planet ↔ its own moon: 3 minutes
    if (fromPlanet === to.body || toPlanet === from.body || fromPlanet === toPlanet) {
      // One is a moon of the other, or both orbit the same planet
      const isMoonHop = (from.body !== fromPlanet || to.body !== toPlanet);
      if (isMoonHop && fromPlanet === toPlanet) return 3 * 60 * 1000;
    }

    // Different planets in the same system: 10 min base + 5 min per extra hop
    const fromIdx = BODY_ORBITAL_INDEX[fromPlanet];
    const toIdx = BODY_ORBITAL_INDEX[toPlanet];
    if (fromIdx !== undefined && toIdx !== undefined) {
      const hops = Math.abs(toIdx - fromIdx);
      return (10 + hops * 5) * 60 * 1000; // 10 + 5n minutes
    }
    return 10 * 60 * 1000; // fallback
  }

  // Different systems: 1 hr per hop along the adjacency graph
  const hops = getSystemHops(from.systemId, to.systemId);
  return Math.max(1, hops) * 60 * 60 * 1000;
}

// Interstellar travel time (system-to-system, no station context)
function getInterstellarTravelTimeMs(fromSystemId, toSystemId) {
  if (IS_DEV) return 5 * 1000;
  const hops = getSystemHops(fromSystemId, toSystemId);
  return Math.max(1, hops) * 60 * 60 * 1000;
}

const ACCESS_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const DUMMY_ACCESS_TOKEN_SECONDS = IS_DEV ? 7 * 24 * 60 * 60 : 2 * 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
// The developer surface (the shared demo account's login and reset, and the kanban board) exists only when the
// environment asks for it: ISP_DEV=1, and never in production. It used to be a literal true, so it was live on every
// server (Bug #423, Bug #1069). Unset, the routes are not registered at all.
const DEV_SURFACE = process.env.ISP_DEV === "1" && process.env.NODE_ENV !== "production";
// Refuses to start without a real secret, except on the dev surface (Bug #589: it fell back to a string in the source).
const JWT_SECRET = resolveJwtSecret(process.env, { devSurface: DEV_SURFACE });

/** How many sell listings one seller may have open at once (Bug #425). */
const MAX_OPEN_LISTINGS = 50;

/** Characters in one chat line: the chat input's maxlength (Bug #1127). */
const CHAT_MAX_LENGTH = 300;

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

/**
 * Verify an access token. Returns { accountId } or { error }. The one check behind both HTTP routes (requireAuth)
 * and sockets (io.use, Bug #710), so the two cannot drift apart.
 */
function verifyAccessToken(token) {
  if (!token) return { error: "Missing bearer token." };
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.kind !== "access") return { error: "Invalid token type." };
    return { accountId: payload.sub };
  } catch {
    return { error: "Invalid or expired access token." };
  }
}

function requireAuth(req, res, next) {
  const verified = verifyAccessToken(getBearerToken(req));
  if (!verified.accountId) {
    res.status(401).json({ error: verified.error });
    return;
  }
  req.auth = { accountId: verified.accountId };
  next();
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
    `Current reserves: ${formatCredits(corp.finances.credits)}.` // Bug #1201: formatCredits already says "credits"
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
// AB#735: responses do not name the framework they come from.
app.disable("x-powered-by");
const server = http.createServer(app);
// Bug #710: sockets were open to every origin. The game is served by this same server, so same-origin needs no CORS
// at all; ISP_APP_ORIGIN (comma-separated) names any other origin allowed in. Unset means none: fail closed.
const SOCKET_ORIGINS = String(process.env.ISP_APP_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
const io = new Server(server, {
  cors: {
    origin: SOCKET_ORIGINS.length ? SOCKET_ORIGINS : false
  }
});

process.on("uncaughtException", (error) => {
  console.error("[fatal] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "public")));
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
  emitMarketUpdated();
}

// Check on startup and every minute thereafter
checkAndResetNpcBuyOrders();
if (!process.env.ISP_DISABLE_TICKERS) setInterval(checkAndResetNpcBuyOrders, 60_000);

// ─── R&D auto-completion tick ────────────────────────────────────────────────
// ─── Mining tick: process downtime, recovery, and mining progress ─────────────
import { startExtractorCycle } from "./gameState.js"; // AB#575
import { applyMiningOperations, getStationInventory } from "./gameState.js";
import { applyAsteroidExpeditions, BELT_COMPOSITIONS, EXPEDITION_DURATIONS, EXPEDITION_LAUNCH_COST, PROBE_BUILD_COST, PROBE_ASSET_VALUE, PROBE_FABRICATION_MS, BASE_MAX_PROBES, BASE_MAX_DEPLOYMENTS } from "./gameState.js";

// Bug #1097: payroll is settled on this same 5-second tick, for every account, online or not.
import { settleAccountPayroll } from "./gameState.js";

function miningTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    settleAccountPayroll(accountId, now);
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyMiningOperations(state.corp, now);
        emitToAccount(accountId, "mining:updated", {
          accountId,
          extractors: state.corp.mining?.silicateExtractors || [],
          inventory: state.corp.inventory || {},
          credits: state.corp.finances?.credits ?? 0
        });
      }
    });
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(miningTick, 5000); // Every 5 seconds

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

if (!process.env.ISP_DISABLE_TICKERS) setInterval(refineryTick, 10_000); // Every 10 seconds

// ─── Asteroid expedition tick ────────────────────────────────────────────────
// TODO(AB#729): Consider implementation of unified tick system where all tick based actions are performed at once, rather than a separate ticker calculation
//       for each function.
function asteroidExpeditionTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let corpName = "";
    let completedExpeditions = [];
    mutateAccountState(accountId, (state) => {
      if (!state?.corp) return;
      corpName = state.corp.corporationName || "";
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
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }

      // Send detailed expedition report to inbox
      const beltId = exp.beltKey.split(":")[1] || "asteroid belt";
      const beltLabel = beltId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const systemLabel = (exp.systemId || "sol").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const stationName = STATION_REGISTRY[exp.depositStationId]?.name || exp.depositStationId || "nearest station";
      const durationLabel = EXPEDITION_DURATIONS[exp.duration]?.label || exp.duration;
      const yieldLines = Object.entries(exp.yields || {});
      const yieldBlock = yieldLines.length
        ? yieldLines.map(([r, q]) => `  ${String(q).padStart(6)} units — ${r}`).join("\n")
        : "  No recoverable material extracted.";
      const totalUnits = yieldLines.reduce((sum, [, q]) => sum + q, 0);
      const refNo = `MPR-${(exp.systemId || "sol").slice(0, 3).toUpperCase()}-${String(exp.completedAt || Date.now()).slice(-8)}`;

      addSystemMessageToAccount(accountId, {
        subject: `Mining Probe Return — ${beltLabel} [${refNo}]`,
        fromName: SYSTEM_SENDERS.MINERAL_SURVEY,
        body:
          `Attn: ${corpName || "Registered Operator"},\n\n` +
          `This report confirms the return of one (1) mining probe from the ${beltLabel} asteroid field, ${systemLabel} system. ` +
          `The probe completed a ${durationLabel} operation and has been recovered intact.\n\n` +
          `RECOVERED MATERIAL MANIFEST\n` +
          `${"─".repeat(40)}\n` +
          `${yieldBlock}\n` +
          `${"─".repeat(40)}\n` +
          `  Total: ${totalUnits} units\n\n` +
          `All extracted material has been deposited into your registered inventory at ${stationName}. Standard ISA handling fees have been waived under current extraction licence terms.\n\n` +
          `Probe status: Operational. Returned to available inventory.\n\n` +
          `This record is filed under your active extraction licence and may be subject to ISA audit. Retain for your records.\n\n` +
          `Ref: ${refNo}\nISA Mineral Survey Division — ${systemLabel} Sector Office`
      });
    }

    if (completedExpeditions.length > 0) {
      emitToAccount(accountId, "expedition:completed", { accountId });
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(asteroidExpeditionTick, 10_000); // Every 10 seconds

// ─── Fabrication queue tick ──────────────────────────────────────────────────
function fabricationTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completed = false;
    mutateAccountState(accountId, (state) => {
      if (!state?.corp?.asteroidMining?.fabricationQueue?.length) return;
      const am = state.corp.asteroidMining;
      const done = am.fabricationQueue.filter(j => now >= j.completesAt);
      if (!done.length) return;

      for (const job of done) {
        if (job.type === "mining-probe") {
          am.probeCount = (am.probeCount || 0) + 1; // the gate already counted it against the Fleet Cap
          state.corp.finances.assets = (state.corp.finances.assets || 0) + PROBE_ASSET_VALUE;
        }
      }
      am.fabricationQueue = am.fabricationQueue.filter(j => now < j.completesAt);
      completed = true;
    });

    if (completed) {
      const notification = addAccountNotification(accountId, {
        type: "infrastructure",
        title: "Mining Probe Fabricated",
        body: "A new Mining Probe has been manufactured and is ready for deployment."
      });
      if (notification) emitToAccount(accountId, "notifications:new", { accountId, notification });
      emitToAccount(accountId, "fabrication:completed", { accountId });
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(fabricationTick, 5_000); // Every 5 seconds

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
        emitToAccount(accountId, "travel:arrived", { accountId, systemId: travelResult.systemId });
      } else {
        const station = STATION_REGISTRY[travelResult.stationId];
        if (station) {
          notification = addAccountNotification(accountId, {
            type: "travel",
            title: "Docking Complete",
            body: `Your ship has arrived at ${station.name} (${station.body}, ${station.systemId.toUpperCase()}).`
          });
          emitToAccount(accountId, "travel:arrived", { accountId, stationId: travelResult.stationId });
        }
      }
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(travelTick, 5000); // Every 5 seconds

function processRndCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.corporateRnD;
      if (!Array.isArray(queue) || queue.length === 0) return;

      completedItems = queue.filter((item) => {
        const startedAt = Number(item?.startedAt || 0);
        const durationHours = Number(item?.durationHours ?? NaN);
        if (!startedAt || !Number.isFinite(durationHours) || durationHours < 0) {
          return false;
        }
        return now >= startedAt + durationHours * 3_600_000;
      });
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

    emitToAccount(accountId, "rnd:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "research",
        title: "R&D Complete",
        body: `${item.name} has been completed and applied to your corporation.`
      });
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(processRndCompletions, 5_000);

function processCeoInsightCompletions() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let completedItems = [];

    mutateAccountState(accountId, (state) => {
      const queue = state.queues?.ceoInsight;
      if (!Array.isArray(queue) || queue.length === 0) return;

      completedItems = queue.filter((item) => {
        const startedAt = Number(item?.startedAt || 0);
        const durationHours = Number(item?.durationHours ?? NaN);
        if (!startedAt || !Number.isFinite(durationHours) || durationHours < 0) {
          return false;
        }
        return now >= startedAt + durationHours * 3_600_000;
      });
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

    emitToAccount(accountId, "ceo:completed", { accountId });

    for (const item of completedItems) {
      const notification = addAccountNotification(accountId, {
        type: "insight",
        title: "CEO Insight Complete",
        body: `${item.name} has been completed.`
      });
      if (notification) {
        emitToAccount(accountId, "notifications:new", { accountId, notification });
      }
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) setInterval(processCeoInsightCompletions, 5_000);

import { refreshDailyExpenses } from "./finances.js"; // Bug #1022 (placed apart from the import below, which parallel PRs append to)

// ─── Financial snapshot tick ─────────────────────────────────────────────────
// Captures a rolling balance/flow snapshot for every active corp so the
// Financial Core dashboard can render real historical series (cash reserves,
// net flow, assets vs liabilities) instead of synthesised projections.
import { buildSnapshot, pushSnapshot, recordIncome, recordExpense, refreshDailyRevenue } from "./finances.js";
import { fleetStatus } from "./gameState.js"; // Bug #586

const FINANCIAL_SNAPSHOT_INTERVAL_MS = 30_000;

function financialSnapshotTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    let finances = null;
    mutateAccountState(accountId, (state) => {
      if (!state || !state.corp) return;
      refreshDailyRevenue(state.corp, now); // Bug #984: income older than 24 hours leaves the daily figure
      refreshDailyExpenses(state.corp, now); // Bug #1022: and so do costs
      const snap = buildSnapshot(state.corp, now, getState().market);
      pushSnapshot(state.corp, snap);
      finances = state.corp.finances;
    });
    if (finances) {
      // Reuse the existing finance:updated channel so clients refresh their snapshot-driven dashboard. Only this
      // account's sockets get it, with the account id so the client can check it (Bug #1021).
      emitToAccount(accountId, "finance:updated", { accountId, finances });
    }
  }
}

if (!process.env.ISP_DISABLE_TICKERS) {
  setInterval(financialSnapshotTick, FINANCIAL_SNAPSHOT_INTERVAL_MS);
}

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
  res.json({ ...sharedStateView(viewer), version: APP_VERSION });
});

app.get("/api/stations", (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "data", "stations.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: "Stations data unavailable." });
  }
});

// The CEO Insight catalogue, with each program's live or planned status: the client's only copy (Bug #983).
app.get("/api/ceo-insight", (_req, res) => {
  res.json({ programs: Object.values(CEO_INSIGHT_LIBRARY) });
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
      res.status(400).json(result.code ? { error: result.error, code: result.code } : { error: result.error });
      return;
    }

    const account = result.account;
    const tokens = issueTokens(account.id);
    res.status(201).json({ account, ...tokens });
  } catch (error) {
    console.error("[auth/register]", error);
    res.status(500).json({ error: "Registering failed on our side. Try again in a minute." });
  }
});

if (DEV_SURFACE) {
  app.post("/api/auth/dummy-login", (_req, res) => {
    const account = getDummyAccount();
    const tokens = issueTokens(account.id);
    res.json({ account, ...tokens });
  });

  app.post("/api/auth/dummy-reset", (_req, res) => {
    const account = resetDummyAccountProgress();
    if (!account) {
      res.status(404).json({ error: "Dummy account not found." });
      return;
    }

    res.json(account);
  });
}

// POST /api/dev/set-credits is gone (Bug #423): it set any corporation's balance for anyone, and a credit-granting
// route has no safe form in a shared economy. Tests set credits through gameState's mutateAccountState.

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
    res.status(500).json({ error: "Logging in failed on our side. Try again in a minute." });
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

// AB#731: every gameplay route's numbers and ids are checked against server/gameplayInput.js here, after the login and
// ownership checks and before any handler, so a refused request has touched nothing. Imported beside its one use.
import { gameplayInputMiddleware, ACCOUNT_INPUT, MARKET_INPUT, FORUM_INPUT } from "./gameplayInput.js";
import { FORUM_CATEGORIES } from "./gameState.js";
const REFINERY_CHAINS_DATA_FOR_INPUT = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "refinery-chains.json"), "utf8"));
const INPUT_CHECKS = {
  catalogs: {
    stations: new Set(Object.keys(STATION_REGISTRY)),
    systems: new Set(Object.keys(SYSTEM_DETAILS)),
    leaseBodies: new Set(SYSTEMS_CATALOG.flatMap((s) => (s.bodies || []).filter((b) => Number(b.leaseCost) > 0).flatMap((b) => [b.name, b.id])).map((x) => String(x).toLowerCase())),
    techs: new Set(Object.keys(RESEARCH_LIBRARY)),
    programs: new Set(Object.keys(CEO_INSIGHT_LIBRARY)),
    missions: new Set(MISSION_TEMPLATES.map((m) => m.id)),
    belts: new Set(Object.keys(BELT_COMPOSITIONS)),
    expeditionDurations: new Set(Object.keys(EXPEDITION_DURATIONS)),
    refineryChains: new Set(Object.keys(REFINERY_CHAINS)),
    // AB#732: what can be listed or charted (every raw resource and refinery output), standing orders, forum categories.
    tradeItems: new Set([...REFINERY_CHAINS_DATA_FOR_INPUT.resourceCatalog, ...REFINERY_CHAINS_DATA_FOR_INPUT.chains.flatMap((c) => [c.input, ...c.outputs.map((o) => o.item)])]),
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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

// Bug #1058: refusals that say what to do next. Imported beside their first use, away from the import block.
import { employeeCapMessage, miningCreditsAdvice, missionShortMessage, LEVELS } from "./nextStep.js";

app.post("/api/accounts/:accountId/gameplay/hire", (req, res) => {
  const count = bodyNumber(req.body?.count, { fallback: 1, min: 1, integer: true });
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
      "no-capacity": employeeCapMessage(corp, LEVELS),
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/rent-office", (req, res) => {
  const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
  const durationDays = OFFICE_TERMS_DAYS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
  const officeCost = officeLeaseCost(durationDays); // Bug #1032: the figure the Suites panel quotes
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
    recordExpense(corp, "office-rent", officeCost); // Bug #1022
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Orbital Executive Suites: Renew an office lease ───────────────────────
app.post("/api/accounts/:accountId/gameplay/renew-office", (req, res) => {
  const requestedStationId = String(req.body?.stationId || "earth-station-prime").trim();
  const durationDays = OFFICE_TERMS_DAYS.includes(Number(req.body?.durationDays)) ? Number(req.body.durationDays) : 7;
  // Priced inside the mutation: the CEO program that discounts it is part of the corporation's state (Bug #983).
  let renewalCost = officeRenewalCost([], durationDays);
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
    renewalCost = officeRenewalCost(corp.completedInsights, durationDays);
    if (corp.finances.credits < renewalCost) {
      outcome = "insufficient-credits";
      return;
    }
    corp.finances.credits -= renewalCost;
    recordExpense(corp, "office-rent", renewalCost); // Bug #1022
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── ISA Claims & Leases Division: Purchase a mining lease ─────────────────
app.post("/api/accounts/:accountId/gameplay/purchase-lease", (req, res) => {
  // Bug #691: the body is resolved against data/systems.json, which holds the only lease prices. Unknown bodies,
  // unpriced bodies, unreachable systems, markup and oversized strings are refused before any state changes, and
  // from here on only the catalog's own name is used: in the lease, the error messages and the notification.
  let requestedBody = null;
  let leaseCost = 0;
  let bodyError = null;
  const EMPLOYEES_PER_LEASE = 5;
  let outcome = "ok";
  let existingLeaseOnBody = false;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    // Resolved against the corporation itself, because reachability depends on its research and location.
    const resolved = resolveLeaseBody(SYSTEMS_CATALOG, corp, req.body?.body);
    if (!resolved.ok) {
      outcome = "invalid-body";
      bodyError = resolved.error;
      return;
    }
    requestedBody = resolved.body;
    leaseCost = resolved.cost;

    // AB#1061: filed at the station that orbits the body, as the claims office offers it; in transit, nowhere.
    const stationRefusal = leaseFilingRefusal(STATION_REGISTRY, corp.currentStationId || null, requestedBody);
    if (stationRefusal) {
      outcome = "invalid-body";
      bodyError = stationRefusal;
      return;
    }

    const hasOffice = Array.isArray(corp.offices) && corp.offices.length > 0;
    if (!hasOffice) {
      outcome = "no-office";
      return;
    }

    if (!Array.isArray(corp.miningLeases)) corp.miningLeases = [];

    // Case-insensitive, so a lease stored before Bug #691 as "mars" still blocks a second one on Mars.
    existingLeaseOnBody = corp.miningLeases.some((l) => String(l.body || l).toLowerCase() === requestedBody.toLowerCase());
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
      "invalid-body": bodyError,
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  // Commit to disk immediately — critical state that must survive server restarts.
  saveAccountsNow();

  res.json(account);
});

// ─── Logistics: transfer resources between stations ──────────────────────────

// AB#717: transfers carry up to 10 lines, all or nothing, into corp.logisticsHistory. The rules, the fee and the
// error copy live in public/scripts/logistics.js, which the Logistics tab reads too; imported here beside its use.
import { parseTransferRequest, planTransfer, recordTransfer } from "../public/scripts/logistics.js";

app.post("/api/accounts/:accountId/gameplay/transfer-resources", (req, res) => {
  const request = parseTransferRequest(req.body);
  if (!request.ok) {
    res.status(400).json({ error: request.error });
    return;
  }

  let refusal = null;
  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const toStationId = corp.currentStationId || null;
    const plan = planTransfer({
      fromStationId: request.fromStationId, toStationId, lines: request.lines,
      inventory: corp.inventory, credits: corp.finances.credits, stations: STATION_REGISTRY
    });
    if (!plan.ok) {
      refusal = plan.error; // nothing has moved
      return;
    }

    const fromInv = getStationInventory(corp, request.fromStationId);
    const toInv = getStationInventory(corp, toStationId);
    for (const { item, quantity } of request.lines) {
      fromInv[item] -= quantity;
      if (fromInv[item] <= 0) delete fromInv[item];
      toInv[item] = (toInv[item] || 0) + quantity;
    }
    corp.finances.credits -= plan.fee;
    recordExpense(corp, "transfer-fees", plan.fee); // Bug #1022
    corp.logisticsHistory = recordTransfer(corp.logisticsHistory, {
      time: Date.now(), from: request.fromStationId, to: toStationId, lines: request.lines, fee: plan.fee
    });
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (refusal) {
    res.status(400).json({ error: refusal });
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

      // Research gate: Sol needs none, so a corporation can always come home (Bug #976).
      if (!canReachSystem(corp.unlockedTech, fromSystemId, toSystemId)) { outcome = "missing-research"; return; }

      const durationMs = getInterstellarTravelTimeMs(fromSystemId, toSystemId);
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

      const durationMs = corp.currentStationId
        ? getTravelTimeMs(corp.currentStationId, toStationId)
        : (IS_DEV ? 5 * 1000 : 10 * 60 * 1000); // from open space: dev 5s, prod 10 min
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
  const etaMs = travelInfo.arrivesAt - travelInfo.departedAt;
  const etaMin = Math.round(etaMs / 60000);
  const etaText = etaMin >= 60
    ? `${Math.floor(etaMin / 60)}h ${etaMin % 60 ? etaMin % 60 + "m" : ""}`
    : etaMin < 1 ? "< 1 minute" : `${etaMin} minute(s)`;

  let notifBody;
  if (travelInfo.travelType === "interstellar") {
    const sysName = SYSTEM_DETAILS[travelInfo.toSystemId]?.bodies?.[0]?.name || travelInfo.toSystemId;
    notifBody = `Initiating interstellar jump to the ${travelInfo.toSystemId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())} system. ETA ${etaText}.`;
  } else {
    const dest = STATION_REGISTRY[travelInfo.toStationId];
    notifBody = `Setting course for ${dest.name} (${dest.body}). ETA ${etaText}.`;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "travel",
    title: travelInfo.travelType === "interstellar" ? "Interstellar Jump Initiated" : "Undocking — Course Set",
    body: notifBody
  });
  if (notification) {
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  saveAccountsNow();
  res.json(account);
});

// Bug #1057: what a player can do when building slots run out, worked out from their own leases and level.
import { unleasedBodies } from "./leases.js";
import { leaseSlotsFullMessage, corporationSlotsFullMessage } from "../public/scripts/slotAdvice.js";
import { MILESTONE_LEVELS } from "./gameState.js";
const unleasedFor = (corp) => unleasedBodies(SYSTEMS_CATALOG, STATIONS_DATA.stations, corp);
/** The corporation-slots message for this corporation, from its leases, what it can reach and the level table. */
const corpSlotsFull = (corp) => corporationSlotsFullMessage(corp, unleasedFor(corp), MILESTONE_LEVELS);

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
      leaseId,
      // Record the lease body directly on the yard so the location survives
      // any future leaseId namespacing or reference loss.
      body: lease?.body || null
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
      "lease-slots-full": leaseSlotsFullMessage(corp, (corp.miningLeases || []).find((l) => l.id === leaseId), unleasedFor(corp)),
      "no-corp-slot": corpSlotsFull(corp),
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

// ─── Lease-scoped: Start a mining cycle on a lease extractor ───────────────
app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/start-mining", (req, res) => {
  const { leaseId } = req.params;
  let neededStartup = 0; // Bug #1058: the start-up cost, for the refusal
  const amount = bodyNumber(req.body?.amount, { fallback: 40, min: 10 });
  const requestedHours = bodyNumber(req.body?.hours, { fallback: 24, min: 1, max: 72 });
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
      neededStartup = startupCost;
      return;
    }

    recordExpense(corp, "mining-startup", startupCost); // Bug #1022
    corp.finances.credits -= startupCost;

    startExtractorCycle(extractorCycle, { now, hours: requestedHours, throughputPerHour, operationCostPerHour, startupCost });

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
      "insufficient-credits": fundingRequirementMessage("Starting this mining cycle", account.state.corp, neededStartup, miningCreditsAdvice(neededStartup))
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
    // If the corp has exactly one mining lease, the new yard must live there.
    // For multi-lease corps the yard is left unassigned and the player picks
    // a placement explicitly via the lease panel.
    const leases = Array.isArray(corp.miningLeases) ? corp.miningLeases : [];
    const autoLease = leases.length === 1 ? leases[0] : null;
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
      lastCompletedAt: null,
      leaseId: autoLease?.id || null,
      body: autoLease?.body || null
    });
    if (autoLease) {
      if (!Array.isArray(autoLease.extractorIds)) autoLease.extractorIds = [];
      autoLease.extractorIds.push(`ext-basic-${nextExtractorIndex}`);
    }

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
      // Bug #1195: no perk raises this cap; leases are where more extractors go. (No page button calls this route any
      // more; the lease-scoped route below is the one players use.)
      "extractor-cap": `Only ${extractorCap === 1 ? "one Basic Extractor Yard" : `${extractorCap} Basic Extractor Yards`} can be built outside a mining lease (${currentExtractorCount}/${extractorCap}). Build more on a lease: each lease holds 2, and the ISA Claims & Leases Division files them.`,
      "no-slot": `A Basic Extractor Yard needs a free building slot. ${corpSlotsFull(corp)}`,
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
      "no-slot": `An Assembly Facility needs a free building slot. ${corpSlotsFull(account.state.corp)}`,
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
  if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
    if (!Array.isArray(am.fabricationQueue)) am.fabricationQueue = [];

    // Bug #586: the Fleet Cap the player is shown, counting every vessel they own
    const pendingCount = am.fabricationQueue.length;
    if (fleetStatus(corp).full) {
      outcome = "probe-cap";
      return;
    }

    // Only one fabrication at a time
    if (pendingCount > 0) {
      outcome = "already-fabricating";
      return;
    }

    if ((corp.finances.credits || 0) < PROBE_BUILD_COST) {
      outcome = "insufficient-credits";
      return;
    }

    corp.finances.credits -= PROBE_BUILD_COST;

    const now = Date.now();
    am.fabricationQueue.push({
      id: `fab-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: "mining-probe",
      startedAt: now,
      completesAt: now + PROBE_FABRICATION_MS,
      cost: PROBE_BUILD_COST
    });
  });

  if (!account) { res.status(404).json({ error: "Account not found." }); return; }

  if (outcome !== "ok") {
    const am = account.state.corp.asteroidMining || {};
    const pendingCount = (am.fabricationQueue || []).length;
    const msgs = {
      "missing-research": "Asteroid Prospecting Arrays research is required before fabricating mining probes.",
      "no-assembly": "You must construct an Assembly Facility before fabricating probes.",
      "probe-cap": (() => { const fleet = fleetStatus(account.state.corp); return `Your fleet is at its Fleet Cap (${fleet.vessels}/${fleet.cap}). ${fleet.raiseText}`; })(),
      "already-fabricating": "A probe is already being fabricated. Wait for it to complete before starting another.",
      "insufficient-credits": fundingRequirementMessage("Mining Probe fabrication", account.state.corp, PROBE_BUILD_COST)
    };
    res.status(400).json({ error: msgs[outcome] || "Probe fabrication failed." });
    return;
  }

  const notification = addAccountNotification(req.params.accountId, {
    type: "infrastructure",
    title: "Probe Fabrication Started",
    body: `Mining Probe fabrication has begun. Estimated completion: ${PROBE_FABRICATION_MS >= 60000 ? Math.round(PROBE_FABRICATION_MS / 60000) + " minute(s)" : Math.round(PROBE_FABRICATION_MS / 1000) + " second(s)"}.`
  });
  if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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

    if (!Array.isArray(am.scoutedBelts)) am.scoutedBelts = [];
    if (!am.scoutedBelts.includes(beltKey)) {
      outcome = "not-scouted";
      return;
    }

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
    recordExpense(corp, "expeditions", launchCost); // Bug #1022
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
      "not-scouted": "This asteroid belt has not been scouted. Scout the belt first to reveal its composition before launching an expedition.",
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
  if (notification) emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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

    // Cap concurrent refineries (each lets you run one chain in parallel).
    const MAX_REFINERIES = 2;
    const existingRefineries = (corp.buildings || []).filter((b) => b.name === "Refinery").length;
    if (existingRefineries >= MAX_REFINERIES) {
      outcome = "max-refineries";
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
      "max-refineries": "You already operate the maximum of 2 refineries.",
      "no-slot": `A refinery needs a free building slot. ${corpSlotsFull(corp)}`,
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/start-refinery", (req, res) => {
  const refineryId = String(req.body?.refineryId || "").trim();
  const chainId = String(req.body?.chainId || "").trim();
  // Optional: number of input units the player wants to refine in this run.
  // Defaults to chain.inputQuantityPerCycle. Floored to a multiple of the
  // chain's per-cycle input. Effective minimum is max(100, perCycle).
  const requestedQuantity = bodyNumber(req.body?.inputQuantity, { fallback: 0, integer: true });
  let outcome = "ok";
  let targetLabel = "";
  let actualQuantity = 0;
  let actualScale = 1;
  let actualDurationHours = 0;

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

    // Resolve the run size. Player may pass `inputQuantity`; we round it down
    // to the chain's per-cycle multiple. Default = one cycle. Hard minimum =
    // 100 input units, capped per chain in case the per-cycle base is
    // smaller than 100 (e.g. He-3 at 50/cycle requires at least two cycles).
    const perCycle = Math.max(1, Number(chain.inputQuantityPerCycle));
    const minQuantity = Math.max(100, perCycle);
    const requested = requestedQuantity > 0 ? requestedQuantity : perCycle;
    const scale = Math.max(1, Math.floor(requested / perCycle));
    const inputQty = scale * perCycle;
    if (inputQty < minQuantity) {
      outcome = "below-minimum";
      actualQuantity = inputQty;
      return;
    }

    // Check input material availability at current station
    const refStationId = corp.currentStationId || "earth-station-prime";
    const refInv = getStationInventory(corp, refStationId);
    const available = Number(refInv[chain.input] || 0);
    if (available < inputQty) {
      outcome = "insufficient-input";
      actualQuantity = inputQty;
      return;
    }

    // Consume input
    refInv[chain.input] -= inputQty;
    if (refInv[chain.input] <= 0) delete refInv[chain.input];

    const now = Date.now();
    actualQuantity = inputQty;
    actualScale = scale;
    actualDurationHours = chain.cycleDurationHours * scale;

    refinery.active = true;
    refinery.chainId = chain.id;
    // Outputs are delivered where the inputs came from, not wherever the corporation is at completion (Bug #692).
    refinery.stationId = refStationId;
    refinery.cycleScale = scale;
    refinery.startedAt = now;
    refinery.lastTickAt = now;
    refinery.endsAt = now + actualDurationHours * 60 * 60 * 1000;
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
      "below-minimum": `Minimum refine quantity is 100 units (one batch of ${chain.inputQuantityPerCycle} ${chain.input}).`,
      "insufficient-input": `Not enough ${chain.input} at this station. Need ${actualQuantity || chain.inputQuantityPerCycle} but only have ${Number(getStationInventory(account.state.corp, account.state.corp.currentStationId || "earth-station-prime")[chain.input] || 0)}.`
    };
    res.status(400).json({ error: messageMap[outcome] || "Refinery cycle failed to start." });
    return;
  }

  const outputNames = chain.outputs
    .map((o) => `${o.quantityPerCycle * actualScale} ${o.item}`)
    .join(", ");
  const notification = addAccountNotification(req.params.accountId, {
    type: "operations",
    title: "Refinery Cycle Started",
    body: `${targetLabel} processing ${actualQuantity} ${chain.input} → ${outputNames} (${actualDurationHours}h, ${actualScale} batch${actualScale === 1 ? "" : "es"}).`
  });
  if (notification) {
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
  let shortfall = null;
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
    if (have < required) { outcome = "insufficient"; shortfall = { resource, required, stationId }; return; }

    // Deduct resources
    stationInv[resource] = have - required;
    if (stationInv[resource] <= 0) delete stationInv[resource];

    // Credit reward into the balance the player spends, and book it as income (Bug #1009: it went to corp.credits,
    // which nothing reads). Contract Law Essentials adds 8%.
    const rewardCredits = missionRewardCredits(mission.reward, state.corp.completedInsights);
    if (rewardCredits) {
      state.corp.finances.credits = (state.corp.finances.credits || 0) + rewardCredits;
      recordIncome(state.corp, "missions", rewardCredits);
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
  if (outcome === "insufficient") {
    const stationName = (id) => STATIONS_DATA.stations.find((st) => st.id === id)?.name || id;
    return res.status(400).json({ error: missionShortMessage({ ...shortfall, inventory: account.state.corp.inventory, stationName }) });
  }
  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/mine", (req, res) => {
  const amount = bodyNumber(req.body?.amount, { fallback: 40, min: 10 });
  const requestedHours = bodyNumber(req.body?.hours, { fallback: 24, min: 1, max: 72 });
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
    recordExpense(corp, "mining-startup", startupCost); // Bug #1022
    corp.finances.credits -= startupCost;

    startExtractorCycle(extractorCycle, { now, hours: cycleHours, throughputPerHour, operationCostPerHour, startupCost });

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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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

  // Bug #983: a planned program has no effect in the game yet, so it is not sold.
  if (!isInsightProgramLive(prog)) {
    res.status(400).json({ error: `${prog.name} is not available yet: its effect is planned for a later version.` });
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
    emitToAccount(req.params.accountId, "notifications:new", { accountId: req.params.accountId, notification });
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

// Bug #711: find a mail recipient. Behind requireAuth + requireAccountAccess (the /api/accounts/:accountId mount), and
// it returns only what a sender needs to tell same-named corporations apart - never an account id or an email.
app.get("/api/accounts/:accountId/corporations", (req, res) => {
  const name = typeof req.query?.name === "string" ? req.query.name.trim() : "";
  if (!name || name.length > 64) {
    res.status(400).json({ error: "Give between 1 and 64 characters of a corporation name." });
    return;
  }
  res.json({ corporations: findCorporations(name, 10) });
});

// Specific named routes FIRST (before :messageId wildcards)
app.post("/api/accounts/:accountId/messages/send", (req, res) => {
  const { toCorpId, toCorpName, subject, body } = req.body ?? {};
  const result = sendPlayerMessage(req.params.accountId, {
    toCorpId: String(toCorpId || "").trim().slice(0, 64),
    toCorpName: String(toCorpName || "").trim().slice(0, 200),
    subject: String(subject || "").trim(),
    body: String(body || "").trim()
  });
  if (result.error) {
    // 404 no such corporation, 409 a name several share (with the candidates to choose from), 400 otherwise.
    res.status(result.status || 400).json({ error: result.error, ...(result.candidates ? { candidates: result.candidates } : {}) });
    return;
  }
  // Delete the draft if a draftId was provided
  if (req.body?.draftId) {
    deleteDraft(req.params.accountId, String(req.body.draftId));
  }
  const messages = listAccountMessages(req.params.accountId);
  // Bug #1130: tell the recipient's open sessions, so their Inbox and its unread count refresh without a reload. The
  // account room keeps the event to that account's own sockets; the payload carries no ids (Bug #1134).
  emitToAccount(result.recipientAccountId, "messages:new", {});
  res.json({ ok: true, toName: result.toName, messages });
});

app.post("/api/accounts/:accountId/messages/draft", (req, res) => {
  const { draftId, toCorpId, toCorpName, subject, body } = req.body ?? {};
  const draft = saveDraft(req.params.accountId, {
    draftId: draftId ? String(draftId).trim() : null,
    toCorpId: String(toCorpId || "").trim(),
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

// ─── Forums ──────────────────────────────────────────────────────────────────
// Player-authored corporate forum threads & replies. Stored on the global
// state.json under `forums.threads`, broadcast via socket so every connected
// client sees new posts immediately.
app.post("/api/forums/threads", requireAuth, (req, res) => {
  const { category, title, body } = req.body ?? {};
  const trimmedCategory = String(category || "").trim();
  const trimmedTitle = String(title || "").trim().slice(0, 200);
  const trimmedBody = String(body || "").trim().slice(0, 8000);
  if (!trimmedCategory || !trimmedTitle || !trimmedBody) {
    res.status(400).json({ error: "category, title, and body are required." });
    return;
  }

  const account = getAccountById(req.auth.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  const author = String(account.state?.corp?.corporationName || "").trim() || UNNAMED_CORPORATION; // never the email (Bug #1134)

  // Validate the category against the global allowlist before mutating.
  const currentForums = getState().forums || {};
  if (Array.isArray(currentForums.categories) && currentForums.categories.length
      && !currentForums.categories.includes(trimmedCategory)) {
    res.status(400).json({ error: "Unknown forum category." });
    return;
  }

  const newThread = {
    id: `thr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: trimmedCategory,
    title: trimmedTitle,
    author,
    authorAccountId: account.id,
    body: trimmedBody,
    likes: 0,
    createdAt: Date.now(),
    replies: []
  };

  const updated = mutateState((draft) => {
    if (!draft.forums || typeof draft.forums !== "object") draft.forums = { categories: [], threads: [] };
    if (!Array.isArray(draft.forums.threads)) draft.forums.threads = [];
    draft.forums.threads.unshift(newThread);
  });

  emitForumsUpdated(updated.forums);
  res.json({ thread: threadView(newThread, account.id) });
});

app.post("/api/forums/threads/:threadId/replies", requireAuth, (req, res) => {
  const content = String(req.body?.content || "").trim().slice(0, 4000);
  if (!content) {
    res.status(400).json({ error: "Reply content is required." });
    return;
  }

  const account = getAccountById(req.auth.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  const author = String(account.state?.corp?.corporationName || "").trim() || UNNAMED_CORPORATION; // never the email (Bug #1134)

  const reply = {
    id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author,
    authorAccountId: account.id,
    content,
    likes: 0,
    createdAt: Date.now()
  };

  let foundThread = null;
  const updated = mutateState((draft) => {
    const thread = (draft.forums?.threads || []).find((t) => t.id === req.params.threadId);
    if (!thread) return;
    if (!Array.isArray(thread.replies)) thread.replies = [];
    thread.replies.push(reply);
    foundThread = thread;
  });

  if (!foundThread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }

  emitForumsUpdated(updated.forums);
  res.json({ reply: postView(reply, account.id), thread: threadView(foundThread, account.id) });
});

// Toggle a like on a thread or reply. Tracks `likedBy` (account IDs) so each
// account can only like once; clicking again unlikes. `likes` is always
// derived from `likedBy.length` to stay consistent. `likedBy` never leaves the
// server: clients get `likedByMe` (Bug #1134).
app.post("/api/forums/threads/:threadId/like", requireAuth, (req, res) => {
  const replyId = req.body?.replyId ? String(req.body.replyId) : null;
  const accountId = req.auth.accountId;

  let result = null;
  let foundThread = null;
  const updated = mutateState((draft) => {
    const thread = (draft.forums?.threads || []).find((t) => t.id === req.params.threadId);
    if (!thread) return;
    foundThread = thread;

    const target = replyId
      ? (Array.isArray(thread.replies) ? thread.replies.find((r) => r.id === replyId) : null)
      : thread;
    if (!target) {
      result = { error: "not-found" };
      return;
    }
    if (!Array.isArray(target.likedBy)) target.likedBy = [];
    const idx = target.likedBy.indexOf(accountId);
    if (idx >= 0) {
      target.likedBy.splice(idx, 1);
    } else {
      target.likedBy.push(accountId);
    }
    target.likes = target.likedBy.length;
    result = { likes: target.likes, liked: idx < 0 };
  });

  if (!foundThread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  if (result?.error === "not-found") {
    res.status(404).json({ error: "Reply not found." });
    return;
  }

  emitForumsUpdated(updated.forums);
  res.json({ ...result, thread: threadView(foundThread, accountId) });
});

app.post("/api/market/orders", requireAuth, (req, res) => {
  const { type, item, quantity, unitPrice } = req.body ?? {};

  const account = getAccountById(req.auth.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  // Bug #425: whole numbers of at least 1, or refused (they used to be clamped up to 1).
  const normalizedQty = bodyCount(quantity);
  const normalizedUnitPrice = bodyCount(unitPrice);
  if (!type || !item || normalizedQty === null || normalizedUnitPrice === null || type !== "sell") {
    res.status(400).json({ error: "Missing required order fields." });
    return;
  }

  let rejectReason = "";
  let order = null;
  const updatedSeller = mutateAccountState(req.auth.accountId, (state) => {
    const stationId = state.corp.currentStationId || "earth-station-prime";
    const inventory = getStationInventory(state.corp, stationId);
    const available = Number(inventory[item] || 0);
    if (available < normalizedQty) {
      rejectReason = "Quantity exceeds available inventory at this station.";
      return;
    }
    // Bug #425: a limit per seller, checked before any goods move, instead of cutting the shared book (which deleted
    // the oldest listings, goods and all).
    const openListings = (getState().market.orderBook || []).filter((o) => o.sellerAccountId === req.auth.accountId).length;
    if (openListings >= MAX_OPEN_LISTINGS) {
      rejectReason = `You have ${MAX_OPEN_LISTINGS} open listings; cancel one to list more.`;
      return;
    }

    // The order goes into the book first and the goods come out after, in the same step: if the insert throws, the
    // goods have not moved. stationId records where they came from, so a cancel returns them there.
    order = {
      id: `ord-${randomUUID()}`,
      type,
      item,
      quantity: normalizedQty,
      unitPrice: normalizedUnitPrice,
      seller: state.corp.corporationName || "Anonymous",
      sellerAccountId: req.auth.accountId,
      stationId,
      createdAt: Date.now()
    };
    mutateState((draft) => {
      if (!Array.isArray(draft.market.orderBook)) draft.market.orderBook = [];
      draft.market.orderBook.unshift(order);
    });
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

  if (!updatedSeller || rejectReason || !order) {
    res.status(400).json({ error: rejectReason || "Unable to create sell order." });
    return;
  }

  emitMarketUpdated();
  res.json({ ok: true, order, account: updatedSeller });
});

// Bug #425: a seller can take a listing down, getting the unsold goods back at the station they were listed from.
// Only the seller: anyone else gets 404, so the route says nothing about orders that are not theirs.
app.post("/api/market/orders/:orderId/cancel", requireAuth, (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const order = (getState().market.orderBook || []).find((o) => o.id === orderId && o.sellerAccountId === req.auth.accountId);
  if (!order) {
    res.status(404).json({ error: "You have no listing with that id." });
    return;
  }

  const account = mutateAccountState(req.auth.accountId, (state) => {
    mutateState((draft) => {
      draft.market.orderBook = (draft.market.orderBook || []).filter((o) => o.id !== order.id);
    });
    const stationId = order.stationId || state.corp.currentStationId || "earth-station-prime";
    const inventory = getStationInventory(state.corp, stationId);
    inventory[order.item] = Number(inventory[order.item] || 0) + Number(order.quantity || 0);
    if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
    state.corp.tradeHistory.unshift({
      id: `th-${randomUUID()}`, type: "cancelled", item: order.item, quantity: order.quantity, unitPrice: order.unitPrice,
      total: order.quantity * order.unitPrice, counterparty: "Market", at: Date.now()
    });
    state.corp.tradeHistory = state.corp.tradeHistory.slice(0, 200);
  });
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  emitMarketUpdated();
  res.json({ ok: true, cancelled: order.id, account });
});

app.post("/api/market/orders/:orderId/buy", requireAuth, (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const requestedQty = bodyNumber(req.body?.quantity, { fallback: 1, min: 1, integer: true });
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
      // Bug #984: book the gross the buyer paid as income and the tax as an expense.
      recordIncome(state.corp, "exchange", tradeTotal);
      recordExpense(state.corp, "exchange-tax", taxAmount);

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
    // AB#715: the day's price history takes the trade whether or not the listing is still in the book.
    if (!draft.market.priceHistory) draft.market.priceHistory = {};
    recordTrade(draft.market.priceHistory, order.item, Number(order.unitPrice || 0), tradeQuantity);
    const target = draft.market.orderBook.find((entry) => entry.id === orderId && entry.type === "sell");
    if (!target) {
      return;
    }
    target.quantity = Math.max(0, Number(target.quantity || 0) - tradeQuantity);
    if (target.quantity <= 0) {
      draft.market.orderBook = draft.market.orderBook.filter((entry) => entry.id !== target.id);
    }
  });

  emitMarketUpdated();
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

// ─── Daily price history per item (AB#715) ───────────────────────────────────
// Global and non-personal: open, high, low, close, volume and trade count per UTC day, the last 90 days. The item is
// matched against the catalog, and an unknown one is refused without repeating it back. Behind a login like every
// other route (Bug #423), although nothing in it is personal.
import { recordTrade, historyFor, PRICE_HISTORY_ITEMS, PRICE_HISTORY_DAYS } from "./priceHistory.js";

app.get("/api/market/history/:item", requireAuth, (req, res) => {
  const item = String(req.params.item || "");
  if (!PRICE_HISTORY_ITEMS.has(item)) {
    res.status(400).json({ error: "Unknown item." });
    return;
  }
  res.json({ item, days: PRICE_HISTORY_DAYS, buckets: historyFor(getState().market?.priceHistory, item) });
});

// ─── Sell player resources into an NPC standing buy order ────────────────────
app.post("/api/market/npc-orders/:orderId/sell", requireAuth, (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  // Bug #425: a whole number of at least 1, or refused; it used to fall back to 1 for "abc", 0 or -5.
  const requestedQty = bodyCount(req.body?.quantity);
  if (requestedQty === null) {
    res.status(400).json({ error: "Quantity must be a whole number of at least 1." });
    return;
  }

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
    // Bug #984: book the gross the NPC paid as income and the tax as an expense.
    recordIncome(state.corp, "exchange", tradeTotal);
    recordExpense(state.corp, "exchange-tax", taxAmount);

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
    if (!draft.market.priceHistory) draft.market.priceHistory = {};
    recordTrade(draft.market.priceHistory, npcOrder.item, Number(npcOrder.unitPrice || 0), requestedQty); // AB#715
  });

  emitMarketUpdated();
  res.json({
    ok: true,
    traded: { orderId, item: npcOrder.item, quantity: requestedQty, unitPrice: npcOrder.unitPrice, total: tradeTotal, taxPct: tradeTaxPct, taxAmount: tradeTaxAmount, proceeds: tradeProceeds },
    account: seller
  });
});

app.use((error, _req, res, _next) => {
  console.error("[http] unhandled route error", error);
  res.status(500).json({ error: "Internal server error." });
});

// Bug #710: a socket carries the same access token as the HTTP API (socket.handshake.auth.token). Anyone may still
// connect to read public state, but only a verified socket may chat, and the server decides who is speaking.
/** The socket.io room for one account's sockets. */
function accountRoom(accountId) {
  return `account:${accountId}`;
}

/**
 * Send an event about one account to that account's sockets only (Bug #1021: these used to be io.emit broadcasts, so
 * every connected client received every corporation's finances, mining, inventory and notification text). Global
 * events (market, forums, chat) still use io.emit; tests/integration/socket-rooms.test.js checks there are no others.
 */
function emitToAccount(accountId, event, payload) {
  if (accountId) io.to(accountRoom(accountId)).emit(event, payload);
}

/**
 * Send the market to every connected socket as that socket's account should see it: the newest orders plus its own
 * (Bug #425: the book is never cut, so what is sent is capped here instead).
 */
function emitMarketUpdated() {
  const market = getState().market;
  for (const peer of io.of("/").sockets.values()) peer.emit("market:updated", marketView(market, peer.data.accountId));
}

/** Send the forums to every connected socket as that socket's account should see them: no account ids (Bug #1134). */
function emitForumsUpdated(forums) {
  for (const peer of io.of("/").sockets.values()) peer.emit("forums:updated", forumsView(forums, peer.data.accountId));
}

/** The shared state as `viewer` (an account id, or null) should see it: the bootstrap and a socket's state:init. */
function sharedStateView(viewer) {
  const state = getState();
  return { ...state, market: marketView(state.market, viewer), forums: forumsView(state.forums, viewer) };
}

io.use((socket, next) => {
  const verified = verifyAccessToken(socket.handshake.auth?.token);
  if (verified.accountId) socket.data.accountId = verified.accountId;
  next();
});

/** The chat channels anyone may post to. "private" is gone: it was a public broadcast wearing the name (D-0.12-1). */
const PUBLIC_CHAT_CHANNELS = new Set(["global", "trade"]);

/**
 * Where a message goes, decided by the server: "global" and "trade" as asked; "local" (or "local:<own system>") is the
 * sender's current system as the server knows it. Anything else, including another system's local channel, is null.
 */
function resolveChatChannel(requested, corp) {
  if (typeof requested !== "string") return null;
  if (PUBLIC_CHAT_CHANNELS.has(requested)) return requested;
  const home = `local:${corp?.currentSystemId || "sol"}`;
  if (requested === "local" || requested === home) return home;
  return null;
}

io.on("connection", (socket) => {
  // Bug #1021: an authenticated socket joins its account's room, so per-account events reach only its owner.
  if (socket.data.accountId) socket.join(accountRoom(socket.data.accountId));
  socket.emit("state:init", sharedStateView(socket.data.accountId || null));

  socket.on("chat:send", (payload) => {
    // Fail closed: no verified account, no account, no allowed channel or no content means nothing is stored or sent.
    const accountId = socket.data.accountId;
    if (!accountId) return;
    const corp = getAccountById(accountId)?.state?.corp;
    if (!corp) return;
    const channel = resolveChatChannel(payload?.channel, corp);
    if (!channel) return;
    // Bug #1127: kept as typed (the client renders it as text; stripping tags garbled "10 < price < 30"), and at most
    // CHAT_MAX_LENGTH characters, the chat box's own limit: a longer line is dropped like an empty one.
    const content = typeof payload?.content === "string" ? payload.content.trim() : "";
    if (!content || content.length > CHAT_MAX_LENGTH) return;

    // The author is the sender's own corporation; payload.author is ignored. No account id goes in the broadcast.
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel,
      author: stripHtml(corp.corporationName || "") || "Unnamed Corporation",
      content,
      createdAt: Date.now()
    };

    appendChatMessage(channel, message);
    if (channel.startsWith("local:")) {
      // Local chat reaches the corporations in that system now, read at send time so travel needs no bookkeeping.
      const systemId = channel.slice("local:".length);
      for (const peer of io.of("/").sockets.values()) {
        const peerCorp = peer.data.accountId ? getAccountById(peer.data.accountId)?.state?.corp : null;
        if (peerCorp && (peerCorp.currentSystemId || "sol") === systemId) peer.emit("chat:new", message);
      }
    } else {
      io.emit("chat:new", message);
    }
  });

  socket.on("disconnect", () => {
    // Placeholder for future presence tracking and local system channel cleanup.
  });
});

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
  miningTick,
  refineryTick,
  asteroidExpeditionTick,
  fabricationTick,
  travelTick,
  processRndCompletions,
  processCeoInsightCompletions,
  checkAndResetNpcBuyOrders,
  financialSnapshotTick
};
