// What the next extractor yard costs (ISP-303, AB#2286; ECONOMY.md "Sinks that scale with income", sink 3). The n-th
// yard costs extractorYardCost x extractorYardPriceGrowth^(n-1), rounded to the nearest 1,000 - 50,000, 63,000,
// 78,000, 98,000, 122,000, 153,000 - and the Supply Forecast discount comes after. One rule for the server's build
// (server/construction.js) and the page's quotes (constructionPanel.js, the lease view), from data/economy.json's
// buildings as GET /api/bootstrap sends them. A yard already built keeps its book value: only the next one costs more.
// Chosen, not derived; the Board has not seen it (AB#778). Pure: it loads in node and the browser.

export const YARD_NAME = "Basic Extractor Yard";

/** How many extractor yards the corporation has built. */
export function yardsOwned(corp) {
  return (corp?.buildings || []).filter((b) => b?.name === YARD_NAME).length;
}

/** The price of the corporation's next yard, given how many it has; NaN when the prices have not loaded. */
export function nextYardPrice(owned, buildings, hasSupplyForecast = false) {
  const base = Number(buildings?.extractorYardCost);
  if (!Number.isFinite(base) || base <= 0) return NaN;
  const growth = Number(buildings?.extractorYardPriceGrowth) || 1;
  const price = Math.round((base * growth ** Math.max(0, Math.floor(Number(owned) || 0))) / 1000) * 1000;
  if (!hasSupplyForecast) return price;
  const multiplier = Number(buildings?.supplyForecastCostMultiplier);
  return Number.isFinite(multiplier) ? Math.round(price * multiplier) : NaN;
}

/** The next yard's price for this corporation: its yard count and its Supply Forecast research. */
export function nextYardPriceFor(corp, buildings) {
  return nextYardPrice(yardsOwned(corp), buildings, (corp?.unlockedTech || []).includes("tt-supply-forecast"));
}
