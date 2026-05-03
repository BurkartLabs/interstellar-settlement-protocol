// Reset hooks for game state between tests.
// Because the server/gameState.js module holds in-memory `accountsStore` and
// `state`, tests that share the loaded module would otherwise leak state.
// Use these helpers in `beforeEach` to start clean.

import { mutateState } from "../../server/gameState.js";

export function resetMarketState() {
  mutateState((draft) => {
    if (!draft.market) draft.market = {};
    draft.market.orderBook = [];
    if (Array.isArray(draft.market.npcBuyOrders)) {
      draft.market.npcBuyOrders.forEach((order) => {
        order.remainingQty = order.totalQtyPerDay;
      });
    }
  });
}
