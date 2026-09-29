# AB#4818 slice Bc (Station): every changed string

ISP-254Bc covers the Station screen: its offices (Orbital Executive Suites, ISA Claims & Leases), construction,
upgrades, repairs and facilities. Out of it:
- mining cycles, which belong to Operations (slice Bd);
- Fleet (Ba), and raids and mercenaries (Bb);
- the offices with a screen of their own (the Conglomerate Bureau, done in C1a, and the patent, lobbying, arbitration
  and stock exchange offices).

**Measured:** 98 strings, below the 150 split threshold.

| Kind | Count |
|---|---|
| Client status lines and command-log messages | 28 |
| Status badges | 4 |
| Pre-emptive hints (read, left unframed, as slices A and C1a did) | 16 |
| Server errors | 37 |
| Notifications | 13 |

The ~126 estimate counted the belt and expedition refusals in `server/routes/asteroids.js` (Starmap) and the CORP/NEW
ownership badges, which are not statuses.

Under docs/design/BUREAUCRATIC_UI.md's first rule the plain words stay. So most rows keep their text and gain a
protocol line after it: the guide's phrase, then the screen's document code (STA-OPS-1, the Station), with the code
aria-hidden. A refusal reads Denied, or Unfunded when the server's own code says so. Each Station refusal now sends its
outcome as `code`, so Unfunded does not depend on the words: the upgrade and repair refusals are not written by
`fundingRequirementMessage`. Refusals that did not say what to do next were reworded; they are listed last.

## Status lines and the command log (client)

| File | Old (unchanged plain words) | New: what is added after them |
|---|---|---|
| public/scripts/views/station.js | Upgrade status: {server message} / "The upgrade was refused." | `DENIED` or `UNFUNDED…` `// STA-OPS-1` |
| same | Repair status: {server message} / "The repair was refused." | `DENIED` or `UNFUNDED…` |
| same | Log: "{building} repaired." | `CONCLUDED // STA-OPS-1` |
| same | Log: "Office lease confirmed at {station}." | `IN FORCE` |
| same | Rent status: {server message} / "Lease agreement failed." | `DENIED` or `UNFUNDED…` |
| same | Log: "Lease extended by {n} days." | `IN FORCE` |
| same | Renew status: {server message} / "Lease renewal failed." | `DENIED` or `UNFUNDED…` |
| same | Log: "Personnel hired successfully." | `CONCLUDED` |
| same | Hire status: {server message} / "Hire action failed." | `DENIED` or `UNFUNDED…` |
| same | Log: "{body} mining lease approved by the ISA." | `IN FORCE` |
| same | Log: {server message} / "Lease application failed." | `DENIED` or `UNFUNDED…` |
| same | Log: "Basic Extractor Yard commissioned and linked to lease." | `CONCLUDED` |
| same | Log: "Session state out of sync — please re-purchase your lease." | `UNSUCCESSFUL` |
| same | Yard build status: {server message} / "Construction failed." | `DENIED` or `UNFUNDED…` |
| same | Log: "Assembly Facility online. Enter it to fabricate Mining Probes." | `CONCLUDED` |
| same | Log (facility grid and Construction list): {server message} / "Construction failed." | `DENIED` or `UNFUNDED…` |
| same | Log: {receipt title} / "Construction complete." | `CONCLUDED` |
| same | Log: "Mining Probe fabrication started…" | `IN FORCE` |
| same | Log: {server message} / "Probe fabrication failed." | `DENIED` or `UNFUNDED…` |
| public/scripts/constructionPanel.js | Build status: {server message} / "The build was refused." | `DENIED` or `UNFUNDED…` |

In-progress lines ("Upgrading...", "Repairing...", "Processing lease agreement...", "Processing hire order...",
"Commissioning extraction facility...") stay plain: they last until the answer arrives, and name no record's state.

## Status labels

| File | Label (unchanged) | New: added beside it |
|---|---|---|
| public/scripts/views/station.js (Office Status) | "Active Lease" | `IN FORCE // STA-OPS-1` |
| same | "Expired" | `LAPSED // STA-OPS-1` |
| public/scripts/stationFacilities.js (facility card) | "Operational" | `IN FORCE // STA-OPS-1` |
| same | "Upgrading" (offline until the upgrade ends) | `SUSPENDED // STA-OPS-1` |

Left without a line, because no plain status word from the guide's table sits there:
- the repair card's DAMAGED badge (a damaged building still runs, at its condition);
- the CORP and NEW ownership badges;
- the availability hints: the Construction list's "Needs a … lease", "Building slots: …", the facility grid's "Needs
  ¤N; you have ¤M", the upgrade control's reasons and the repair card's "Needs …". Each says what can be done now,
  not the state of a record, as slice A left its hints.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/routes/corporation.js | "Hiring Order Confirmed" | Concluded, STA-OPS-1 |
| same | "Office Lease Confirmed" | In force |
| same | "Office Lease Renewed" | In force |
| same | "Mining Lease Approved" | In force |
| server/routes/asteroids.js | "Probe Fabrication Started" | In force |
| server/construction.js | "Extractor Commissioned" | Concluded |
| same | "Assembly Facility Online" | Concluded |
| same | "Ferric Mining Complex Online" | Concluded |
| same | "Cryo-vapor Extractor Array Online" | Concluded |
| same | "Orbital Shipyard Commissioned" | Concluded |

"Refinery Commissioned", "Refinery Complex Online" and "Synthesis Array Commissioned" already carry Concluded on the
Refinery screen (slice A). The Station sends no inbox system message for these actions: none was found in its routes.

## Reworded: the next step added (ISP-6's rule)

