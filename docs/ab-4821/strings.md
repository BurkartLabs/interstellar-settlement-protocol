# AB#4821 (ISP-254 slice C1b): every changed string

C1b covers the conglomerate's pooled assets: the treasury, the hangar, shared intel, and the co-owned station (its
project, stakes and votes). It is the last slice of AB#950.

- **Measured first:** about 61 server sentences and 5 notices (server/game/treasury.js, hangar.js, stationGovernance.js
  and stationProjects.js), plus about 35 client strings (public/scripts/conglomerateTreasury.js, conglomerateStation.js,
  and their part of views/conglomerateBureau.js). That is well under 150, so the slice was not split.
- **Shared intel:** server/game/intel.js writes no copy. Its one refusal, "Only a conglomerate's current members see its
  intel.", passes ISP-6 unchanged, since it names who can see it. The Starmap's "Shared intel" badge labels a belt; it
  is not a record's state.
- **The approach:** slice A's and C1a's (docs/ab-950, docs/ab-4811). The plain words stay, and a protocol line from
  public/scripts/protocol.js follows them, with the Conglomerate screen's code, `CGL-ADM-1`, aria-hidden. A refusal
  reads Unfunded from the server's own code, `insufficient-credits`, as C1a made it do. Otherwise it reads Denied.

## Form lines (public/scripts/views/conglomerateBureau.js, drawn by conglomerateTreasury.js and conglomerateStation.js)

