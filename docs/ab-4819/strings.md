# AB#4819 (ISP-254 slice Bd): every changed string

The scope is Operations: mining leases, extractor yards and their cycles, and probes with the expeditions they fly. The
approach is slice A's (docs/ab-950/strings.md) and C1a's: the plain words stay, and a protocol line from
public/scripts/protocol.js (unchanged) follows them. The line is the guide's phrase, then the code of the screen or
section it belongs to, which is aria-hidden. Measured on this branch: 31 strings carry a line now (the three tables
below; builder-1's estimate was about 42). About twenty more in the same screens are left without one on purpose,
listed last with the reason.

Codes: ISA-REG-8 ISA Claims & Leases Division, ISA-REG-10 Mining Lease, STA-OPS-6 Active Mining Cycles, CORP-IND-5
Assembly Facility, STA-OPS-3 Operational Facilities, CORP-OPS-2 Asteroid Belt Expeditions, ISA-NAV-1 Starmap.

## Messages and status lines (client)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| Claims office, lease filed (views/station.js) | "{Body} mining lease approved by the ISA." | `IN FORCE // ISA-REG-8` |
| Claims office, lease refused | "{server message}" or "Lease application failed." | `DENIED // ISA-REG-8`, or `UNFUNDED, BALANCE INSUFFICIENT` for a funding refusal |
| Lease, yard commissioned | "Basic Extractor Yard commissioned and linked to lease." | `CONCLUDED // ISA-REG-10` |
| Lease, stale session | "Session state out of sync — please re-purchase your lease." | `UNSUCCESSFUL // ISA-REG-10` |
| Lease, yard refused (status line) | "{server message}" or "Construction failed." | `DENIED` / `UNFUNDED… // ISA-REG-10` |
| Lease, cycle started | "Mining cycle started." | `IN FORCE // ISA-REG-10` |
| Lease, cycle refused (status line) | "{server message}" or "Mining cycle failed to start." | `DENIED` / `UNFUNDED… // ISA-REG-10` |
| Lease, cycle stopped | "Mining cycle stopped." | `WITHDRAWN // ISA-REG-10` |
| Lease, stop refused (status line) | "{server message}" or "Could not stop the mining cycle." | `DENIED // ISA-REG-10` |
| Lease, yard upgrade refused (status line) | "{server message}" or "The upgrade was refused." | `DENIED` / `UNFUNDED… // ISA-REG-10` |
| Station, Assembly Facility built | "Assembly Facility online. Enter it to fabricate Mining Probes." | `CONCLUDED // CORP-IND-5` |
| Station, facility build refused | "{server message}" or "Construction failed." | `DENIED` / `UNFUNDED… // STA-OPS-3` |
| Assembly Facility, fabrication queued | "{probeFabricationStartedText}" | `LODGED // CORP-IND-5` |
| Assembly Facility, fabrication refused | "{server message}" or "Probe fabrication failed." | `DENIED` / `UNFUNDED… // CORP-IND-5` |
| Starmap, belt scouted (views/starmap.js) | "{beltScoutedText}" | `CONCLUDED // ISA-NAV-1` |
| Starmap, scout refused, Command Log and belt panel | "{server message}" or "Belt scouting failed." | `DENIED` / `UNFUNDED… // ISA-NAV-1` |
| Starmap, expedition launched | "Mining expedition launched!" | `IN FORCE // ISA-NAV-1` |
| Starmap, launch refused, Command Log and belt panel | "{server message}" or "Expedition launch failed." | `DENIED` / `UNFUNDED… // ISA-NAV-1` |

## Statuses (client)

| Where | Plain words (unchanged) | Added after them |
|---|---|---|
| A yard's badge on the lease | "Active" | `IN FORCE // ISA-REG-10` |
| same | "Downtime" | `SUSPENDED // ISA-REG-10` |
| Mining cycles page (views/miningTicker.js) | "Status: Active" | `IN FORCE // STA-OPS-6` |
| Assembly Facility | "Fabricating Mining Probe — {time} remaining" | `IN FORCE // CORP-IND-5` |

The badge and its line share `.extractor__status`, so the line sits beside the badge it names at the header's end
(docs/ab-4819/1-yard-active.png; the first draw put it at the far right, away from the badge).

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol, code |
|---|---|---|
| server/routes/corporation.js | "Mining Lease Approved" | In force, ISA-REG-8 |
| server/construction.js | "Extractor Commissioned" | Concluded, ISA-REG-10 |
| server/routes/mining.js | "Mining Cycle Started" | In force, STA-OPS-6 |
| same | "Mining Cycle Stopped" | Withdrawn, STA-OPS-6 |
| server/construction.js | "Assembly Facility Online" | Concluded, CORP-IND-5 |
| server/routes/asteroids.js | "Probe Fabrication Started" | Lodged, CORP-IND-5 |
| server/ticks.js | "Mining Probe Fabricated" | Concluded, CORP-IND-5 |
| server/routes/asteroids.js | "Expedition Launched" | In force, CORP-OPS-2 |
| server/ticks.js | "Expedition Complete" / "Expedition Ended Early" | Concluded, CORP-OPS-2 |

## Left without a line

- Idle and Upgrading on a yard's badge, "Idle — no cycle history", "Ready for next cycle" and the Mining cycles page's
  "Idle": the guide's table has no meaning for idle, and Upgrading is not a suspension the player did not choose.
- In-flight words ("Submitting lease application to ISA...", "Commissioning extraction facility...", "Initiating mining
  cycle...", "Stopping mining cycle..."): they last a request and are replaced by the outcome, which has its line.
- Pre-emptive hints: a full lease's slot advice, the Fleet Cap note, "Research Asteroid Prospecting Arrays to unlock...".
  Slice A left its availability hints the same way.
- The Mining Probe Return report in the Inbox (server/ticks.js): it is already written as a protocol document ("Attn:",
  a reference number, a manifest), and the Inbox draws no protocol line on system mail.
- Receipts (server/receipts.js): a receipt is its own document with its own title, and the receipt modal draws no line.
- Slice Bc (Station) keeps: the generic Construction panel, facility upgrades, office leases, and the Ferric Mining
  Complex and Cryo-vapor Extractor Array notifications, which are station buildings.

## The looks (1280x800, this branch's server, e2e/operations-protocol.spec.js)

1. `1-yard-active.png`: a yard with a cycle running. Active, then IN FORCE // ISA-REG-10 beside it.
2. `2-notifications.png`: Mining Cycle Started, Extractor Commissioned and Mining Lease Approved, each with its line after
   the time and type.
3. `3-mining-cycles.png`: the Mining cycles page, "Status: Active IN FORCE // STA-OPS-6".
4. `4-command-log.png`: started, stopped (WITHDRAWN), commissioned (CONCLUDED) and the lease (IN FORCE // ISA-REG-8);
   the office and hiring lines above belong to slice Bc and have none yet.
5. `5-belt-refused.png`: a launch refused for want of credits in the belt panel. The server's words, then UNFUNDED,
   BALANCE INSUFFICIENT // ISA-NAV-1.
6. `6-probe-fabricating.png`: "Fabricating Mining Probe — 10s remaining IN FORCE // CORP-IND-5".