Bug #4820, merged while this slice was open, gives every `fundingRequirementMessage` refusal a default next step:
"Sell goods or finish an assignment to raise the credits, then try again." The Station's funding refusals pass a more
exact step of their own instead: "then build it", "then file again", "Hire fewer…" and "Rent for fewer days…". The
Old column is the text before either change.

| File | Old | New |
|---|---|---|
| server/routes/corporation.js | "You must maintain a registered office at this station before recruiting personnel." | "… Rent one at the Orbital Executive Suites first." |
| same | "Hiring requires {count × 2,000} credits. Current reserves: {credits}." | "Hiring requires {the hire it would make} credits. Current reserves: {credits}. Hire fewer, or sell goods to raise the credits." (the price is also Bug #4823) |
| same | "Leasing an office at {station} for {n} days requires {cost}. Current reserves: {credits}." | "… Rent for fewer days, or sell goods to raise the credits." |
| same | "Your corporation does not have an office at {station} to renew." | "… Rent one at the Orbital Executive Suites instead." |
| same | "Renewing for {n} days requires {cost}. Current reserves: {credits}." | "… Renew for fewer days, or sell goods to raise the credits." |
| same | "{body} mining lease acquisition requires {cost}. Current reserves: {credits}." | "… Sell goods or finish an assignment to raise the credits, then file again." |
| server/routes/helpers.js | "{building} construction requires {cost}. Current reserves: {credits}." | "… Sell goods or finish an assignment to raise the credits, then build it." |
| server/routes/asteroids.js | "Mining Probe fabrication requires {cost}. Current reserves: {credits}." | "… Sell goods or finish an assignment to raise the credits, then fabricate it." |
| server/upgrades.js | "The upgrade costs {cost}." | "… Sell goods or finish an assignment to raise the credits, then upgrade." |
| same | "The {building}'s next tier needs research you do not have yet." | "… The Construction list names it; queue it in Corporate R&D." |
| same | "The upgrade also takes {n} {item} from your stock at this station; you hold {m} here." | "… Bring more here, then upgrade." |
| server/buildingRepair.js | "Repairing the {building} costs {cost}; you have {credits}. Nothing was repaired." | "… Sell goods to raise the credits, then repair it." |

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the next step, or states it plainly enough to act on:
- **Offices:**
  - "You must be docked at {station} to rent an office there… travel there on the Starmap first."
  - "You are in transit. Dock at {station}…"
  - "You must lease a corporate office before filing extraction claims with the ISA."
  - "ISA regulations require at least {n} employees… Hire {m} more at the Orbital Executive Suites, then file again."
  - the employee cap ("Reaching corporation level {n} raises the cap…").
- **Construction:**
  - "Choose one of your mining leases for the {building}."
  - "The {building} is not built on a lease. Build it without choosing one."
  - "{building} construction requires Corporation Level {n}…" and "…requires {research} research."
  - "The {building} is built only on a {body} lease."
  - "The {building} upgrades a {building}: build one first."
  - the slot messages (server/nextStep.js: which lease to file or level to reach).
- **Upgrades:**
  - "Your corporation's level allows tier {n}; tier {m} needs a higher Corporation Level."
  - "{building} is running {work}. Stop it or let it finish before upgrading."
  - "…Dock where you hold them, then upgrade."
- **Probes:**
  - "Asteroid Prospecting Arrays research is required before fabricating mining probes."
  - "You must construct an Assembly Facility before fabricating probes."
  - the Fleet Cap message (it says how to raise the cap).
  - "A probe is already being fabricated. Wait for it to complete…"
- **Repairs:** "Choose one of your own damaged buildings to repair."

**Pass, nothing to do.** The state already holds, or the wait is the step:
- "Your corporation already maintains an office at {station}."
- "Your corporation already holds an active mining lease on {body}."
- "You already operate the maximum of {n} of the {building}." and "Every {building} you have is already a {upgrade}."
- "Your {body} lease already has a {building}."
- "The {building} has no upgrades." and "…is at tier {n}, its last."
- "{building} is already being upgraded, until {time}."
- "The Assembly Facility is being upgraded and is offline until it finishes."
- "The {building} is not damaged."

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "Account not found." and "Station not found."
- "Choose a building from the game's list." and "The specified lease could not be found on your account."
- "The {building} cannot be built yet." (a catalogue entry not yet playable)
- "That is not one of your buildings." and "The {building} has nothing linked to it to upgrade."
- the fallbacks "Hire action failed.", "Office rental failed.", "Lease renewal failed.", "Lease application failed.",
  "Build action failed.", "The upgrade could not be made." and "Probe fabrication failed."

**Failed, reworded.** The twelve above.

No string in this slice names Aria Voss (`grep -rn "Aria Voss"` over the changed files finds nothing).

## What was looked at

Five crops from this branch's running server at 1280, taken by e2e/station-protocol.spec.js after performing each action:
1. `1-office-lease-in-force.png`: after renting, Office Status reads Active Lease, IN FORCE // STA-OPS-1.
2. `2-hire-refused-unfunded.png`: hiring one with 1,000 credits. "Hiring requires 2,000 credits. Current reserves:
   1,000 credits. Hire fewer, or sell goods to raise the credits." UNFUNDED, BALANCE INSUFFICIENT // STA-OPS-1.
3. `3-notification-office-lease.png`: the bell, Office Lease Confirmed, IN FORCE // STA-OPS-1 after its time and type.
4. `4-command-log.png`: "Office lease confirmed at Earth Station Prime." IN FORCE // STA-OPS-1.
5. `5-facility-operational.png`: the Assembly Facility card, Operational, IN FORCE // STA-OPS-1.
