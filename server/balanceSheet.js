// Bug #4647: the balance sheet's debt and receivables lines, which finances.js cannot compute itself because it does not
// see the other corporations, the loan board or the bond series. Loaded by server/index.js; until it is (a test that
// closes a day without the server), both lines are 0, as the holdings line is (AB#854).
//
//   debt         what the corporation owes: every loan it borrowed that is still open (the Development Bank's and other
//                corporations'), its balance and arrears; and every bond series it issued, the face still owed and any
//                arrears (bondsIssuedBy, the figure the credit rating reads).
//   receivables  what it is owed: loans it lent to other corporations that are still open, balance and arrears; the
//                principal of its loan offers held in escrow; and the face of its bond holdings not yet repaid.
//
// Borrowing therefore leaves net worth where it was, less the fees; lending, posting an offer or buying bonds moves
// credits into a receivable and leaves it where it was too. Reads the raw records (no clones): it runs at every close.

import { accountsStore } from "./game/store.js";
import { getState } from "./gameState.js";
import { bondSeriesList, bondsIssuedBy } from "./bonds.js";
import { setDebtValuer, setReceivablesValuer } from "./finances.js";

const OPEN_LOAN = new Set(["active", "arrears"]);
const HELD_BOND = new Set(["subscribing", "live", "arrears", "defaulted"]);
const owed = (loan) => (Number(loan?.balance) || 0) + (Number(loan?.arrears) || 0);
const accounts = () => Object.entries(accountsStore.accounts || {});

/** What `corp` owes, in credits. */
export function debtOf(corp) {
  if (!corp) return 0;
  const loans = (corp.loans || []).filter((l) => OPEN_LOAN.has(l?.state)).reduce((a, l) => a + owed(l), 0);
  const accountId = corp.publicId ? accounts().find(([, a]) => a?.state?.corp?.publicId === corp.publicId)?.[0] : null;
  const bonds = accountId ? bondsIssuedBy(accountId).reduce((a, s) => a + (Number(s.outstandingFace) || 0), 0) : 0;
  return Math.max(0, Math.round(loans + bonds));
}

/** What `corp` is owed, in credits. */
export function receivablesOf(corp) {
  const me = corp?.publicId;
  if (!me) return 0;
  let total = 0;
  for (const [, account] of accounts()) {
    for (const l of account?.state?.corp?.loans || []) if (l?.lender?.kind === "player" && l.lender.corpId === me && OPEN_LOAN.has(l.state)) total += owed(l);
  }
  const offers = getState()?.market?.loanOffers;
  for (const o of Array.isArray(offers) ? offers : []) if (o?.state === "open" && o.lenderCorpId === me) total += Number(o.principal) || 0;
  const series = bondSeriesList();
  for (const h of corp.bondHoldings || []) {
    const s = series.find((x) => x.id === h.seriesId);
    if (s && HELD_BOND.has(s.state) && !s.maturedAt) total += (Number(h.units) || 0) * s.faceValue;
  }
  return Math.max(0, Math.round(total));
}

setDebtValuer(debtOf);
setReceivablesValuer(receivablesOf);
