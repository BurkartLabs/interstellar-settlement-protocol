// AB#1430: the prices the browser quotes, and charges in the dummy profile, read from the economy GET /api/bootstrap
// sends (data/economy.json, kept in appState.economy) — never from a copy here, which the first balance change to that
// file would leave quoting one price while the server charged another (the shape of Bug #1032).
// With no economy loaded every price is NaN, which prints as NaN: a visible fault, not a plausible stale number.
// Pure (callers pass appState.economy), so it loads in node without a window.

const n = (value) => (value === undefined || value === null ? NaN : Number(value));

export function clientPrices(economy) {
  return {
    hireCost: n(economy?.employees?.hireCost),
    payrollPerDay: n(economy?.employees?.payrollPerDay),
    extractorYardCost: n(economy?.buildings?.extractorYardCost),
    extractorYardAssetValue: n(economy?.buildings?.extractorYardAssetValue),
    assemblyFacilityCost: n(economy?.buildings?.assemblyFacilityCost),
    refineryCost: n(economy?.buildings?.refineryCost),
    refineryAssetValue: n(economy?.buildings?.refineryAssetValue),
    probeBuildCost: n(economy?.probes?.buildCost)
  };
}
