// CEO Insight effects that both the server charges and the browser shows (Bug #983). Only programs marked "live" in
// data/ceo-insight.json have an effect; tests/unit/ceoInsightCatalog.test.js fails if one is marked live without one.

// Bug #1032: the one office price. The Suites panel quotes it and the server charges it, for a first lease and a
// renewal alike; data/stations.json used to carry an officeCost the server never read, which the panel showed instead.
const OFFICE_PER_DAY = 1000;
/** The terms an office can be leased or extended for, in days. */
export const OFFICE_TERMS_DAYS = [7, 14, 21, 28];
const ISA_REGULATORY_NAVIGATION = "ceo-isa-regulatory-navigation";

/** Whether a program is on sale: a planned program has no effect yet and cannot be enrolled in. */
export function isInsightProgramLive(program) {
  return program?.status === "live";
}

/** The price of a first office lease for durationDays: 1,000 a day at every station. */
export function officeLeaseCost(durationDays) {
  return durationDays * OFFICE_PER_DAY;
}

/** The price of renewing an office for durationDays: 1,000 a day, 5% less with ISA Regulatory Navigation. */
export function officeRenewalCost(completedInsights, durationDays) {
  const base = officeLeaseCost(durationDays);
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
