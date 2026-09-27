// server/game/world.js: part of the game state, split out of server/gameState.js by system (AB#737).

import fs from "node:fs";
import { ECONOMY, npcBidFor } from "../economy.js";
import { SYSTEM_SENDERS } from "../corporationName.js";
import { NPC_NAMES } from "../npcCorporations.js"; // ISP-121 (AB#813)
import { placeNpcAsks } from "./npcAsks.js"; // ISP-122 (AB#815)
import { normalizePriceHistory } from "../priceHistory.js";
import { MAX_DEFINED_LEVEL, REFINERY_CHAINS_DATA, SYSTEMS_DATA, deepClone, safeWriteFile, statePath } from "./catalog.js";
import { normalizeStateShape } from "./shape.js";
import { ensureBeltState } from "./belts.js"; // AB#2329

export function getSeedState() {
  return {
    world: {
      lawName: "Interstellar Settlement Protocol",
      lawYear: 2147, // TOOD: Should we set this value to increment on Jan 1st?
      systems: deepClone(SYSTEMS_DATA),
      resourceCatalog: [...REFINERY_CHAINS_DATA.resourceCatalog], // AB#2353: the page's Resource catalog
      refineryChains: REFINERY_CHAINS_DATA.chains.map((c) => ({
        id: c.id,
        inputs: c.inputs, // AB#825: [{ item, quantityPerCycle }], one or several
        outputs: c.outputs,
        cycleDurationHours: c.cycleDurationHours,
        requiresResearch: c.requiresResearch,
        requiresTechIds: c.requiresTechIds,
        stage: c.stage, // AB#825: tier3-recipes.md's stage; the old `tier` was not an item tier
        category: c.category
      }))
    },
    /* TODO(AB#737): Remove legacy data */
    corp: {
      id: "corp-001",
      ceo: "You",
      corporationName: "ISP Foundry Holdings",
      level: 1,
      levelCap: MAX_DEFINED_LEVEL,
      milestonesCompleted: ["HQ Constructed", "First 10 Employees"],
      employeeCap: 100,
      employeeCount: 38,
      buildingSlots: 3,
      buildings: [
        { name: "Headquarters", tier: 1, status: "Operational" },
        { name: "Basic Extractor Yard", tier: 1, status: "Operational" },
        { name: "Refinery Annex", tier: 1, status: "Constructing" }
      ],
      military: {
        units: { lf: 14, ds: 2, se: 0, at: 0, dt: 0 }, // AB#861: power comes from data/units.json, not a typed figure
        modifiers: {
          rdBonusPct: 5,
          ceoLeadershipPct: 3
        }
      },
      finances: {
        credits: 2450000,
        liabilities: 800000,
        assets: 6050000,
        dailyRevenue: 210000,
        dailyCosts: 156000,
        taxRatePct: 14,
        bondYieldPct: 4.8
      },
      inventory: {
        Silicates: 900,
        "Helium-3": 260,
        Titanium: 180
      },
      mining: {
        silicateExtractors: [
          {
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
          }
        ],
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
      },
      unlocks: {
        marketSectors: ["Raw Materials", "Logistics Services"],
        maxUpgradeTier: 2,
        maxFleetSize: 45
      },
      unlockedTech: ["tt-basic-extraction"]
    },
    queues: {
      corporateRnD: [
        {
          id: "rnd-001",
          name: "Material Compression I",
          effect: "+8% refining throughput",
          durationHours: 9,
          startedAt: Date.now() - 2 * 60 * 60 * 1000
        },
        {
          id: "rnd-002",
          name: "Fleet Coordination Matrix",
          effect: "+12 fleet cap",
          durationHours: 16,
          startedAt: null
        }
      ],
      ceoInsight: [
        {
          id: "ceo-001",
          name: "Executive Negotiation Lab",
          effect: "+6% trade spread efficiency",
          durationHours: 6,
          startedAt: Date.now() - 60 * 60 * 1000
        },
        {
          id: "ceo-002",
          name: "Leadership Cohesion Seminar",
          effect: "+4% morale multiplier",
          durationHours: 8,
          startedAt: null
        }
      ]
    },
    missions: [
      {
        id: "ms-log-001",
        title: "Silicate Requisition Order — Batch 4-7A",
        type: "Logistics",
        risk: "Low",
        reward: "12,000 Credits",
        text: "The Bureau requires 400 units of raw silicates for redistribution to ISA-contracted construction projects. Mine the quota from any active extraction lease and deliver it to the Bureau when you have it.",
        canShiftControl: false,
        agentId: "elara-voss",
        quota: { resource: "Silicates", amount: 400 }
      }
    ]
  };
}

