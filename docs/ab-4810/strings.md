# AB#4810 slice Ba (Fleet): every changed string

ISP-254 slice B was measured first, as the dispatch asked, and came to more than 150 strings: about 324 sentence
literals across the group, counted by a regex that also catches some help text. It was split in four:
- Ba, Fleet: this slice, AB#4810.
- Bb, raids and mercenaries, with the garrisons: AB#4817.
- Bc, Station: offices, construction, upgrades, repairs and facilities: AB#4818.
- Bd, Operations: AB#4819.

Garrison orders are drawn in the Raids section, so their refusals (server/garrison.js) belong to Bb. Escort refusals
(server/escorts.js) are shown on the Starmap's expedition panel, so they are the Map's.

Slice A's rule still holds (docs/design/BUREAUCRATIC_UI.md): the plain words stay, and the protocol phrase and the
screen's code are added after them, as `PHRASE // CODE`, with the code aria-hidden. This slice reuses
`public/scripts/protocol.js` as it is. The Fleet screen's code is CORP-MIL-1.

## Status lines and the Command Log (public/scripts/views/fleet.js)

| File | Old (unchanged plain words) | New: what is added after them |
|---|---|---|
| views/fleet.js | Log: "{fleet} formed." | `CONCLUDED // CORP-MIL-1` |
| views/fleet.js | Log: "{fleet} split off." | `CONCLUDED // CORP-MIL-1` |
| views/fleet.js | Log: "Merged into {fleet}." | `CONCLUDED // CORP-MIL-1` |
| views/fleet.js | Log: "Fleet disbanded." | `CONCLUDED // CORP-MIL-1` |
| views/fleet.js | Log: "{fleet} is on its way." | `IN FORCE // CORP-MIL-1` |
| views/fleet.js | Log: the receipt's title, or "Ships queued." | `LODGED // CORP-MIL-1` |
| views/fleet.js | Log: the receipt's title, or "Production cancelled." | `WITHDRAWN // CORP-MIL-1` |
| views/fleet.js | Log: the receipt's title, or "Training started." | `LODGED // CORP-MIL-1` |
| views/fleet.js | Log: the receipt's title, or "Training cancelled." | `WITHDRAWN // CORP-MIL-1` |
| views/fleet.js | A fleet card's or the form's status: {server refusal}, or "The order was refused." | `DENIED // CORP-MIL-1` |
| shipyardPanel.js | Shipyard status: {server refusal}, "The shipyard refused that.", "Could not cancel." | `DENIED` or `UNFUNDED, BALANCE INSUFFICIENT` `// CORP-MIL-1` |
| trainingPanel.js | Training status: {server refusal}, "Headquarters refused that.", "Could not cancel." | `DENIED` or `UNFUNDED…` `// CORP-MIL-1` |

## Status labels (public/scripts/fleetView.js)

| File | Old label (unchanged) | New: added beside it |
|---|---|---|
| fleetView.js (fleet card) | badge "In transit" | `IN FORCE // CORP-MIL-1` |
| fleetView.js (forces summary) | "Upkeep is unpaid: readiness falls 10 points a day…" | `IN ARREARS // CORP-MIL-1` |

These are left without a line, because no record's state stands there for the phrase to sit beside (the guide says a
phrase never carries meaning alone):
- The badge "Stationed": a place, with no order open.
- "Upkeep is paid.": nothing is owed.
- The job rows on the slips and in training: "ready in…" and "starts in…" are times, like slice A's run cards.
- The destination picker's "Out of reach." and "Needs navigation research.": what can be done now.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/routes/shipyard.js | "Ship Production Queued" | Lodged, CORP-MIL-1 |
| server/routes/training.js | "Troop Training Started" | Lodged, CORP-MIL-1 |
| server/ticks.js | "Ships Delivered" | Concluded, CORP-MIL-1 |
| server/ticks.js | "Troops Trained" | Concluded, CORP-MIL-1 |

## Reworded: the next step added (ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/routes/helpers.js (fundingRequirementMessage, Bug #4820) | "{action} requires {n} credits. Current reserves: {m} credits." | "…Current reserves: {m} credits. Sell goods or finish an assignment to raise the credits, then try again." A caller's own next step still replaces this (R&D, mining). The default also reaches hiring, construction, the Mining Probe, the expedition launch and program enrollment, all of which lacked a next step. |
| server/routes/shipyard.js | "{n} {ships} need {q} {item} at {station}; it holds {h}." | "…it holds {h}. Bring more there, or queue fewer." |
| server/routes/training.js | "{n} squads of {troops} need {q} {item} at {station}; it holds {h}." | "…it holds {h}. Bring more there, or train fewer squads." |
| server/routes/fleets.js | "Your reserve holds {n} {units}; the rest are in fleets." | "…the rest are in fleets. Form it with {n} or fewer." |
| server/routes/fleets.js | "That fleet holds {n} {units}." | "That fleet holds {n} {units}. Split off {n} or fewer." |
| server/routes/fleets.js | "Both fleets must be at the same station to merge." | "…to merge. Deploy one to the other's station first." |
| server/routes/fleets.js | "No jump route reaches that system from where the fleet is." | "…from where the fleet is. Choose a station the list shows in reach." |

## Every Fleet error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each one says the next step:
- **Fleets:** "Choose at least one ship or squad of Attack Troops."; "Dock first…"; "Merge or disband one first.";
  "To move the whole fleet, deploy it."; "Choose a fleet name from the list…"; "Choose another from the list.";
  "Wait for it to arrive."; "Choose a different fleet to merge into."; "A fleet disbands where your corporation is
  docked." (with where the fleet is); "Choose where to deploy it."; the navigation lock, which names the research.
- **Shipyard:** "Choose a ship…"; "Choose a quantity from 1 to 100."; "build one first."; "{ships} need {research}
  research."; "Wait for one to finish, or cancel one."; the Fleet Cap, whose `raiseText` says how to raise it.
- **Training:** "Choose troops to train…"; "Choose a number of squads…"; "{troops} need {research} research.";
  "Wait for one to finish, or cancel one."

**Pass, nothing to do.** The state already holds, or waiting is the step:
- "That fleet is already stationed there."
- A fleet under contract, escorting or hunting "takes no orders until" that ends.

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "Account not found."; "That fleet is not one of yours."; "That shipyard job is not in your queue."; "That
  training job is not in your queue."
- "The fleet order could not be carried out."; "The shipyard could not queue that."; "Headquarters could not train
  that." (unknown outcomes)
- "Troops train at your corporation's Headquarters, and it has none." Every corporation starts with a Headquarters,
  and it is never removed (server/buildingRemoval.js NEVER_REMOVED).

**Failed, reworded.** The seven above.

No changed string names Aria Voss.

## Screenshots, from e2e/fleet-protocol.spec.js at 1280x900

1. `1-forces-and-fleet-in-transit.png`: the unpaid upkeep line with In arrears, and Lancer's In transit badge with
   In force.
2. `2-fleet-order-denied.png`: forming a fleet of 9 from a reserve of 3. The server's words, the next step, then
   Denied.
3. `3-shipyard-unfunded.png`: a Destroyer the corporation cannot fund. The shortfall, the next step (Bug #4820),
   then Unfunded, balance insufficient.
4. `4-command-log-lodged.png`: "Ship Production Queued" in the Command Log, with Lodged.
5. `5-notification-ships-delivered.png`: "Ships Delivered", delivered by the server's own ticker, with Concluded, and
   "Ship Production Queued" with Lodged.
