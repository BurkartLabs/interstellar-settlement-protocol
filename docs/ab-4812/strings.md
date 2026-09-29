# AB#4812 (ISP-254 slice C2): the Company group, every changed string

**Scope:** Overview, Financial Core, CEO Insight and Assignments, after Conglomerate (C1). The Inbox's memoranda were
AB#4830's, and its two letters were already protocol documents, so nothing of the Inbox is left here. The measured count
is 56 sentence literals plus 10 notices, well under 150, so there is no split.

**Approach:** the plain words stay, and a protocol line from public/scripts/protocol.js, unchanged, follows them: the
guide's phrase, then the screen's code, aria-hidden. Refusals that failed ISP-6's next-step rule were reworded (Bug
#4873); they come last. No string names Aria Voss.

## Notices (server): each carries its protocol

| Notice | File | Protocol |
|---|---|---|
| Secure Access Granted | server/game/store.js | `CONCLUDED // ISA-REG-1` (Login) |
| Verify your email address | server/game/store.js | `FILED, AWAITING REVIEW // ISA-REG-3` (Check your email) |
| Corporation Registered | server/game/store.js | `IN FORCE // ISA-REG-2`: the charter is in force |
| Corporation Level N | server/game/progression.js | `CONCLUDED // CORP-OPS-1` (Overview) |
| Walkthrough Completed | server/routes/account.js | `CONCLUDED // CORP-OPS-1` |
| Walkthrough Reset | server/routes/account.js | `LODGED // CORP-OPS-1`: the briefing is lodged to run again |
| Payroll unpaid | server/payroll.js | `IN ARREARS // CORP-FIN-1` |
| Payroll paid | server/payroll.js | `CONCLUDED // CORP-FIN-1` |
| Military upkeep unpaid | server/upkeep.js | `IN ARREARS // CORP-FIN-1` |
| Fleet at full readiness | server/upkeep.js | `CONCLUDED // CORP-FIN-1` |
| CEO Insight Queued | server/routes/research.js | `LODGED // CORP-EXE-1`: slice A's note put this "Queued" here |
| CEO Insight Complete | server/ticks.js | `CONCLUDED // CORP-EXE-1` |

## Statuses and outcomes (client)

| Where | Plain words (unchanged unless shown) | Added after them |
|---|---|---|
| CEO Insight, a program done (views/ceoInsight.js) | the Done badge | `CONCLUDED // CORP-EXE-1` |
| CEO Insight, a program queued | the In queue badge | `LODGED // CORP-EXE-1` |
| CEO Insight, an enrollment refused (Command Log) | "CEO Insight error: {server message}" | `DENIED`, or `UNFUNDED, BALANCE INSUFFICIENT` for want of credits |
| Overview, the salvage card (views/overview.js) | "{h} remaining" | `IN FORCE // ISA-CON-1` |
| | "Ready to report" | `CONCLUDED // ISA-CON-1`: the work is done and waits to be reported |
| Assignments (views/assignments.js), Command Log | "Contract accepted: "{title}". Track it in Active Contracts." | `IN FORCE // ISA-CON-1` |
| | "Contract abandoned and removed from Active Contracts." | `WITHDRAWN` |
| | a refused accept, abandon or completion: "{server message}" | `DENIED` or `UNFUNDED` |
| Assignments, the completed log | "✓ {type} {title}" | `CONCLUDED` |

Three fallbacks, shown only when the server sent no message (a lost connection), now say what to do:

| Old | New |
|---|---|
| "Failed to accept contract." | "The contract could not be accepted. Check your connection and try again." |
| "Failed to abandon contract." | "The contract could not be abandoned. Check your connection and try again." |
| "Failed to complete mission." | "The contract could not be completed. Check your connection and try again." |

## ISP-6: the refusals behind them

Every server refusal on these screens was read against ISP-6's rule that an error says what to do next.

Three failed and are fixed (Bug #4873):

| File | Old | New |
|---|---|---|
| server/routes/missions.js | "Mission not found in current offerings." | "That contract is no longer on offer. Accept one of the contracts listed in the agent's office on Assignments." |
| server/routes/missions.js | "Mission already accepted." | "You have already accepted that contract: it is in Active Contracts on Assignments." |
| server/routes/research.js | "Only one CEO Insight program can be in progress at a time." | the same, then "Wait for it to finish, then enroll this one." |

The rest pass as they are:
- They already name the step: not on offer, cooling down, docked elsewhere (travel on the Starmap), salvage hours remaining, the delivery shortfall (missionShortMessage), the funding rule, a missing prerequisite by name.
- Or they are defensive and cannot be reached from the page: "Missing missionId.", "Account not found.", "Mission is not active.", "Unknown insight program.". The page shows no Enroll button while a program runs, so even the third fix above is defensive in practice.

## Left as they are

- The level panel's instructions ("Complete these requirements to advance…") and the unlock labels: instructions, not outcomes.
- The Overview's salvage offer ("Available"): an offer, not a status. The availability hints, as in slice A.
- Financial Core's figures and statements: numbers, with no status words.

## Looked at (1280x800, this branch's server)

1. `1-notice-level-reached.png`: a fresh corporation's office and five hires reach Level 1, Concluded
2. `2-log-contract-accepted.png`: a contract accepted, In force
3. `3-ceo-program-queued.png`: a queued CEO Insight program, Lodged
4. `4-notice-access-granted.png`: Secure Access Granted, Concluded
5. `5-notice-payroll-unpaid.png`: payroll the corporation cannot meet, In arrears. It was settled by the server's own settleAccountPayroll on a seeded corporation with ten staff and no credits.
