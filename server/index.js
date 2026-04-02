import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  appendChatMessage,
  createCombatReport,
  authenticateAccount,
  getAccountById,
  getDummyAccount,
  getState,
  markWalkthroughCompleted,
  resetDummyAccountProgress,
  resetWalkthroughCompletion,
  mutateAccountState,
  mutateState
} from "./gameState.js";

const RESEARCH_LIBRARY = {
  "tt-basic-extraction": {
    id: "tt-basic-extraction",
    name: "Basic Extraction Analytics",
    effect: "+10% raw extraction throughput",
    durationHours: 2,
    costCredits: 18000,
    costLiquidity: 12000,
    prereqs: []
  },
  "tt-industrial-safety": {
    id: "tt-industrial-safety",
    name: "Industrial Safety Protocols",
    effect: "-8% facility downtime risk",
    durationHours: 3,
    costCredits: 26000,
    costLiquidity: 18000,
    prereqs: ["tt-basic-extraction"]
  },
  "tt-supply-forecast": {
    id: "tt-supply-forecast",
    name: "Supply Forecast Engine",
    effect: "+6% logistics efficiency",
    durationHours: 4,
    costCredits: 32000,
    costLiquidity: 22000,
    prereqs: ["tt-basic-extraction"]
  },
  "tt-energy-routing": {
    id: "tt-energy-routing",
    name: "High-Density Energy Routing",
    effect: "+1 advanced manufacturing lane",
    durationHours: 6,
    costCredits: 54000,
    costLiquidity: 36000,
    prereqs: ["tt-industrial-safety", "tt-supply-forecast"]
  }
};

