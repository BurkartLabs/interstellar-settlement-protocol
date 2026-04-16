import express from "express";
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
  addSystemMessageToAccount
} from "./gameState.js";

const RESEARCH_LIBRARY = {
  "tt-basic-extraction": {
    id: "tt-basic-extraction",
    name: "Basic Extraction Analytics",
    effect: "+10% raw extraction throughput",
    durationHours: 2,
    costCredits: 2000,
    prereqs: []
  },
  "tt-industrial-safety": {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 2000,
    prereqs: ["tt-basic-extraction"]
  },
  "tt-supply-forecast": {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "+6% logistics efficiency",
    durationHours: 4,
    costCredits: 3000,
    prereqs: ["tt-basic-extraction"]
  },
  "tt-energy-routing": {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 4000,
    prereqs: ["tt-industrial-safety", "tt-supply-forecast"]
  },
  "tt-material-compression": {
    id: "tt-material-compression",
    name: "Material Compression I",
    effect: "+8% refining throughput",
    durationHours: 9,
    costCredits: 6000,
    prereqs: ["tt-energy-routing"]
  },
  "tt-nano-lattice": {
    id: "tt-nano-lattice",
    name: "Nano-Lattice Weaving",
    effect: "Unlocks Aerogel and Quantum Insulator refinery chains",
    durationHours: 12,
    costCredits: 8000,
    prereqs: ["tt-material-compression"]
  },
  "tt-containment-physics": {
    id: "tt-containment-physics",
    name: "Containment Physics I",
    effect: "Unlocks Helium-3 refinery chain",
    durationHours: 10,
    costCredits: 8000,
    prereqs: ["tt-energy-routing"]
  },
  "tt-exotic-energy-routing": {
    id: "tt-exotic-energy-routing",
    name: "Exotic Energy Routing",
    effect: "Unlocks Dark-Matter Capacitor synthesis",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-containment-physics"]
  },
  "tt-fleet-coordination": {
    id: "tt-fleet-coordination",
    name: "Fleet Coordination Matrix",
    effect: "+12 fleet cap",
    durationHours: 16,
    costCredits: 12000,
    prereqs: ["tt-energy-routing"]
  }
};

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
  console.log('[requireAuth] Incoming Authorization header:', authHeader);
  if (!authHeader.startsWith("Bearer ")) {
    console.log('[requireAuth] No Bearer token found in header.');
    return null;
  }
  const token = authHeader.slice(7).trim();
  console.log('[requireAuth] Extracted Bearer token:', token);
  return token;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    console.log('[requireAuth] Missing bearer token for request:', req.method, req.originalUrl, req.headers);
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
app.use(express.static(path.join(__dirname, "..", "public")));

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
import { applyMiningOperations } from "./gameState.js";

function miningTick() {
  const now = Date.now();
  for (const accountId of getAllAccountIds()) {
    mutateAccountState(accountId, (state) => {
      if (state && state.corp) {
        applyMiningOperations(state.corp, now);
      }
    });
  }
  // Optionally emit updated mining state to clients here if needed
}

setInterval(miningTick, 5000); // Every 5 seconds
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
    corp.officeRented = true;
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

  const LEASE_COSTS = { Mars: 25000, Luna: 30000 };
  const leaseCost = LEASE_COSTS[requestedBody] ?? 25000;
  const EMPLOYEES_PER_LEASE = 5;
  let outcome = "ok";
  let existingLeaseOnBody = false;

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

    if (!corp.officeRented) {
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

// ─── Lease-scoped: Build an extractor yard on a specific lease ──────────────
app.post("/api/accounts/:accountId/gameplay/lease/:leaseId/build-extractor", (req, res) => {
  const { leaseId } = req.params;
  const BUILD_COST = 50000;
  const ASSET_VALUE = 36000;
  let outcome = "ok";
  let slotInfo = "";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;

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

    if ((corp.finances.credits || 0) < BUILD_COST) {
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
      "no-lease": "The specified lease could not be found on your account.",
      "lease-slots-full": `This lease has used all ${slotInfo} building slots. Upgrade your lease tier or acquire an additional claim to expand capacity.`,
      "no-corp-slot": `No corporation building slots available. Current usage: ${slotInfo}. Upgrade your headquarters or release an existing building.`,
      "insufficient-credits": fundingRequirementMessage("Basic Extractor Yard construction", corp, BUILD_COST)
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

    const throughputPerHour = Math.max(10, Math.min(250, amount));
    const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
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
    const buildCost = 50000;

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
      durationHours: tech.durationHours,
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
      "missing-prereq": `${tech.name} requires: ${tech.prereqs.join(", ")}.`,
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
    const inventory = state.corp.inventory || {};
    const available = Number(inventory[item] || 0);
    if (available < normalizedQty) {
      rejectReason = "Quantity exceeds available inventory.";
      return;
    }

    inventory[item] = available - normalizedQty;
    if (inventory[item] <= 0) {
      delete inventory[item];
    }
    state.corp.inventory = inventory;

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
    if (!corp.inventory[order.item]) {
      corp.inventory[order.item] = 0;
    }
    corp.inventory[order.item] += tradeQuantity;

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
      state.corp.finances.credits += tradeTotal;
      state.corp.finances.dailyRevenue += Math.round(tradeTotal / 24);

      if (!Array.isArray(state.corp.tradeHistory)) state.corp.tradeHistory = [];
      state.corp.tradeHistory.unshift({
        id: `th-${Date.now() + 1}`,
        type: "sold",
        item: order.item,
        quantity: tradeQuantity,
        unitPrice: Number(order.unitPrice || 0),
        total: tradeTotal,
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

  const seller = mutateAccountState(req.auth.accountId, (state) => {
    const inventory = state.corp.inventory || {};
    const available = Number(inventory[npcOrder.item] || 0);
    if (available < requestedQty) {
      rejectReason = `Insufficient ${npcOrder.item} in inventory (have ${available.toLocaleString()}, need ${requestedQty.toLocaleString()}).`;
      return;
    }

    inventory[npcOrder.item] = available - requestedQty;
    if (inventory[npcOrder.item] <= 0) delete inventory[npcOrder.item];
    state.corp.inventory = inventory;

    state.corp.finances.credits = (state.corp.finances.credits || 0) + tradeTotal;
    state.corp.finances.dailyRevenue = (state.corp.finances.dailyRevenue || 0) + Math.round(tradeTotal / 24);

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
    traded: { orderId, item: npcOrder.item, quantity: requestedQty, unitPrice: npcOrder.unitPrice, total: tradeTotal },
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
}

export default app;
