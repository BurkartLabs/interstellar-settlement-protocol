// The upgrade control on an extractor yard (ISP-103, AB#795): its tier, the next tier's price, what changes, and either
// an Upgrade button or the reason there is none. The tiers, prices, caps and the level each tier opens at are the
// server's (data/economy.json and data/milestones.json, sent by GET /api/bootstrap as appState.economy); the running
// costs are the server's rule fed those numbers (miningProjection.js, held equal to the server by its tests). The
// checks mirror server/upgrades.js, so a button offered is one the server will accept, and the server's own refusal
// is shown if it disagrees. Design and numbers: docs/design/upgrades.md (AB#791). Pure: it loads in node.
import { escapeHtml } from "./html.js";
import { toCurrency } from "./helpers.js";
import { bestThroughput, costPerHourFor, operationsForTier, yardTierFor, yardUpkeepPerHourFor } from "./miningProjection.js";

// The extractor card around this control prints money with toCurrency ("$1,234"), so the control does too.
const money = (n) => toCurrency(Math.floor(n));
const num = (n) => Math.round(n).toLocaleString("en-US");
const utc = (ms) => new Date(ms).toISOString().slice(11, 16);

/** A tier's figures at its best rate: cap, best rate, running cost an hour (with this yard's upkeep) and net an hour. */
function tierFigures(tier, yardIndex, economy, efficiency) {
  const { operations, buildings } = economy;
  const { throughputCap } = yardTierFor(tier, operations, buildings);
  const ops = operationsForTier(tier, operations, buildings);
  const upkeepPerHour = yardUpkeepPerHourFor(yardIndex, buildings);
  const best = bestThroughput({ operations: ops, unitPrice: economy.silicateUnitPrice, taxPct: economy.salesTaxPct, efficiency, upkeepPerHour, max: throughputCap });
  return { cap: throughputCap, rate: best.throughputPerHour, costPerHour: costPerHourFor(best.throughputPerHour, ops) + upkeepPerHour, netPerHour: best.profitPerHour };
}

/**
 * What the control shows for one extractor: { tier, lastTier, buildingId, next, locked, blocked }. `next` is the next
 * tier's { tier, cost, offlineHours, before, after }, or null at the last tier. `locked` replaces the button with a
 * reason (the last tier, the level's limit, nothing to price); `blocked` keeps the button, disabled, with its reason
 * (a running cycle, an upgrade under way, too little credit). Both are "" when the button is live.
 */
export function yardUpgradeView(extractor, corp = {}, economy = {}, { now = Date.now(), efficiency = 1 } = {}) {
  const upgrades = economy?.buildings?.extractorYardUpgrades;
  const tier = Math.max(1, Math.floor(Number(extractor?.tier) || 1));
  const view = { tier, lastTier: tier, buildingId: extractor?.buildingId || "", next: null, locked: "", blocked: "" };
  if (!Array.isArray(upgrades) || !economy?.operations) {
    view.locked = "The upgrade prices have not loaded; reload the page."; // fail closed, never a guessed price
    return view;
  }
  view.lastTier = 1 + upgrades.length;
  if (!view.buildingId) {
    view.locked = "This yard has no building record to upgrade.";
    return view;
  }
  if (tier >= view.lastTier) {
    view.locked = `Tier ${tier} is this yard's last.`;
    return view;
  }
  const row = upgrades.find((u) => u.toTier === tier + 1);
  if (!row) {
    view.locked = "The next tier's price has not loaded; reload the page.";
    return view;
  }
  const yardIndex = (corp.mining?.silicateExtractors || []).findIndex((e) => e.id === extractor.id);
  view.next = {
    tier: tier + 1,
    cost: row.upgradeCost,
    offlineHours: row.offlineHours,
    before: tierFigures(tier, yardIndex, economy, efficiency),
    after: tierFigures(tier + 1, yardIndex, economy, efficiency)
  };

  const allowed = Math.max(1, Math.floor(Number(corp.unlocks?.maxUpgradeTier) || 1));
  if (view.next.tier > allowed) {
    const opens = (economy.upgradeTierByLevel || []).filter((l) => l.maxUpgradeTier >= view.next.tier).sort((a, b) => a.level - b.level)[0];
    view.locked = opens
      ? `Tier ${view.next.tier} opens at Corporation Level ${opens.level}; you are Level ${Number(corp.level) || 0}.`
      : `Tier ${view.next.tier} is not open at any level yet.`;
    return view;
  }
  const credits = Number(corp.finances?.credits || 0);
  if (extractor.active) view.blocked = "Stop or finish its mining cycle first: the yard is offline while it upgrades.";
  else if (Number(extractor.upgradingUntil) > now) view.blocked = `Upgrading: back online at ${utc(Number(extractor.upgradingUntil))} UTC.`;
  else if (credits < row.upgradeCost) view.blocked = `Needs ${money(row.upgradeCost)}; you have ${money(credits)}.`;
  return view;
}

/** The control's markup for one extractor row. */
export function yardUpgradeHtml(view, extractorId) {
  const exId = escapeHtml(extractorId);
  const head = `<p class="yard-upgrade-tier"><strong>Tier ${view.tier}</strong> of ${view.lastTier}</p>`;
  const n = view.next;
  const change = n
    ? `<p class="muted action-hint yard-upgrade-change">Tier ${n.tier}: cap ${num(n.before.cap)} &rarr; ${num(n.after.cap)} t/h &middot; best rate ${num(n.before.rate)} &rarr; ${num(n.after.rate)} t/h &middot; running cost at best ${money(n.before.costPerHour)} &rarr; ${money(n.after.costPerHour)}/h &middot; nets ${money(n.before.netPerHour)} &rarr; ${money(n.after.netPerHour)}/h &middot; offline ${n.offlineHours} h while it upgrades</p>`
    : "";
  const action = view.locked
    ? `<p class="facility-blocked yard-upgrade-locked">${escapeHtml(view.locked)}</p>`
    : `${view.blocked ? `<p class="facility-blocked">${escapeHtml(view.blocked)}</p>` : ""}<button type="button" class="btn btn-outline btn-sm yard-upgrade-btn" data-upgrade-building="${escapeHtml(view.buildingId)}" data-extractor-id="${exId}"${view.blocked ? " disabled" : ""}>Upgrade to tier ${n.tier} (${money(n.cost)})</button>`;
  return `<div class="yard-upgrade" data-upgrade-for="${exId}">${head}${change}${action}<p class="muted action-hint yard-upgrade-status" role="status" aria-live="polite" data-for="${exId}"></p></div>`;
}

export function upgradePath(accountId, buildingId) {
  return `/api/accounts/${encodeURIComponent(accountId)}/gameplay/buildings/${encodeURIComponent(buildingId)}/upgrade`;
}
