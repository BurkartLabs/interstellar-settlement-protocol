# AB#4817 (ISP-254Bb): Raids and mercenaries, every changed string

Scope: 67 status labels, notifications and errors in Raids (the Fleet screen's raid and garrison panels, the raid
notices) and Mercenary Rentals (on the Galactic Exchange). The approach is slice A's (docs/ab-950/strings.md): the
plain words stay, and a protocol line from public/scripts/protocol.js, unchanged, follows them. That line is the guide's
phrase, then the screen's code (`CORP-MIL-1` for raids, `GEX-MKT-1` for mercenaries), which is aria-hidden. Two
refusals were also reworded to say what to do next (Bug #4822); they come last.

## Notices (server/raids.js, server/raidResolution.js)

| Notice | Protocol |
|---|---|
| Raid incoming (to the target) | `IN FORCE // CORP-MIL-1` |
| Raid called off (to the target) | `WITHDRAWN // CORP-MIL-1` |
| Raid turned back (to the attacker; the target was just raided) | `UNSUCCESSFUL // CORP-MIL-1` |
| Raid resolved (to the attacker) | `CONCLUDED` if the raid won, `UNSUCCESSFUL` if not |
| Your holdings were raided (to the defender) | `CONCLUDED` whoever won. "Unsuccessful" beside a defence the defender won would read as their loss |

## Statuses and outcomes

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| Your raids list (raidView.js) | "arrives in {countdown}" | `IN FORCE // CORP-MIL-1` |
| | "fought; the fleet is on its way home ({time})" | `CONCLUDED` |
| | "called off" | `WITHDRAWN` |
| | "done" | `CONCLUDED` |
| Command Log (views/raids.js) | "{station} now defends {posture}." | `IN FORCE` |
| | "Raid declared on {corporation}." | `IN FORCE` |
| | "{n} defense troops are on their way to {station}." | `IN FORCE` |
| Command Log (views/mercenaries.js) | "Your fleet is on offer." | `FILED, AWAITING REVIEW // GEX-MKT-1` |
| | "Offer withdrawn." | `WITHDRAWN` |
| | "Mercenary Fleet Hired" / "Fleet hired." | `IN FORCE` |
| Mercenary status line | "{reason}" / "Mercenary offers could not be loaded." | `UNSUCCESSFUL` |

## Refusals

Every refusal on these screens gains `DENIED`, or `UNFUNDED, BALANCE INSUFFICIENT` when the refusal carries the code
insufficient-credits:
- the garrison and raid buttons' status line and the Command Log: posture, declare, recall ("{server message}" / "That was refused.");
- the reinforce form ("The troops could not be sent.");
- the offer form ("The offer was refused."), withdrawing an offer ("Could not withdraw."), and hiring ("The hire was refused.").

The server messages behind them were each read against ISP-6's rule that an error says what to do next. Two failed and
are fixed (Bug #4822):

| Where | Old | New |
|---|---|---|
| server/mercenaries.js, hire | "Hiring holds {n} credits (price and collateral) until the term ends, and you have {m}." | the same, then "Sell goods or finish an assignment to raise the credits, then hire." It now carries code insufficient-credits, which routes/mercenaries.js passes on, so the line reads Unfunded |
| server/garrison.js, moving troops | "Only {n} defense troops stand at that station." | the same, then "Send {n} or fewer." When there are none: "No defense troops stand at that station. Choose a station that has troops." |

Messages that name their own next step, and the defensive ones a player cannot reach from the page ("No such offer.",
"No such station.", "Price and collateral could not be held: …"), are unchanged.

## Left as they are

- The mercenary contract statuses (On offer, Under contract, Settled and the rest) already carry a protocol phrase
  from ISP-252 (AB#948, a `.ui-protocol` paragraph in mercenaryView.js). So mercenaries currently have two renderings.
  Moving them onto protocolLineHtml would be a separate change.
- The pre-emptive reasons a target cannot be raided (the picker's "why not" lines). These are availability hints, not
  outcomes, and slice A left them without a line in the same way.

## Looked at (1280x800, this branch's server, seeded by e2e/seed-raids.mjs and e2e/seed-construction-account.mjs mercs)

1. `1-notice-raid-incoming.png`: the target's notice, In force
2. `2-notice-holdings-raided.png`: the defender's notice, Concluded
3. `3-raid-list.png`: two recalled raids, Withdrawn
4. `4-log-raid-declared.png`: Raid declared, In force
5. `5-log-hire-unfunded.png`: a hire the renter cannot fund, the new next step, Unfunded
6. `6-log-fleet-on-offer.png`: an offer lodged, Filed, awaiting review