// ─── Global social state: chat and forums (Bug #749) ─────────────────────────
// Neither was ever created, so on any install without an old data/state.json every chat message threw inside
// appendChatMessage and was dropped, and the forum's category list was empty. They are seeded here rather than in
// normalizeStateShape, because that function also shapes every player's account state, which has no chat.

/** The chat channels. "private" is deliberately absent: isp-bug-5 removes it from the channel allowlist. */
export const CHAT_CHANNELS = ["global", "local", "trade"];

/** The forum categories: the one list the client's picker and the thread route's allowlist both read. */
export const FORUM_CATEGORIES = ["General", "Trade & Exchange", "Mining & Industry", "Conglomerates & Diplomacy", "Help & Guides"];

/** Give the global state its chat channels and forums, keeping whatever is already there. Returns the same object. */
export function ensureGlobalSocialState(globalState) {
  if (!globalState.chatLog || typeof globalState.chatLog !== "object" || Array.isArray(globalState.chatLog)) {
    globalState.chatLog = {};
  }
  for (const channel of CHAT_CHANNELS) {
    if (!Array.isArray(globalState.chatLog[channel])) globalState.chatLog[channel] = [];
  }
  if (!globalState.forums || typeof globalState.forums !== "object") globalState.forums = {};
  globalState.forums.categories = [...FORUM_CATEGORIES];
  if (!Array.isArray(globalState.forums.threads)) globalState.forums.threads = [];
  return globalState;
}

export function ensureStateFile() {
  // Bug #588, #574: a missing file used to return the bare seed early, skipping the market setup below, so a fresh
  // install (and every test process) had no order book and no standing buy orders. Both paths now take the same route.
  const exists = fs.existsSync(statePath);
  const raw = exists ? JSON.parse(fs.readFileSync(statePath, "utf8")) : getSeedState();
  const dropped = storedCombatReportSummary(raw);
  if (dropped) console.warn(`[combat] removed ${dropped.count} combat report(s), ${dropped.bytes} bytes, left by the removed POST /api/combat/simulate (AB#860).`);
  const normalized = normalizeGlobalState(raw);
  safeWriteFile(statePath, JSON.stringify(normalized, null, 2));
  return normalized;
}

// NPC buyers exist for every raw resource that currently has a refinery chain, so newly mined materials always have
// a guaranteed sink.
// TODO(AB#777): Reevaluate how we are storing the below information. Should it be hardcoded? Should it be more dynamic?
// The exchange's NPC buyers and what they pay (data/economy.json, AB#726).
export const NPC_BUY_SEED = ECONOMY.npcBuyers;

/**
 * AB#2365: an item's daily quota, the volume its bid drifts across (docs/design/tier3-recipes.md section 4). A product's
 * is its npcBuyers dailyQty, a day of one Refinery's output (Fusion Pellets 160, Ion Thrusters 12); a raw item's is the
 * world's npcBid.quotaPerDay (7,000), because its dailyQty is the old fixed bid's volume (Silicates 1,000,000), far
 * above it. So: the smaller of the two, and the world's for an item with no dailyQty.
 */
export function bidQuotaFor(item, economy = ECONOMY) {
  const world = economy.npcBid.quotaPerDay;
  const own = Number(economy.npcBuyers.find((b) => b.item === item)?.dailyQty);
  return own > 0 ? Math.min(own, world) : world;
}

/** The bid rule for one order: the economy's drift and floor, over the order's own quota (AB#2365). */
export function bidRuleFor(order) {
  return { ...ECONOMY.npcBid, quotaPerDay: Number(order?.totalQtyPerDay) > 0 ? Number(order.totalQtyPerDay) : bidQuotaFor(order?.item) };
}

/**
 * An order saved before ISP-87 has no basePrice, no soldToday and a quota of a million; one saved before AB#2365 has
 * the world's 7,000 for a product. Bring it up to date in place, keeping what was sold today: the new quota less
 * today's volume remains, and the bid is recomputed on the new quota.
 */