function formatCredits(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString("en-US")} credits`;
}

function fundingRequirementMessage(actionLabel, corp, requiredCredits, requiredLiquidity, extra = "") {
  const parts = [
    `${actionLabel} requires ${formatCredits(requiredCredits)} and ${formatCredits(requiredLiquidity)} liquidity.`,
    `Current reserves: ${formatCredits(corp.finances.credits)} credits, ${formatCredits(corp.finances.liquidity)} liquidity.`
  ];

  if (extra) {
    parts.push(extra);
  }

  return parts.join(" ");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/bootstrap", (_req, res) => {
  res.json(getState());
});

app.post("/api/auth/dummy-login", (_req, res) => {
  res.json(getDummyAccount());
});

app.post("/api/auth/dummy-reset", (_req, res) => {
  const account = resetDummyAccountProgress();
  if (!account) {
    res.status(404).json({ error: "Dummy account not found." });
    return;
  }

  res.json(account);
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  const account = authenticateAccount(email, password);

  if (!account) {
    res.status(401).json({ error: "Invalid account credentials." });
    return;
  }

  res.json(account);
});

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

  res.json(account);
});

app.post("/api/accounts/:accountId/walkthrough-reset", (req, res) => {
  const account = resetWalkthroughCompletion(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/hire", (req, res) => {
  const count = Math.max(1, Number(req.body?.count || 1));
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const available = Math.max(0, corp.employeeCap - corp.employeeCount);
    const hired = Math.min(count, available);
    const hireCost = hired * 1200;

    if (hired <= 0) {
      outcome = "no-capacity";
      return;
    }

    if (corp.finances.credits < hireCost) {
      outcome = "insufficient-credits";
      return;
    }

    if (corp.finances.liquidity < hireCost) {
      outcome = "insufficient-liquidity";
      return;
    }

    corp.employeeCount += hired;
    corp.finances.credits -= hireCost;
    corp.finances.liquidity -= hireCost;
    corp.finances.dailyCosts += hired * 36;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "no-capacity": `Employee cap reached. Current staffing is ${corp.employeeCount}/${corp.employeeCap}.`,
      "insufficient-credits": fundingRequirementMessage("Hiring", corp, count * 1200, count * 1200),
      "insufficient-liquidity": fundingRequirementMessage("Hiring", corp, count * 1200, count * 1200)
    };
    res.status(400).json({ error: messageMap[outcome] || "Hire action failed." });
    return;
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/build-extractor", (req, res) => {
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const alreadyBuilt = corp.buildings.some((b) => b.name === "Basic Extractor Yard");
    const buildCost = 65000;

    if (alreadyBuilt) {
      outcome = "already-built";
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

    if (corp.finances.liquidity < buildCost) {
      outcome = "insufficient-liquidity";
      return;
    }

    corp.buildings.push({ name: "Basic Extractor Yard", tier: 1, status: "Operational" });
    corp.finances.credits -= buildCost;
    corp.finances.liquidity -= buildCost;
    corp.finances.assets += 42000;
  });

  if (!account) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (outcome !== "ok") {
    const corp = account.state.corp;
    const messageMap = {
      "already-built": "Basic Extractor Yard is already operational.",
      "no-slot": `Basic Extractor Yard requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`,
      "insufficient-credits": fundingRequirementMessage(
        "Basic Extractor Yard construction",
        corp,
        65000,
        65000,
        `It also requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`
      ),
      "insufficient-liquidity": fundingRequirementMessage(
        "Basic Extractor Yard construction",
        corp,
        65000,
        65000,
        `It also requires 1 open building slot. Current usage: ${corp.buildings.length}/${corp.buildingSlots}.`
      )
    };
    res.status(400).json({ error: messageMap[outcome] || "Build action failed." });
    return;
  }

  res.json(account);
});

app.post("/api/accounts/:accountId/gameplay/mine", (req, res) => {
  const amount = Math.max(10, Number(req.body?.amount || 40));
  let outcome = "ok";

  const account = mutateAccountState(req.params.accountId, (state) => {
    const corp = state.corp;
    const hasExtractor = corp.buildings.some((b) => b.name === "Basic Extractor Yard");
    const cycleHours = 8;
    const throughputPerHour = Math.max(10, Math.min(250, amount));
    const operationCostPerHour = Math.max(600, Math.round(throughputPerHour * 16));
    const startupCost = Math.max(500, Math.round(operationCostPerHour * 0.35));

    if (!corp.mining?.silicateExtractor) {
      corp.mining = {
        silicateExtractor: {
          active: false,
          startedAt: null,
          lastTickAt: null,
          endsAt: null,
          throughputPerHour: 0,
          operationCostPerHour: 0,
          totalMined: 0,
          totalSpent: 0,
          lastCompletedAt: null
        }
      };
    }

    const extractorCycle = corp.mining.silicateExtractor;

    if (!hasExtractor) {
      outcome = "missing-extractor";
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

    if (corp.finances.liquidity < startupCost) {
      outcome = "insufficient-liquidity";
      return;
    }

    const now = Date.now();
    corp.finances.credits -= startupCost;
    corp.finances.liquidity -= startupCost;

    extractorCycle.active = true;
    extractorCycle.startedAt = now;
    extractorCycle.lastTickAt = now;
    extractorCycle.endsAt = now + cycleHours * 60 * 60 * 1000;
    extractorCycle.throughputPerHour = throughputPerHour;
    extractorCycle.operationCostPerHour = operationCostPerHour;
    extractorCycle.totalSpent += startupCost;
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
      "already-active": "Silicate extraction cycle is already active. Wait for completion before launching another cycle.",
      "insufficient-credits": fundingRequirementMessage(
        "Silicate extraction cycle launch",
        corp,
        startupCost,
        startupCost,
        `Requested throughput: ${throughputPerHour}/hour over 8 hours, with ${formatCredits(operationCostPerHour)}/hour operating spend.`
      ),
      "insufficient-liquidity": fundingRequirementMessage(
        "Silicate extraction cycle launch",
        corp,
        startupCost,
        startupCost,
        `Requested throughput: ${throughputPerHour}/hour over 8 hours, with ${formatCredits(operationCostPerHour)}/hour operating spend.`
      )
    };
    res.status(400).json({ error: messageMap[outcome] || "Mining action failed." });
    return;
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

    if (corp.finances.liquidity < rdCost) {
      outcome = "insufficient-liquidity";
      return;
    }

    corp.finances.credits -= rdCost;
    corp.finances.liquidity -= rdCost;
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
      "insufficient-credits": fundingRequirementMessage("Basic Extraction Analytics", corp, 40000, 40000),
      "insufficient-liquidity": fundingRequirementMessage("Basic Extraction Analytics", corp, 40000, 40000)
    };
    res.status(400).json({ error: messageMap[outcome] || "R&D action failed." });
    return;
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

    if (corp.finances.liquidity < tech.costLiquidity) {
      outcome = "insufficient-liquidity";
      return;
    }

    corp.finances.credits -= tech.costCredits;
    corp.finances.liquidity -= tech.costLiquidity;
    state.queues.corporateRnD.push({
      id: `rnd-${Date.now()}`,
      techId: tech.id,
      name: tech.name,
      effect: tech.effect,
      durationHours: tech.durationHours,
      startedAt: Date.now(),
      costCredits: tech.costCredits,
      costLiquidity: tech.costLiquidity
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
      "insufficient-credits": fundingRequirementMessage(`${tech.name} queueing`, corp, tech.costCredits, tech.costLiquidity),
      "insufficient-liquidity": fundingRequirementMessage(`${tech.name} queueing`, corp, tech.costCredits, tech.costLiquidity)
    };
    res.status(400).json({ error: messageMap[outcome] || "Unable to queue research." });
    return;
  }

  res.json(account);
});

app.post("/api/market/orders", (req, res) => {
  const { type, item, quantity, unitPrice, actor } = req.body ?? {};

  if (!type || !item || !quantity || !unitPrice) {
    res.status(400).json({ error: "Missing required order fields." });
    return;
  }

  const order = {
    id: `ord-${Date.now()}`,
    type,
    item,
    quantity: Number(quantity),
    unitPrice: Number(unitPrice),
    seller: type === "sell" ? actor || "Anonymous" : undefined,
    buyer: type === "buy" ? actor || "Anonymous" : undefined
  };

  mutateState((draft) => {
    draft.market.orderBook.unshift(order);
    draft.market.orderBook = draft.market.orderBook.slice(0, 200);
  });

  io.emit("market:updated", getState().market);
  res.json({ ok: true, order });
});

app.post("/api/investments", (req, res) => {
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

  let accepted = false;
  let rejectReason = "";

  mutateState((draft) => {
    const spend = Number(amount);

    if (draft.corp.finances.credits < spend) {
      rejectReason = "Insufficient credits to place investment.";
      return;
    }

    if ((draft.corp.finances.liquidity || 0) < spend) {
      rejectReason = "Insufficient liquidity to place investment.";
      return;
    }

    if (!draft.corp.investments) {
      draft.corp.investments = [];
    }

    draft.corp.investments.unshift(investment);
    draft.corp.finances.credits -= spend;
    draft.corp.finances.liquidity = Math.max(0, (draft.corp.finances.liquidity || 0) - spend);
    accepted = true;
  });

  if (!accepted) {
    res.status(400).json({ error: rejectReason || "Investment request rejected." });
    return;
  }

  io.emit("finance:updated", getState().corp.finances);
  res.json({ ok: true, investment });
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

io.on("connection", (socket) => {
  socket.emit("state:init", getState());

  socket.on("chat:send", (payload) => {
    const message = {
      id: `msg-${Date.now()}`,
      channel: payload?.channel || "global",
      author: payload?.author || "Anonymous",
      content: payload?.content || "",
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
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`ISP prototype server running on http://localhost:${port}`);
});
