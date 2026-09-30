# Subpages and an Operations view: break up long pages (Board review, 2026-09-26)

Feature AB#2468 (Active) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. ISP epic AB#388. docs/board-reviews/interstellar-settlement-protocol-review-2026-09-26.md, items 20, 29, 30, 33, 34. The Board named the general principle directly: unless on mobile, a desktop page should need little to no scrolling; needing a lot means it should split into subpages (DOCTRINE P-010).
What it is. An audit of every page against that rule first, then the splits it finds, starting with the ones the Board already named: Financial Core, Station (with a new Operations view collecting mining, research, travel, probes and attacks in one place), and the Galactic Exchange.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 2 open, 5 resolved.

### Mobile layout: top nav, hide the header panel, pin Profile/Milestones/Quick Actions, sections collapsed by default (Requirement AB#2493, Proposed, under Epic AB#388)

What: Where it sits. ISP epic AB#388. docs/board-reviews/interstellar-settlement-protocol-review-2026-09-26.md, second pass, items 45, 46, 47. The Board's second pass covers phone width (375px) specifically. / What it is. On mobile: the panel holding the header, notifications, Replay Onboarding and Log out is hidden, with navigation moved to the top instead. Corporation Identity, Milestones and Quick Actions become three pinned buttons at the bottom of the screen: Profile, Milestones, Quick Actions.… (the rest: AB#2493)

- [ ] At 375px width, the header/notifications/Replay Onboarding/Log out panel is hidden and navigation is at the top.
- [ ] Corporation Identity, Milestones and Quick Actions render as three pinned buttons at the bottom of the screen.
- [ ] Page sections are collapsible and start collapsed by default at 375px.
- [ ] Screenshot at 375x812, taken after the Critic's mobile pass is folded in.

### NPC profile popup: show the NPC's portrait, once AB#2491 generates them (Requirement AB#4748, Proposed)

What: ISP, the NPC profile popup (public/scripts/views/npcProfileModal.js, opened from an NPC's name on the Exchange). AB#2492 asked for two things: move Close to the bottom right, and add profile pictures. Close shipped in AB#2492 on its own. The portraits wait on AB#2491 (programmatic portrait generation), which is unstarted. This item carries the portrait half so it stays visible.

- [ ] The NPC profile popup shows the NPC's generated portrait (from AB#2491) beside its name, as the dialogue portraits sit.
- [ ] An NPC with no portrait shows the popup as it is now, not a broken image.
- [ ] Screenshots at 1280x800 and 375x812.

### Audit every ISP page against DOCTRINE P-010 (little to no desktop scrolling) and name which need subpages (Requirement AB#2469, Resolved, not verified)

What: Where it sits. Subpages and Operations (2468). Board review item 34, the general principle behind items 20, 29, 30, 33. / What it is. A page-by-page audit (public/, at a standard desktop viewport) measuring how much scrolling each page needs, naming every page that needs "a lot" and recommending how it should split. No page is changed in this story - it produces the punch list the other stories in this Feature work from.

- [x] Every page under public/ is measured for desktop scroll depth at a stated viewport.
- [x] The PR lists every page that needs a lot of scrolling, with a recommended split for each.
- [x] Financial Core, Station and Galactic Exchange (already named by the Board) are confirmed on the list with their own findings.

### Financial Core: split into subpages (Requirement AB#2470, Resolved, not verified)

What: Where it sits. Subpages and Operations (2468), reads the audit's own findings (2469). Board review item 20. / What it is. Break Financial Core into subpages along the lines the audit finds, so no single page crams every financial section together with no logical order.

- [x] Financial Core's content is split into at least two subpages, each independently navigable.
- [x] No information from the original page is lost.
- [x] Screenshot at 1280x800 and 375x812.

### Station: split into subpages, and a new Operations view (mining, research, travel, probes, attacks) (Requirement AB#2471, Resolved, not verified)

What: Where it sits. Subpages and Operations (2468), reads the audit's own findings (2469). Board review items 29, 30. / What it is. Station's many sections (Construction, Licensed Corporate Holdings, and more) split into subpages along the audit's findings. Active Mining Cycles moves off Station into a new Operations view, which is where every kind of ongoing activity lives together: mining, research, travel, probes and attacks - itself split into subpages if it grows too long, per the same rule.

- [x] Station's sections are split into subpages per the audit.
- [x] A new Operations view exists showing active mining cycles, research, travel, probes and attacks in one place.
- [x] If the Operations view itself needs a lot of scrolling, it is split into subpages too - stated in the PR either way.
- [x] Screenshot at 1280x800 and 375x812.

### Galactic Exchange: consolidate into subpages (Requirement AB#2472, Resolved, not verified)

What: Where it sits. Subpages and Operations (2468), reads the audit's own findings (2469). Board review item 33. / What it is. Split the Galactic Exchange into subpages along the audit's findings, so it reads as organized sections rather than one long view.

- [x] The Galactic Exchange's content is split into at least two subpages.
- [x] No information from the original page is lost.
- [x] Screenshot at 1280x800 and 375x812.

### Galactic Exchange: the standing buy orders are short by default (Requirement AB#4710, Resolved, not verified)

What: Where it sits. Subpages and Operations (AB#2468), the follow-up to AB#2472, which split the Exchange into five subpages. docs/design/p010-scroll-audit.md, As built under Galactic Exchange. / What it is. With All picked, the Standing orders page lists every NPC buyer, about 50 rows and 3,100px. The page is still 5.0 screens at 1440x900, against DOCTRINE P-010's little or no scrolling. Make the table short by default without hiding any buyer for good. A proposal for the Board to veto: the rows for… (the rest: AB#4710)

- [x] At 1440x900, for the seeded industry corporation (e2e/scroll-audit.spec.js), the Standing orders page is 2 screens or less with All picked.
- [x] Every standing buy order stays reachable within one control, and the resource and tier filters still narrow the table as today.
- [x] The first-hour sale of Silicates is on the page without extra steps.
- [x] Screenshots at 1280x800 and 375x812.

## Demo script

_To be written._