| Form | Old (unchanged plain words) | New: added after them |
|---|---|---|
| Treasury deposit | "Deposited {n} credits; {fee} went to the custody fee." | `CONCLUDED // CGL-ADM-1` |
| Treasury withdraw | "Announced. It is paid {when} unless blocked." | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| Treasury withdraw | "Withdrawn: {n} credits are in your corporation's account." | `CONCLUDED // CGL-ADM-1` |
| Block a withdrawal | "Blocked: the withdrawal will not be paid." | `DENIED // CGL-ADM-1` (the withdrawal's outcome) |
| Block a withdrawal | "Your block is recorded. A second director's block stops it." | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| Hangar deposit / withdraw | "Deposited {n} {item}." / "Withdrew {n} {item} into your stock." | `CONCLUDED // CGL-ADM-1` |
| File a station project | "{name} is filed. Members can fund it now." | `LODGED // CGL-ADM-1` |
| Put into the project | "Put in: {what}." | `CONCLUDED // CGL-ADM-1` |
| Put into the project | "Put in. {name} is fully funded and under construction." | `IN FORCE // CGL-ADM-1` |
| Cancel the project | "{name} is cancelled; everything has gone back." | `WITHDRAWN // CGL-ADM-1` |
| Propose a station setting | "Passed at once: docking is now {access}." | `IN FORCE // CGL-ADM-1` |
| Propose a station setting | "Put to the vote: {text}." | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| Vote | "Your vote carried it: {text}, in force now." / "Your vote decided it: voted down." / "Your {vote} is counted: …" | `IN FORCE` / `DENIED` / `FILED, AWAITING REVIEW` `// CGL-ADM-1` |
| Every form above, refused | "{server message}" or "The Bureau refused that." | `DENIED // CGL-ADM-1`, or `UNFUNDED, BALANCE INSUFFICIENT // CGL-ADM-1` when the code is insufficient-credits |
| The page's own checks | "Enter a whole number of credits/units, at least 1."; "Put in credits or goods, one at a time."; "Enter a whole number of credits, or choose goods and a number of units." | `DENIED // CGL-ADM-1` |

"{name} is filed" is set on the start form's line, which the project screen replaces as soon as it draws. So a player
sees the filing's Lodged on the project's own state line below, not on this line. That was true before this slice too.

## Statuses (public/scripts/conglomerateTreasury.js, conglomerateStation.js)

| Where | Old (unchanged) | New: added after it |
|---|---|---|
| An announced withdrawal | "Paid {time} unless blocked" | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| The project's state line | "Station project · {system}" | `LODGED // CGL-ADM-1` |
| same | "Under construction · {system}" | `IN FORCE // CGL-ADM-1` |
| An open vote | "Proposed by … · closes {time} · yes n%, no n% of all stake" | `FILED, AWAITING REVIEW // CGL-ADM-1` |
| A recent vote | "Passed {time}" / "Voted down {time}" | `IN FORCE` / `DENIED` `// CGL-ADM-1` |
| The Treasury, Hangar or Station could not be loaded | "{reason} Nothing has changed." | `UNSUCCESSFUL // CGL-ADM-1` |

These are left without a line:
- "In arrears: …" on the treasury, and a recent vote's "Lapsed". Their plain words already are the guide's phrase, and
  repeating it would say the same thing twice.
- Stakes, the member benefits, buyouts under way, the ledgers, the bill of materials and its bars, the construction
  clock, and the empty states. They are figures or places, not a record's state.

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/game/treasury.js | "A large withdrawal from {name}" | Filed, awaiting review |
| server/game/stationGovernance.js | "A station vote is open" | Filed, awaiting review |
| same | "A station change passed" | In force |
| same | "A station change did not pass" | Denied (voted down) or Lapsed (closed without a majority) |
| server/game/stationProjects.js | "{name} is building a station" | Lodged |
| same | "{name} is fully funded" | In force |
| same | "{name} was cancelled" | Withdrawn |
| same | "{name} is open" | Concluded |

All are on the Conglomerate screen (`CGL-ADM-1`).

## Reworded: the next step added (ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/game/treasury.js | "Your corporation holds {h} credits; it cannot deposit {n}." | "… Deposit {h} or less." |
| server/game/treasury.js | "The treasury holds {h} credits." (withdraw) | "… Withdraw {h} or less." |
| server/game/treasury.js | "The Bureau cannot read your corporation's credits just now; nothing was moved." | "… Try again later." |
| server/game/treasury.js | "The Bureau cannot check this withdrawal just now; nothing was moved." | "… Try again later." |
| server/game/hangar.js | "Your corporation holds {h} {item} at {station}; it cannot deposit {n}." | "… Deposit {h} or fewer." |
| server/game/hangar.js | "The hangar holds {h} {item}." (withdraw) | "… Withdraw {h} or fewer." |
| server/game/hangar.js | "The Bureau cannot check this withdrawal just now; nothing was moved." | "… Try again later." |
| server/game/stationGovernance.js | "The stakes cannot be read just now; no vote was recorded." | "… Try again later." |
| server/game/stationProjects.js | "A station project needs a level {n} conglomerate; {name} is level {m}." | "… Buy the levels at the Bureau first." |
| server/game/stationProjects.js | "Another conglomerate is already building at {body}." | "… Choose another body." |
| server/game/stationProjects.js | "A station is built where a member mines: no member of {name} holds a lease in {system}." | "… Choose a system where a member mines." |
| server/game/stationProjects.js | "The Bureau cannot price a station just now; nothing was filed." | "… Try again later." |
| server/game/stationProjects.js | "The project needs {n} more credits." | "… Put in {n} or less." |
| server/game/stationProjects.js | "Your corporation holds {h} credits; it cannot put in {n}." | "… Put in {h} or less." |
| server/game/stationProjects.js | "The treasury holds {h} credits." (into the project) | "… Put in {h} or less." |
| server/game/stationProjects.js | "A station is not built from {item}." | "… Choose one of the goods its bill lists." |
| server/game/stationProjects.js | "The project needs {n} more {item}." | "… Put in {n} or fewer." |
| server/game/stationProjects.js | "Your corporation holds {h} {item} at {station}; goods for the project come from there." | "… Bring more there, or put in fewer." |
| server/game/stationProjects.js | "The hangar holds {h} {item}." (into the project) | "… Put in {h} or fewer." |

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the step, or states it plainly enough to act on:
- **Treasury and hangar:** "Enter a whole number of credits/units, at least 1."; "Choose a station/an item from the
  game's list."; "Dock there, or ship goods there, first."; the daily caps ("The cap resets at 00:00 UTC.").
- **Station project:** "Travel there, then file it."; "Choose a system from the game's list."; "Choose a body in
  {system}."; "Choose the station's name from the list."; "Fund it from your own stock, the treasury or the hangar.";
  "Put in credits or one item, not both and not neither."; "The hangar holds goods; credits come from the treasury."
  and its mirror.
- **Votes:** "Propose a change to who may dock, or to the listed conglomerates."; "Choose another conglomerate from
  the directory."; "Vote yes or no."

**Pass, because the step is someone else's or there is nothing to do:**
- The refusal names who can act: "Members cannot withdraw credits; the founder and directors can, within a daily
  cap."; "Only the founder or a director can block a withdrawal / propose a change to the station."; "Only the founder
  can start / cancel a station project."; "Only the founder can move the treasury or the hangar into the station
  project; any member can put in its own."; "Only a corporation with a stake in the station votes on it."; "Only a
  conglomerate's current members see its intel."
- The state already holds: "That withdrawal is {state}; it can no longer be blocked."; "You cannot block your own
  withdrawal."; "You have already blocked it; a second director's block stops it."; "Docking is already {access}.";
  "A vote on that is already open."; "That vote has closed."; "Your corporation has already voted {vote}."

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "No such withdrawal." and "No such proposal."
- "Your role cannot contribute to the treasury / the hangar." and "Your role cannot withdraw goods." Every role may
  contribute and withdraw goods (data/conglomerates.json), so these are reached only by a role the catalog lacks.

**Failed, reworded.** The nineteen above.

No changed string names Aria Voss.

## Screenshots, from e2e/conglomerate-pooled-protocol.spec.js at 1280x800

1. `1-treasury-deposit-unfunded.png`: a deposit of 99,000,000. How much it can deposit, then Unfunded.
2. `2-treasury-withdrawal-announced.png`: a 15% withdrawal announced. Filed, awaiting review, on its line and in the
   announced list.
3. `3-station-project-lodged.png`: Venus Platform filed. "Station project · Sol", then Lodged.
4. `4-contribution-denied.png`: 2,000,001 credits into a project that needs 2,000,000. How much it takes, then Denied.
5. `5-vote-open.png`: the open vote, Filed, awaiting review.
6. `6-vote-carried.png`: the vote carried. In force on the vote's line and on the recent vote.
