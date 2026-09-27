// server/game/control.js: control scores and concession eligibility per system (ISP-226, AB#921; docs/design/TERRITORY.md,
// "Who may hold one" and the state list's "eligible"). Pure: no files and no clock, so tests read it with fixtures.
//
// A system's control score is v0.12's dominance metric (server/game/dominance.js) at the system's own weights from the
// warfare catalog (a Sagittarius Mining Compact counts leases only, the Sirius brokers sales only, and so on): per
// holder, sum over the components with any activity of weight x the holder's share of that component, the weights of
// the live components scaled to 1. A holder is a conglomerate (its one summed share) or an independent corporation.
// The metric reads the last 7 full days, so a score rises while a holder works the system and falls away over a week
// after it stops: that window is the duration. Eligibility adds the 14 days: the grant conditions on each of the last
// concessionEligibleDays daily readings, with no day missing.

const COMPONENTS = ["leases", "extraction", "sales"];
const DAY_MS = 86_400_000;

/**
 * One day's control scores for a system: [{ type, id, name, score }] from the dominance holders `entry`
 * ({ live, groups }) at `weights`, highest first. [] when no live component has a weight here.
 */
export function controlScores(entry, weights) {
  const live = (entry?.live || []).filter((k) => COMPONENTS.includes(k) && Number(weights?.[k]) > 0);
  const total = live.reduce((s, k) => s + weights[k], 0);
  if (!(total > 0)) return [];
  return (entry.groups || [])
    // extraction: the holder's share of the system's tonnes, which a challenge's ADM bar reads (ISP-227, AB#922)
    .map((g) => ({ type: g.type, id: g.id, name: g.name, score: live.reduce((s, k) => s + (weights[k] / total) * (Number(g.parts?.[k]) || 0), 0), extraction: Number(g.parts?.extraction) || 0 }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Whether each holder met the grant conditions on one day's `scores`, under `terms` (warfare.js concessionTermsFor): a
 * score of at least concessionGrantPct, a lead of concessionLeadRatio over the first holder outside the system's
 * concession places (two in a condominium), and a holder type the system accepts. A Set of "type:id".
 */
export function metOn(scores, terms) {
  const out = new Set();
  if (!terms) return out;
  const places = terms.concessionsPerSystem || 1;
  const next = scores[places]?.score || 0;
  scores.slice(0, places).forEach((h) => {
    if (h.score * 100 >= terms.concessionGrantPct && h.score >= terms.concessionLeadRatio * next && terms.holders.includes(h.type)) out.add(`${h.type}:${h.id}`);
  });
  return out;
}

/**
 * The holders eligible now in a system, from its daily readings `days` ([{ day, computedAt, scores }], any order): those
 * that met the grant conditions on each of the last concessionEligibleDays daily readings, with no day missing. None
 * when the system is never concedable (`terms` null) or the newest reading is older than concessionDataMaxAgeHours
 * (stale data fails closed). Returns { stale, eligible: Set, streaks: Map "type:id" -> consecutive days met }.
 */
export function eligibility(days, terms, now) {
  const sorted = [...(days || [])].sort((a, b) => b.day - a.day);
  const newest = sorted[0];
  const stale = !newest || !terms || now - newest.computedAt > terms.concessionDataMaxAgeHours * 3_600_000;
  const streaks = new Map();
  if (!newest || !terms) return { stale: !newest, eligible: new Set(), streaks };
  let expect = newest.day;
  const met = [];
  for (const d of sorted) {
    if (d.day !== expect) break; // a missing day ends the run: nothing is inferred for it
    met.push(metOn(d.scores, terms));
    expect -= DAY_MS;
  }
  for (const key of met[0] || []) {
    let n = 0;
    while (n < met.length && met[n].has(key)) n += 1;
    streaks.set(key, n);
  }
  const eligible = stale ? new Set() : new Set([...streaks].filter(([, n]) => n >= terms.concessionEligibleDays).map(([k]) => k));
  return { stale, eligible, streaks };
}
