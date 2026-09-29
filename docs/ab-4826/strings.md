# AB#4826 slice 255d (Warfare and arbitration): every changed string

ISP-255d covers hunts, Rats, control and dominance, and the Galactic Arbitration Council's rulings and docket. Left to
other slices:
- the Starmap's own panels, travel, concessions and the map overlays: 255c2, AB#4831;
- the belt panel's scout and launch notices, which slice Bd (AB#4819) framed.

**Measured:** 102 strings, above the ~74 estimate and below the 150 split threshold. The estimate missed arbitration's
refusals, which go through `no(status, code, message)`, and the hunt lines drawn in `ratsOverlay.js`.

| Kind | Count |
|---|---|
| Arbitration server: refusals | 35 |
| Arbitration server: notices | 4 |
| Arbitration server: alerts | 2 |
| Council client: case statuses, filing and cure lines, records read | 18 |
| Hunts server: refusals | 17 |
| Hunts server: notices | 4 |
| Hunts server: route fallback | 1 |
| Hunts client: under way, quiet, report outcomes, the two belt notices | 9 |
| Rats: escort refusals | 9 |
| Control and dominance routes | 3 |

Control and dominance send no notice and no status of their own: their three route errors are the only strings, and
their displays are map overlays (255c2).

Under docs/design/BUREAUCRATIC_UI.md's first rule the plain words stay; a protocol line follows them. Its codes:
- ISA-NAV-1: the Starmap, for hunts, which are planned and reported in its belt panel, as Bd's belt lines are;
- GAC-LAW-1: the Galactic Arbitration Council.

A refusal reads Denied, or Unfunded from the server's code: `insufficient-credits` for a hunt, which now sends it, and
the Council's own `cannot-pay`.

## Hunts

| File | Old (unchanged plain words) | New: what is added |
|---|---|---|
| public/scripts/ratsOverlay.js | "{fleet} is hunting here: back {time}." | `IN FORCE // ISA-NAV-1` |
| same | "Quiet: a hunt cleared this belt. Its Rats regrow at {time}." | `IN FORCE` |
| same | Report title "Hunt won" | `CONCLUDED` |
| same | Report titles "Hunt broke off: a draw", "Hunt lost", "Hunt found nothing" | `UNSUCCESSFUL` |
| public/scripts/views/starmap.js | Belt notice: {server message} / "The hunt could not be sent." | `DENIED` or `UNFUNDED…` |
| same | Belt notice: {message} / "The hunt screen could not be read." | `UNSUCCESSFUL` |
| server/hunts.js | Notice "Hunt won" | Concluded, ISA-NAV-1 |
| same | Notices "Hunt found nothing", "Hunt broke off", "Hunt lost" | Unsuccessful, ISA-NAV-1 |
| server/routes/hunts.js | The refusal's JSON | now carries the refusal's `code` when it has one |

## The Galactic Arbitration Council

The Council already paired each case's plain word with a phrase sentence ("Filed, awaiting review; ruled …", in an
italic line). The phrase now comes from protocol.js, as a protocol line beside the status badge, on the caller's own
cases and, new, on the public docket's rows. The italic line keeps only the detail ("Ruling due {time}", "Award being
collected, {x} of {y} paid", "Ruled {time}"), so the phrase is not said twice.

| File | Label or line (unchanged) | New |
|---|---|---|
| public/scripts/arbitrationCouncil.js | Case badge "Pending" (answering) | `FILED, AWAITING REVIEW // GAC-LAW-1`; italic "Ruling due {time}." |
| same | "Active" (enforcing an award, or just ruled) | `IN FORCE`; italic "Award being collected, {x} of {y} paid." or "Ruled." |
| same | "Complete" | `CONCLUDED`; italic "Ruled {time}." |
| same (docket row) | the same badges | the same protocol line (the docket had no phrase before) |
| same | Filing status: "{ref} is filed. The respondent has been notified." | `FILED, AWAITING REVIEW` |
| public/scripts/views/arbitrationCouncil.js | Filing status: {server message} / "The Council refused the filing." | `DENIED`, or `UNFUNDED…` on `cannot-pay` |
| same | Filing status: {message} / "Your records could not be read." | `UNSUCCESSFUL` |
| same | Log: "{ref}: case filed against {respondent}." | `FILED, AWAITING REVIEW` |
| same | Log: "{ref}: cured." | `CONCLUDED` |
| same | Log: {server message} / "The cure was refused." | `DENIED` or `UNFUNDED…` |
| server/arbitration.js | Notice "Galactic Arbitration Council: case filed" | Filed, awaiting review, GAC-LAW-1 |
| same | Notice "{ref}: Arbitration Council ruling" (both parties) | Concluded: the case is decided whichever way it went, as slice Bb's raid notice |
| same | Notice "{ref}: Arbitration Council debt recorded" | In arrears |
| same | Notice "{ref}: case cured" | Concluded |

