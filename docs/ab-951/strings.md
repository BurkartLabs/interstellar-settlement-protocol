# AB#951 slice 951a (Exchange): every changed string

ISP-255 was measured first and came to about 373 strings, so it was split in four:
- 951a, Exchange: this slice.
- 951b, Credit: AB#4824.
- 951c, Comms and Map: AB#4825.
- 951d, Warfare and arbitration: AB#4826.

951a covers about 104 strings: the Galactic Exchange and Assets, the Stock Exchange with its offerings and dividends, and
the ITC and tariff notices and refusals.

The approach is slice A's (docs/ab-950/strings.md). The plain words stay, and a protocol line from
public/scripts/protocol.js, unchanged, follows them. That line is the guide's phrase, then the screen's code,
aria-hidden:
- `GEX-MKT-1` for the Galactic Exchange;
- `GEX-MKT-13` for the Stock Exchange's building;
- `ITC-LAW-1` for the Trade Commission's building, which the ITC notices cite (the guide notes that ITC findings have no screen of their own);
- `ISA-NAV-1` for tariff filing on the Starmap.

Refusals that failed ISP-6's next-step rule are reworded (Bug #4827); they come last.

## Notices (server)

| Notice | Protocol |
|---|---|
| Listing Sold (marketSettlement.js) | `LODGED // GEX-MKT-1` while some is still listed; `CONCLUDED` once sold out |
| Buy Order Filled (buyOrders.js) | `LODGED` while some is still wanted; `CONCLUDED` once filled |
| ITC Anti-Dumping Investigation (itcService.js) | `FILED, AWAITING REVIEW // ITC-LAW-1` |
| ITC Anti-Dumping Duty Levied | `IN ARREARS // ITC-LAW-1` when some is still owed; `CONCLUDED` when paid in full |

## Statuses and outcomes (client)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| Sell grid row (views/exchange.js) | "Listing created: {n} {item} @ {price}." | `LODGED // GEX-MKT-1` |
| | "Sold {n} {item} at once to buy orders; {m} listed @ {price}." | `LODGED`, or `CONCLUDED` if none is left listed |
| Buy order form | "Bought {n} at once; {m} {item} waiting at {price}." | `LODGED` |
| | "Bought {n} {item}: the order is filled." | `CONCLUDED` |
| Buy from the book | "Executed purchase: …" and in the Command Log "Purchase executed: …" | `CONCLUDED` |
| Sell to a standing buy order | "Sold {n} × {item} at … credited …" and in the Command Log "Sold … credited." | `CONCLUDED` |
| Command Log | "Listing cancelled; the goods are back in your station inventory." | `WITHDRAWN` |
| | "Buy order cancelled; {credits} returned to your reserves." | `WITHDRAWN` |
| Stock Exchange (stockExchange.js) | "Open: {n} shares at {price} credits, {left} left; closes {time}." | `IN FORCE // GEX-MKT-13` |
| | "Closed {time}: {n} sold to corporations and {m} to the market maker, …" | `CONCLUDED` |
| | "From the next period: {pct}%." and, after setting it, "Set: {pct}% from the next period." | `LODGED` |
| | "Changed this week: it may change again {time}." | `SUSPENDED` |
| | "The Exchange could not be read." and "Your corporation could not be read." | `UNSUCCESSFUL` |
| Starmap, tariff filed | "Tariff filed for {system}." (Command Log) | `IN FORCE // ISA-NAV-1` |

## Refusals

Every refusal on these screens gains `DENIED`, or `UNFUNDED, BALANCE INSUFFICIENT` when it carries the
insufficient-credits code. That covers:
- sell listing failed;
- a listing or buy order that could not be cancelled;
- a buy order refused;
- a purchase or standing-order sale rejected;
- the Stock Exchange's order, sale, listing, offering and payout refusals, including its "Enter 1 to {n} shares.";
- a tariff that could not be filed;
- the client's "No stock available for this item."

Every server message behind them was read against ISP-6's rule that an error says what to do next. These failed and are
fixed (Bug #4827):

| Where | Old | New |
|---|---|---|
| routes/market.js, buy from a listing | "Insufficient credits to execute this buy order." | the same, then "Sell goods or finish an assignment to raise the credits, or buy fewer.", with code insufficient-credits |
| buyOrders.js, place a buy order | "This order holds {x}; you have {y}." | the same, then that step, with the code, which the route now passes on |
| routes/market.js, list | "Quantity exceeds available inventory at this station." | "You hold {n} {item} at this station. List {n} or fewer." or "You hold no {item} at this station. Bring some here to list it." |
| views/exchange.js, list | "Quantity exceeds available inventory." | "You hold {n} here. List {n} or fewer." |
| routes/market.js, buy from a listing | "Requested quantity exceeds available sell order volume." | "Only {n} remain on that listing. Buy {n} or fewer." |
| routes/market.js, standing order | "Only {n} units remaining in today's order." | the same, then "Sell {n} or fewer." |
| routes/market.js, standing order | "Insufficient {item} at this station (have {a}, need {b})." | the same, then "Sell {a} or fewer." or "Bring some here to sell it." |
| dividends.js | "The payout ratio may be changed once in 7 days." | the same, then "It may change again {UTC time}." |

The rest pass unchanged:
- Messages that already name their step: "cancel one to list more", "It resets at 00:00 UTC.", "Try again tomorrow, or hold.", "travel there first", the tariff and payout ranges, and "Listing takes …" with its level, statements or grade.
- Defensive messages a player cannot reach from the page: "Account not found.", "Unknown item.", "No such corporation.", "Missing required order fields.", "Unable to …".

## Left as they are

- Assets' empty states ("Nothing held at …", "No infrastructure …") and the capped-list note. These are descriptions, not outcomes.
- The listing's pre-emptive reasons ("Listing on the Exchange takes corporation level …"), the dumping warning on a listing's confirmation, and the payout hint "It may change once in 7 days". These are availability hints, not outcomes, as in slice A.
- The receipts shown after a trade, which are their own component.

## Looked at (1280x800, this branch's server)

The Exchange was seeded by e2e/seed-exchange-account.mjs bids. A throwaway step then left the viewer 50 credits and
opened an ITC investigation: it recorded three days of the viewer's cheap sales with the watch's own recorder
(recordOwnSale) and ran its tick (itcTick). The Stock Exchange was seeded by e2e/seed-stock-exchange.mjs.

1. `1-notice-itc-investigation.png`: the ITC notice, Filed, awaiting review, ITC-LAW-1
2. `2-listing-lodged.png`: a listing created, Lodged
3. `3-bid-unfunded.png`: a buy order the corporation cannot fund, the new next step, Unfunded
4. `4-log-listing-withdrawn.png`: a listing taken down, Withdrawn
5. `5-igsx-issuer-statuses.png`: the issuer's payout set (Lodged), the lock (Suspended), and its open offering (In force)

Tariff filing on the Starmap was not looked at.