export function ensureBidShape(order) {
  if (!order || typeof order !== "object") return order;
  if (!Number.isFinite(Number(order.basePrice))) order.basePrice = Number(order.unitPrice) || 0;
  if (!Number.isFinite(Number(order.soldToday))) order.soldToday = 0;
  const quota = bidQuotaFor(order.item);
  if (Number(order.totalQtyPerDay) !== quota) {
    order.totalQtyPerDay = quota;
    order.remainingQty = Math.max(0, Math.min(Number(order.remainingQty) || 0, quota - Number(order.soldToday)));
    if (Number(order.soldToday) > 0) order.unitPrice = npcBidFor(order.basePrice, order.soldToday, bidRuleFor(order));
  }
  return order;
}

/**
 * Names no player may take (Bug #433): every name the game's own messages are signed with, and every NPC buyer on the
 * exchange, derived from the lists the server uses so a new sender or buyer is reserved without anyone retyping it.
 */
export const RESERVED_CORPORATION_NAMES = Object.freeze([...new Set([
  ...Object.values(SYSTEM_SENDERS),
  ...NPC_BUY_SEED.map((seed) => seed.buyer),
  ...NPC_NAMES // ISP-121 (AB#813): Sol's NPC corporations and the authorities, data/npc-corporations.json
])]);

/** Give the global state a market: an order book, and every standing buy order it lacks. Keeps what exists. */
export function ensureMarketState(globalState) {
  if (!globalState.market || typeof globalState.market !== "object") globalState.market = {};
  if (!Array.isArray(globalState.market.orderBook)) globalState.market.orderBook = [];
  if (!Array.isArray(globalState.market.buyOrders)) globalState.market.buyOrders = []; // AB#1054: players' buy orders
  globalState.market.priceHistory = normalizePriceHistory(globalState.market.priceHistory); // AB#715, and cleans a saved one
  if (!Array.isArray(globalState.market.npcBuyOrders)) globalState.market.npcBuyOrders = [];
  for (const seed of NPC_BUY_SEED) {
    const id = `npc-buy-${seed.item.toLowerCase().replace(/\s+/g, "-")}-daily`;
    if (!globalState.market.npcBuyOrders.some((o) => o.id === id)) {
      globalState.market.npcBuyOrders.push({
        id,
        item: seed.item,
        buyer: seed.buyer,
        // ISP-87: `basePrice` is what the buyer pays an empty market; `unitPrice` is what it pays now, after the
        // volume already sold into it today. `soldToday` is what moved it.
        basePrice: seed.unitPrice,
        unitPrice: seed.unitPrice,
        soldToday: 0,
        totalQtyPerDay: bidQuotaFor(seed.item), // AB#2365: the item's own quota
        remainingQty: bidQuotaFor(seed.item),
        lastResetDate: ""
      });
    }
  }
  // AB#2365: an order a saved state already has is brought to its item's quota now, not at its next sale or reset,
  // so the Exchange never shows a product's order at the world's 7,000.
  for (const order of globalState.market.npcBuyOrders) ensureBidShape(order);
  // ISP-122 (AB#815): the NPC corporations' asks, added if missing and never refilled here, so a restart neither
  // duplicates them nor tops them up; the daily tick refills them (server/ticks.js).
  placeNpcAsks(globalState.market, { refill: false });
  return globalState;
}

// AB#715: imported beside its use in ensureMarketState, rather than in the import block that parallel pull requests all edit.

/** Everything the server needs in its global state, from a saved state or the seed. Idempotent. */
export function normalizeGlobalState(raw) {
  return ensureBeltState(ensureMarketState(ensureGlobalSocialState(normalizeStateShape(dropCombatReports(raw)))));
}

/**
 * ISP-166 (AB#860): the global combat report feed is gone. Every report in it was written by POST /api/combat/simulate
 * (removed for Bug #1036: no login, unbounded attacker-supplied names, sent to every client), and real combat reports
 * are private to the two corporations (v0.10). A state file that still has the feed loses it on load.
 */
function dropCombatReports(raw) {
  if (raw && typeof raw === "object" && "combatReports" in raw) delete raw.combatReports;
  return raw;
}

/**
 * How many combat reports a state file held, and how big they were, without anything from inside them: logged once, as
 * the load drops them (AB#860). Null when there are none.
 */
export function storedCombatReportSummary(globalState) {
  const reports = Array.isArray(globalState?.combatReports) ? globalState.combatReports : [];
  if (!reports.length) return null;
  return { count: reports.length, bytes: Buffer.byteLength(JSON.stringify(reports)) };
}

/** The global state a fresh install starts with: what tests check the shape of, instead of data/state.json. */
export function freshGlobalState() {
  return normalizeGlobalState(getSeedState());
}