The outcome badges (Upheld, Dismissed, Cured) stay as they are: they name the ruling, not the record's state, and
the state badge beside them carries the phrase.

## Reworded: the next step added (ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/hunts.js | "The hunt's provisions cost {n} credits." | "The hunt's provisions cost {n} credits; you have {m}. Send a smaller fleet, or sell goods to raise the credits." (and the code `insufficient-credits`) |
| same | "That fleet is travelling." | "… Hunt with it once it has arrived." |
| same | "That fleet has no ships to hunt with." | "… Choose a fleet with ships." |
| server/escorts.js | "That fleet has no units to escort with." | "… Choose a fleet with ships." |
| server/arbitration.js | "Filing costs {fee} credits, held until the ruling." | "… Sell goods or finish an assignment to raise the credits, then file it." |
| same | "Curing costs {n} credits, paid to {claimant} at once." | "… Sell goods to raise the credits, then cure it before the response window closes." |
| same | "The Council could not read the evidence, so nothing was filed and no fee was taken." | "… Try again in a moment." |
| same | "You already have {n} open cases against {respondent}, the most the Council hears at once." | "… File again once one of them is ruled." |

## Every framed error, read against ISP-6's rule

**Pass.** Each says what to do, or states the rule plainly enough to act on:
- **Hunts:**
  - "A fleet hunts a belt in the system it is stationed in: deploy it there first."
  - "That fleet is offered or hired out, and takes no order from you until its contract ends."
  - "That fleet is escorting an expedition until it comes home."
  - "That belt's Rats were cleared; the group regrows at {time}."
  - "At most {n} hunts may be declared in an hour."
- **Escorts:** "Choose one of your own fleets…", "Choose one of the fleets you have hired…", "…Escort with it once it has
  arrived.", "…Deploy the fleet there first.", "That contract does not permit escorting: only a contract for pve or
  raids does."
- **Council:**
  - "Only the renter can file on a contract's readiness." and the other party rules (patent holder, petitioner, respondent).
  - "A readiness case is filed while the contract runs, or within 7 days of its end." and "A tariff case is filed within 30 days…".
  - "Only a petition or challenge in an arbitrated system (Wolf 359, Epsilon Indi) is heard by the Council."
  - "Nobody contests this petition: its review decides it…"
  - "Credit defaults are docketed by the ISA itself…"
  - "The Council does not hear {type} cases yet…"
  - "You cannot file against yourself or your own conglomerate…"
  - "A case of this kind has already been filed on that record: one case per record."
  - "The response window has closed: the Council's rule decides the case now."
  - "This case is an order, not a payment: there is nothing to cure."
- **Dominance:** "Choose a system from the starmap."

**Pass, nothing to do.** The record cannot be argued with:
- "That fleet is already hunting." and "That fleet is escorting…".
- "That petition has already been decided."
- the "no evidence" refusals: records from before the Council kept them.
- the "no longer exists" refusals: the other party is gone.

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "No such asteroid belt.", "That belt has no danger reading…", "No Rats gather in that belt."
- "No such fleet of yours.", "No such corporation.", "Account not found."
- "No such mercenary contract.", "None of your sales or transfers that paid a tariff has that id.", "No such petition or
  challenge.", "No such patent.", "That corporation has no recorded use of this patent.", "No such case."
- "That is not a claim type the Council hears.", "No such system."
- the fallbacks "The hunt could not be declared.", "The hunt could not be sent.", "The Council refused the filing." and
  "The cure was refused."

**Failed, reworded.** The eight above.

No string in this slice names Aria Voss (grep over the changed files).

## What was looked at

Five screenshots from this branch's running server at 1280, taken by e2e/warfare-protocol.spec.js after performing each
action:
1. `1-hunt-refused-unfunded.png`: sending the 12+12 fleet with 1,200 credits. "The hunt's provisions cost 1,800
   credits; you have 1,200. Send a smaller fleet, or sell goods to raise the credits." UNFUNDED, BALANCE INSUFFICIENT
   // ISA-NAV-1.
2. `2-hunt-won-belt-quiet.png`: after the smaller fleet's hunt, the belt's Rats section: "Quiet: a hunt cleared this
   belt…" IN FORCE // ISA-NAV-1. The report above it reads Hunt won, CONCLUDED.
3. `3-notification-hunt-won.png`: the bell, Hunt won, CONCLUDED // ISA-NAV-1.
4. `4-case-filed-and-yours.png`: after filing a readiness case, the status line "{ref} is filed…" FILED, AWAITING REVIEW
   // GAC-LAW-1; the case under Your cases: Pending, FILED, AWAITING REVIEW, "Ruling due 2147-10-03 00:00 UTC."
5. `5-docket.png`: the public docket's row: Pending, FILED, AWAITING REVIEW // GAC-LAW-1.

The first look at 4 read "Ruled 2147-10-03 00:00 UTC." for a ruling still to come. It now reads "Ruling due".
