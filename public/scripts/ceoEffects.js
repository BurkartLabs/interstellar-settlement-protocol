// CEO Insight effects that both the server charges and the browser shows (Bug #983). Only programs marked "live" in
// data/ceo-insight.json have an effect; tests/unit/ceoInsightCatalog.test.js fails if one is marked live without one.

const OFFICE_RENEWAL_PER_DAY = 1000;
const ISA_REGULATORY_NAVIGATION = "ceo-isa-regulatory-navigation";

/** Whether a program is on sale: a planned program has no effect yet and cannot be enrolled in. */
export function isInsightProgramLive(program) {
  return program?.status === "live";
}

/** The price of renewing an office for durationDays: 1,000 a day, 5% less with ISA Regulatory Navigation. */
export function officeRenewalCost(completedInsights, durationDays) {
  const base = durationDays * OFFICE_RENEWAL_PER_DAY;
  return (completedInsights || []).includes(ISA_REGULATORY_NAVIGATION) ? Math.round(base * 0.95) : base;
}

const CONTRACT_LAW = "ceo-contract-law";

/**
 * What a completed mission pays, in credits: the number in its reward text ("12,000 Credits"), 8% more with Contract
 * Law Essentials, rounded. The server credits this and the client reports it, so the two cannot differ (Bug #1009).
 */
export function missionRewardCredits(reward, completedInsights) {
  const base = parseInt(String(reward ?? "").replace(/[^0-9]/g, ""), 10) || 0;
  return (completedInsights || []).includes(CONTRACT_LAW) ? Math.round(base * 1.08) : base;
}
