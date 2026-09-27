// ISP-157 (AB#851): any corporation's cap table, as a signed-in player may see it: its share counts and each holder by
// corporation name with shares and percentage (server/shareRegistry.js). Never an account id or an e-mail. A read only:
// nothing in this story can move a share away from the founder.
import { requireAuth } from "../auth.js";
import { getAccountById, getAllAccountIds } from "../gameState.js";
import { publicCapTable } from "../shareRegistry.js";

const NOT_FOUND = { error: "No such corporation." };
const MARKET_MAKER = "Intergalactic Stock Exchange";

export function registerCapTableRoutes(app) {
  app.get("/api/corporations/:corpId/cap-table", requireAuth, (req, res) => {
    const wanted = String(req.params.corpId ?? "");
    // As the credit rating: every corporation is looked at whatever the id, and a miss is one answer.
    const byPublicId = new Map();
    for (const id of getAllAccountIds()) {
      const corp = getAccountById(id)?.state?.corp;
      if (corp?.publicId) byPublicId.set(corp.publicId, corp);
    }
    const found = byPublicId.get(wanted);
    if (!found?.shareRegistry) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const nameOf = (holder) => (holder?.kind === "npc" ? MARKET_MAKER : byPublicId.get(holder?.corpId)?.corporationName ?? null);
    res.json(publicCapTable(found, nameOf));
  });
}
