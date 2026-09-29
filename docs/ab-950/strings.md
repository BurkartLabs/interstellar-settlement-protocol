# AB#950 slice A (Industry): every changed string

ISP-254, the Industry group: Corporate R&D, Refinery Chains, Logistics. The Company and Station groups are later
slices.

Under docs/design/BUREAUCRATIC_UI.md's first rule, the plain words stay. So most rows below keep their text, and gain
a protocol line after it: the guide's phrase for the meaning, then the screen's document code, shown as
`PHRASE // CODE` with the code aria-hidden. Four refusals were also reworded to say what to do next (Bug #4807); they
are last.

Codes: CORP-RND-1 is Corporate R&D, CORP-IND-1 is Refinery Chains, CORP-LOG-1 is Logistics (data/section-codes.json).

## Status lines, refusals and the command log

| File | Old (unchanged plain words) | New: what is added after them |
|---|---|---|
| public/scripts/views/research.js | `#rnd-status`: "{tech} entered the queue. {cost} committed." | `LODGED // CORP-RND-1` |
| public/scripts/views/research.js | `#rnd-status`: "R&D queue action failed: {server message}" | `DENIED // CORP-RND-1`, or `UNFUNDED, BALANCE INSUFFICIENT // CORP-RND-1` for want of credits |
| public/scripts/views/research.js | Command log: "{tech} added to the corporate R&D queue. Funding locked: {cost}." | `LODGED // CORP-RND-1` |
| public/scripts/views/research.js | Command log: "R&D queue request rejected. {server message}" | `DENIED` or `UNFUNDED…` `// CORP-RND-1` |
| public/scripts/views/refinery.js | Status and log: "Refinery run started: {inputs}, ready in {h}h." (batches and quantity paths) | `IN FORCE // CORP-IND-1` |
| public/scripts/views/refinery.js | Log: "Refinery error: {server message}" (both paths) | `DENIED` or `UNFUNDED…` `// CORP-IND-1` |
| public/scripts/views/refinery.js | Field error under Quantity or Batches: {reason} (the page's check or the server's) | `DENIED` or `UNFUNDED…` `// CORP-IND-1` |
| public/scripts/views/refinery.js | Status and log: "{reason the build is disabled}" / "Build error: {reason}" | `DENIED` or `UNFUNDED…` `// CORP-IND-1` |
| public/scripts/views/refinery.js | Status and log: "Refinery commissioned." | `CONCLUDED // CORP-IND-1` |
| public/scripts/views/refinery.js | Status and log: "Build error: {server message}" | `DENIED` or `UNFUNDED…` `// CORP-IND-1` |
| public/scripts/views/logistics.js | Card status and log: "Dispatched {goods} to {station} for {fee} — arriving in {n} min." / "Transfer dispatched." | `IN FORCE // CORP-LOG-1` |
| public/scripts/views/logistics.js | Card status and log: "{server message}" / "Transfer failed." | `DENIED` or `UNFUNDED…` `// CORP-LOG-1` |

## Status labels

| File | Old label (unchanged) | New: added beside it |
|---|---|---|
| public/scripts/views/research.js (queue card, html.js `queueItemsHtml`) | "Queued" | `LODGED // CORP-RND-1` |
| same | "In progress" | `IN FORCE // CORP-RND-1` |
| public/scripts/views/research.js (tree node, html.js `researchNodeHtml`) | badge "In queue" | `LODGED // CORP-RND-1` |
| same | badge "Complete" | `CONCLUDED // CORP-RND-1` |
| public/scripts/views/logistics.js (in-transit table) | badge "Held", "Destination unreachable" | `SUSPENDED // CORP-LOG-1` |

Left without a line, because no plain status word sits there for the phrase to stand beside (the guide: a code or
phrase never carries meaning alone): active run cards (under "Active runs", with time remaining), in-transit rows
(an ETA), and the availability hints "All refineries busy", "Synthesis Array busy", "Research unlocked", "Enough" and
"Short by N", which say what can be done now rather than the state of a record.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/routes/research.js | "R&D Queued" | Lodged, CORP-RND-1 |
| server/ticks.js | "R&D Complete" | Concluded, CORP-RND-1 |
| server/routes/refining.js | "Refinery Cycle Started" | In force, CORP-IND-1 |
| server/construction.js | "Refinery Commissioned" | Concluded, CORP-IND-1 |
| server/construction.js | "Refinery Complex Online" | Concluded, CORP-IND-1 |
| server/construction.js | "Synthesis Array Commissioned" | Concluded, CORP-IND-1 |

"CEO Insight Queued" (server/routes/research.js) is the Company group's and is left for that slice.

## Reworded: the next step added (Bug #4807, ISP-6's rule)

| File | Old | New |
|---|---|---|
| public/scripts/refineQuantity.js | "You have 1,000 Silicates here, not 100,000." | "You have 1,000 Silicates here, not 100,000. Enter 1,000 or fewer, or bring more Silicates here." (below one batch: "…Bring at least 100 Silicates here first.") |
| public/scripts/refineryRun.js | "Not enough Nickel at this station. Need 150 but only have 149." | "…only have 149. Bring more to this station, or run fewer batches." (once, after every short input) |
| server/routes/logistics.js | "This shipment costs {fee} credits in fees and {tariff} in the destination system's concession tariff; you have {credits}." | "…you have {credits}. Move fewer units or sell goods first." |
| server/routes/research.js | "{tech} queueing requires {cost} credits. Current reserves: {credits} credits." | "…Current reserves: {credits} credits. Sell goods or finish an assignment to raise the credits, then queue it again." |

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the next step, or states it plainly enough to act on:
- **R&D:** "requires: {research}"; "requires Corp Level {n}"; "All Tier 1 research must be completed first"; the
  queue-full message (names when a slot frees).
- **Refinery:** "Build a Refinery before starting a production run."; "That refinery was not found… reload and choose
  another."; "This chain requires: {research}"; "Tier 4 chains run in a Synthesis Array. Build one…"; every field
  message ("Enter…", "Runs use whole batches of 100: enter 900 or 1,000.", "A run lasts at most a week: at most {n}
  batches…", "A run needs at least {n} {item}.").
- **Logistics:** "Move {n} or fewer."; "Pick one from its list."; "Split it into two transfers."; "Add at least one
  item to move."; "Choose the station to move goods from."; "enter a whole number of at least 1"; "Choose one from the
  Logistics tab."; "Move fewer units or sell goods first."; "Dock at a station, then move goods to it."

**Pass, nothing to do.** The state already holds, or the item cannot be taken yet:
- "{tech} has already been completed." and "…is already in the corporate R&D queue."
- "…planned for a later version."
- "{refinery} already has an active production cycle." and "All refineries are currently running cycles." (a run is
  under way; waiting for it is the step)
- "This chain has no recipe the refinery can run. Nothing was used." (a data fault the player cannot fix; it says
  nothing was lost)

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "Unknown research node."
- "Unknown refinery chain."
- "Account not found."
- "No shipping route joins those stations."

**Failed, reworded.** The four above (Bug #4807).
