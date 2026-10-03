// public/scripts/bureauTerms.js: the page's copy of the Bureau's terms (AB#4689 slice 8), from GET /api/mission-agents:
// the reputation tiers in points, the save multiplier and priority processing. Assignments sets them when the catalog
// arrives; the Station quotes ISA fees through priorityQuote, so a Valued corporation is quoted what the server charges.
import { bureauPoints, priorityPrice } from "./bureauStanding.js";

let terms = { thresholds: [0], titles: ["Unknown"], multiplier: 1, priorityProcessingPct: 0 };

/** Keep the catalog's terms (applyMissionAgentsCatalog, views/assignments.js). */
export function setBureauTerms(reputationTiers) {
  terms = {
    thresholds: reputationTiers.thresholds,
    titles: reputationTiers.titles,
    multiplier: Number(reputationTiers.multiplier) || 1,
    priorityProcessingPct: Number(reputationTiers.priorityProcessingPct) || 0
  };
}

/** An ISA fee as the server charges it: priority processing taken off from the grade Valued. */
export function priorityQuote(price, corp) {
  return priorityPrice(price, bureauPoints(corp, terms.multiplier), terms, terms.priorityProcessingPct);
}
