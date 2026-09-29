# AB#4824 (ISP-255 slice b): every changed string

Slice b covers the Credit group: the Development Bank's loans, its Bond Board, the Loan Board between corporations,
and default recovery.

- **Measured first:** 71 sentences in the named files (server/bonds.js, loans.js, playerLoans.js, loanServicing.js,
  defaultRecovery.js, bondServicing.js, recoveryHold.js, the two routes, and the three boards' views), as builder-2
  counted. The sentence count misses three other kinds of string:
  - about 15 refusals that begin with a template;
  - 23 notice titles;
  - about 15 status badges and recovery rows.

  That comes to about 125, under 150, so the slice was not split.
- **Where they live:** the files are in `server/`, not `server/game/` as the item says.
- **The approach:** slice A's, and C1a's reading of the server's `insufficient-credits` code as Unfunded (Bugs #4807,
  #4814, #4820, #4822). The plain words stay, and a protocol line from public/scripts/protocol.js follows them.
- **Screen codes:** the Bank and its Bond Board carry the Bank's code, ISA-FIN-1
  (`building-deep-space-development-bank`). The Loan Board carries its own, ISA-FIN-4 (`loans-board`).

## Refusals with their code, so the page reads Unfunded (server; the routes now pass `code` on)

| File | Old | New |
|---|---|---|
| server/bonds.js | "Subscribing takes {n} credits." | "… Subscribe to fewer units, or sell goods to raise the credits first." and code `insufficient-credits` |
| server/playerLoans.js | "Offering this loan holds {n} credits in escrow, and you have {m}." | "… Offer {m} or less." and code `insufficient-credits` |
| server/loanServicing.js | "Paying it off takes {n} credits." | "Paying it off takes {n} credits; you have {m}. Keep paying daily, or raise the credits and pay it off then." and code `insufficient-credits` |
| server/routes/bonds.js, server/routes/loans.js | a refusal's body was `{ error }` | `{ error, code }` when the refusal has a code |

## Reworded: the next step added (ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/bonds.js | "Only {n} units of that series are left." | "… Subscribe to {n} or fewer." |
| server/playerLoans.js | "Two corporations may lend each other at most {cap} credits in 30 days; {n} is already lent between you." | "… Choose an offer of {cap − n} credits or less." |
| server/loans.js | "Borrowing this much would leave no credit: the grade after it would be D." | "… Borrow less." |
| server/loans.js | "That quote has already been used." | "… Ask for a new one." |
| public/scripts/views/loanBoard.js (the page's own check) | "Offering {n} credits holds them in escrow; you have {m}." | "… Offer {m} or less." |

## Form lines and the log (client)

| File | Old (unchanged plain words) | New: added after them |
|---|---|---|
| views/developmentBank.js | Quote form: "{server message}", "The Bank declined to quote." / "The Bank refused the quote. Ask for a new one." | `DENIED` or `UNFUNDED, BALANCE INSUFFICIENT` `// ISA-FIN-1` |
| views/bondBoard.js | Issue form: "{server message}" or "The Bank refused the series." | `DENIED` or `UNFUNDED…` `// ISA-FIN-1` |
| views/bondBoard.js | Subscribe form: "Enter 1 to {n} units." | `DENIED // ISA-FIN-1` |
| views/bondBoard.js | Subscribe form: "{server message}" or "The Bank refused to sell those units." | `DENIED` or `UNFUNDED…` `// ISA-FIN-1` |
| views/bondBoard.js | "The Bank's bond listings could not be read." (now escaped, as every other line is) | `UNSUCCESSFUL // ISA-FIN-1` |
| views/loanBoard.js | Post form: "Offering {n} credits … Offer {m} or less." | `UNFUNDED, BALANCE INSUFFICIENT // ISA-FIN-4` |
| views/loanBoard.js | Post form: "{server message}" or "The offer was not posted." | `DENIED` or `UNFUNDED…` `// ISA-FIN-4` |
| views/loanBoard.js | Log: "Offered {n} credits on the loan board." | `LODGED // ISA-FIN-4` |
| views/loanBoard.js | Log: "Borrowed {n} credits from {lender}." | `IN FORCE // ISA-FIN-4` |
| views/loanBoard.js | Log: "Offer withdrawn; its escrow is back in your account." | `WITHDRAWN // ISA-FIN-4` |
| views/loanBoard.js | Log: "{server message}", "The loan was not taken." / "The offer was not withdrawn." | `DENIED` or `UNFUNDED…` `// ISA-FIN-4` |

The Bank's payoff refusal is left as it was. It replaces the Pay off button's label rather than a status line, so a
phrase beside it would sit inside a button. Its words now say what to do next (above).

## Statuses (client)

| File | Old (unchanged) | New: added beside it |
|---|---|---|
| bondBoard.js (series badge) | "Subscribing" / "Closing" | `LODGED // ISA-FIN-1` |
| same | "Current" | `IN FORCE // ISA-FIN-1` |
| same | "Defaulted" | `UNSUCCESSFUL // ISA-FIN-1` |
| same | "Redeemed" | `CONCLUDED // ISA-FIN-1` |
| loanBoard.js (loan badge) | "Current" / "Repaid" / "In default" | `IN FORCE` / `CONCLUDED` / `UNSUCCESSFUL` `// ISA-FIN-4` |
| loanBoard.js (recovery) | Borrower: "Your assets will be sold on {time}." Lender: "Begins {time} unless the arrears are paid" | `FILED, AWAITING REVIEW // ISA-FIN-4` |
| same | Lender: "Cancelled: the arrears were paid in time" | `WITHDRAWN // ISA-FIN-4` |
| devBank.js (facility) | "Current" | `IN FORCE // ISA-FIN-1` |
| same | a closed facility, "… repaid {time}" | `CONCLUDED // ISA-FIN-1` |

A badge and its phrase are one span, so the card's flex header keeps them together. The first look split them across
the header.

These are left without a line:
- "In arrears" (bonds, loans and facilities) and a bond's "Lapsed". Their plain words already are the guide's phrase.
- The grade badges, the countdowns, the terms, what was recovered, and the rating reasons. These are figures, not a
  record's state.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/bondServicing.js | "Bond payment missed" | In arrears, ISA-FIN-1 |
| same | "Bond series in default" / "A bond you hold has defaulted" | Unsuccessful, ISA-FIN-1 |
| same | "Bond redeemed" | Concluded, ISA-FIN-1 |
| server/loanServicing.js | "Loan payment missed" / "A borrower missed a payment" | In arrears |
| same | "Loan repaid" (both sides) | Concluded |
| same | "Loan in default" / "A loan is in default" | Unsuccessful |
| server/defaultRecovery.js | "Your assets will be sold in 24 hours" / "Recovery begins in 24 hours" / "Bond recovery begins in 24 hours" | Filed, awaiting review |
| same | "Sale cancelled" / "Recovery cancelled" / "Bond recovery cancelled" | Withdrawn |
| same | "Debt recovered" / "Bond recovery" | Concluded |

A loan's notices carry ISA-FIN-4 for a player loan and ISA-FIN-1 for the Bank's own. The recovery notices carry
ISA-FIN-4 for a player loan and ISA-FIN-1 for a bond series.

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the step, or states it plainly enough to act on:
- **Bonds:** the level, unit and coupon bounds; "It can issue again when that window closes."; "…needs more days of
  statements first."; "Units must be a whole number of at least 1."
- **Bank loans:** "Ask for a new one." (no such quote, expired, terms changed); the principal bounds ("At most {n}
  credits…", "Principal must be a whole number of credits, at least {n}."); "Unrated corporations may borrow only on
  {product}."
- **The Loan Board:** the principal, rate, term and grade bounds.
- **The recovery hold:** "Paying what is in arrears cancels the sale of your assets."

**Pass, because the state holds or nothing can be done now:**
- "A corporation cannot subscribe to its own bonds / borrow from itself."
- "That series has closed to subscribers."; "That offer is no longer open."; "That loan is already closed."
- "The Development Bank extends no new credit at grade D." and "Issuing takes a grade of B or better; your
  corporation is {grade}." The grade is the credit desk's reading of the statements, so it has no single next step.
- "This offer asks for a grade of {g} or better; yours is {grade}."
- "Too little income over the last 30 days to borrow on this product." This is a product's availability, shown on
  its card.

**Defensive, reached only by a stale or hand-made request, or a settlement fault.** Not reworded:
- "No such corporation / loan / loan product / offer / bond series / player loan / defaulted bond series."
- "The corporation that made this offer no longer exists."
- "That offer's escrow no longer holds its principal. Nothing was moved."
- "The principal could not be held in escrow: …"; "The escrow could not be released: …"; "The bank could not
  disburse: …"

**Failed, reworded.** The eight above, and the page's own escrow check.

No changed string names Aria Voss.

## Found while looking, filed apart

The Loan Board shows "Payments 4 of 0, 0 a day" on every player loan. AB#947 put a `// ref:` comment in the middle of
a line in `loanSummary` (server/playerLoans.js), which commented out `termDays` and `dailyPayment`. It is filed and
fixed as its own Bug, on its own branch.

## Screenshots, from e2e/credit-protocol.spec.js at 1280x800

1. `1-loans-lent.png`: the lender's loans. Repaid is Concluded, In default is Unsuccessful, a recovery under way is
   Filed, awaiting review, and In arrears stands alone.
2. `2-borrower-warning.png`: the borrower's warning before its assets are sold, Filed, awaiting review.
3. `3-notice-sale-scheduled.png`: "Your assets will be sold in 24 hours", with its protocol.
4. `4-offer-unfunded.png`: an offer larger than the lender's credits. How much it can offer, then Unfunded.
5. `5-quote-denied.png`: a quote above the facility's limit, Denied.
6. `6-bond-subscribe-denied.png`: more units than are left, Denied.
7. `7-bond-holding-current.png`: a held series, Current, In force.
