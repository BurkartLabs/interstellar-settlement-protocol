// server/routes/tariffs.js: a system's concession tariff (ISP-230, AB#925; docs/design/WARFARE.md, "Tariffs").
// Reading it is public, like the control reading: traders must see a rate, and any pending increase with the time it
// takes effect, before they commit. Setting it is the holder's alone (403 otherwise), docked in the system; the rate's
// bounds and steps are checked by ACCOUNT_INPUT before this handler, and again against the system's own cap here.
import { SYSTEMS_BY_ID } from "../game/catalog.js";
import { getAccountById } from "../gameState.js";
import { setTariff, tariffSummary, tariffView } from "../tariffService.js";
import { ownWatch } from "../itcService.js"; // ISP-233 (AB#928)
import { PRICE_HISTORY_ITEMS } from "../priceHistory.js";

export function registerTariffRoutes(app) {
  app.get("/api/systems/:id/tariff", (req, res) => {
    const systemId = String(req.params.id ?? "");
    if (!SYSTEMS_BY_ID.has(systemId)) { res.status(404).json({ error: "No such system." }); return; }
    res.json(tariffView(systemId));
  });

  // ISP-231 (AB#926): the caller's own view: the rate it pays where it is docked, what it holds, and its transfer quotes
  app.get("/api/accounts/:accountId/tariffs", (req, res) => {
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(tariffSummary(corp));
  });

  // ISP-233 (AB#928): the ITC's watch over one item as it applies to the caller: the lines, and its own sales below the
  // line in the window, for the listing warning. Kept beside the tariffs: both are what a trader sees before it sells.
  app.get("/api/accounts/:accountId/itc/:item", (req, res) => {
    const item = String(req.params.item ?? "");
    if (!PRICE_HISTORY_ITEMS.has(item)) { res.status(404).json({ error: "Unknown item." }); return; }
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(ownWatch(corp, item));
  });

  app.post("/api/accounts/:accountId/tariffs/:systemId", (req, res) => {
    const systemId = String(req.params.systemId ?? "");
    if (!SYSTEMS_BY_ID.has(systemId)) { res.status(404).json({ error: "No such system." }); return; }
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    const result = setTariff(corp, systemId, req.body?.pct);
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ok: true, tariff: result.view });
  });
}
