// Direct investments made before POST /api/investments was removed (Bug #689).
//
// That route took the investor's credits, paid nobody and never returned anything. Whatever it stored is left in place
// and reported once at startup, as account, amount and time, for the PM to decide on: refunding is a product call, and
// the target and instrument strings were free text that is never repeated.

/** Every stored direct investment across `accounts`, as { accountId, amount, createdAt }. */
export function directInvestmentRecords(accounts) {
  return (accounts || []).flatMap((account) =>
    (account?.state?.corp?.investments || []).map((inv) => ({
      accountId: account.id,
      amount: Number(inv?.amount) || 0,
      createdAt: inv?.createdAt ?? null
    }))
  );
}
