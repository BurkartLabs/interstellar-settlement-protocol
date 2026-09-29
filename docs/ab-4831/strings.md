# AB#4831 (ISP-255 slice c2): every changed string

Slice c2 covers the Map group: the Starmap's own panels, travel, concessions and the map overlays.

- **Measured:** builder-4 counted about 84 sites (35 server, 49 client). My own sweep of the Map's files, which also
  caught expeditions, hunts and escorts, came to about 137, under 150.
- **Already done by other slices:**
  - Bd (AB#4819): scouting, expeditions and probes on the Starmap.
  - AB#951: the tariff line.
  - ISP-255d (AB#4826, merged while this was in progress): hunts, the Rats overlay, escort refusals, and control and
    dominance.
- **What this slice changes:** travel, the dock refusal, concessions, and the overlays' read errors. The hunt changes
  first made here were dropped in favour of 4826's, which are the same.
- **The approach:** slice A's. The plain words stay, and a protocol line from public/scripts/protocol.js follows them.
  The Starmap is ISA-NAV-1 and Travel is ISA-TRN-1.

## Reworded: the next step added (ISP-6's rule)

| File | Old | New |
|---|---|---|
| server/game/stationGovernance.js (`dockRefusal`) | "{station} admits members only, by the vote of {conglomerate}'s stakeholders." | "… Dock at another station in this system." |
| server/concessions.js | "The ISA cannot read this system's control scores just now, so it hears no petition." | "… Try again later." |
| server/concessions.js (the petition's availability reason) | "The ISA cannot read this system's control scores just now." | "… Try again later." |

## Notifications (server; title and body unchanged, a checked protocol added)

| File | Notification | Protocol |
|---|---|---|
| server/routes/logistics.js | "Interstellar Jump Initiated" / "Undocking — Course Set" | In force, ISA-TRN-1 |
| server/ticks.js | "System Arrival" | Concluded, ISA-TRN-1 |
| server/ticks.js | "Docking Complete" | Concluded, ISA-TRN-1 |

## Lines and the Command Log (client)

| File | Old (unchanged plain words) | New: added after them |
|---|---|---|
| public/scripts/starmap.js | A refused dock, beside the station's row and in the station modal (Bug #4651): "{server message}" | `DENIED // ISA-NAV-1` (the line is escaped HTML now, not text, so it can carry the phrase) |
| views/starmap.js | Log: "{server message}" or "Interstellar travel request failed." / "Docking request failed." | `DENIED` or `UNFUNDED…` `// ISA-NAV-1` |
| views/travel.js | Log: "{server message}" or "Docking request failed." (the Travel screen's own dock) | `DENIED` or `UNFUNDED…` `// ISA-TRN-1` |
| views/travel.js | The Travel screen's lede: "Interstellar jump drive engaged. All station services suspended until arrival." / "Station services suspended during docking approach. …" | `IN FORCE // ISA-TRN-1` |
| views/starmap.js | Log: "Petition filed with the ISA." | `FILED, AWAITING REVIEW // ISA-NAV-1` |
| views/starmap.js | Log: "Lease discount set; it applies after the notice." | `LODGED // ISA-NAV-1` |
| views/starmap.js | Log: "Concession relinquished." | `WITHDRAWN // ISA-NAV-1` |
| views/starmap.js | The concession's status line and the log: "{server message}" or "The ISA refused that." | `DENIED` or `UNFUNDED…` `// ISA-NAV-1` |
| views/starmap.js | Log: "The Rats' activity could not be read." / "The dominance reading could not be loaded." / "The ISA's concession register could not be read." | `UNSUCCESSFUL // ISA-NAV-1` |

## Statuses (public/scripts/concessionOverlay.js)

| Where | Old (unchanged) | New: added beside it |
|---|---|---|
| A system's section, under review | "{corporation} · petition — review ends {time}" | `FILED, AWAITING REVIEW // ISA-NAV-1` |
| The petitioner's own line | "Your petition is under review until {time}." | `FILED, AWAITING REVIEW // ISA-NAV-1` |
| The holder's concession | "Active" (the old italic `In force`, which had no code, is replaced) | `IN FORCE // ISA-NAV-1` |
| The holder's discount | "A change is waiting out its notice until {time}." | `LODGED // ISA-NAV-1` |

These are left without a line:
- "Suspended: upkeep unpaid…". Its plain word already is the guide's phrase.
- The overlays' legends, the control scores, the eligibility badge, the Starmap's reach hints ("Requires {research}.",
  "You are here."), the neutral station's description, and the Travel screen's origin, destination and ETA. These are
  places and figures, not a record's state.

## Every framed error, read against ISP-6's rule (an error says what to do next)

**Pass.** Each says the step, or states it plainly enough to act on:
- **Travel:**
  - "Your ship is already in transit. Wait for arrival before initiating a new course."
  - "That station is in a different system. Travel to the system first."
  - "No jump route reaches that system from here. Jump to a charted system first."
  - The navigation research lock, which names the research.
- **Concessions:**
  - "A petition is filed at the system's ISA Claims & Leases: travel there first." (and "…travel here first.")
  - "Only your conglomerate's founder can petition…". This names who can.
  - "…the ISA will hear a new petition after the cooldown."
  - The control requirements ("A petition needs {n}% control and a {r}x lead…"; "A challenge must beat the holder's
    control by more…").
  - "The concession's benefits are suspended until its upkeep is paid."
  - "The lease discount is a whole percentage from 0 to {max}."
  - "…is already waiting out its notice period."

**Pass, because the state holds or nothing can be done:**
- "You are already docked at this station."; "You are already in this system."
- "You already hold this system's concession."; "Your petition … is already under review."
- "Claims here are recorded first come: a petition is already under review."
- "The ISA grants no concession in this system."; "…only to a conglomerate."; "You hold no concession in this system."

**Defensive, reached only by a stale or hand-made request.** Not reworded:
- "Specify either toSystemId (interstellar) or toStationId (dock)."
- "Invalid destination station/system."; "No such system."; "Account not found."; "Choose a system from the starmap."

**Failed, reworded.** The three above.

No changed string names Aria Voss.

## Found while looking, fixed first (Bug #4834, PR !1311)

The look first hung. While a system's panel was open, the page read the Rats' activity and redrew the panel without
end: on main, 560 reads in eight seconds. AB#992's `onSystemShown` read it on every redraw, and each read redrew the
panel. The loop stalled clicks and scrolls, and the conglomerate-station-closed and concessions specs hung on main. It
was filed, fixed on its own branch with e2e/starmap-read-loop.spec.js, and merged before this slice.

## Screenshots, from e2e/map-protocol.spec.js at 1280x800

1. `1-dock-refused.png`: a members-only station refuses the dock. What to do instead, then Denied.
2. `2-travel-in-force.png`: the Travel screen during a docking approach, In force.
3. `3-notice-course-set.png`: "Undocking — Course Set", In force on the Travel screen.
4. `4-concession-in-force.png`: a held concession, Active, In force.
5. `5-petition-under-review.png`: a petition under review, Filed, awaiting review.
