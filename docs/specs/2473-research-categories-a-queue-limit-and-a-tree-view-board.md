# Research: categories, a queue limit, and a tree view (Board review, 2026-09-26)

Feature AB#2473 (Resolved) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. ISP epic AB#388. docs/board-reviews/interstellar-settlement-protocol-review-2026-09-26.md, items 21, 22, 23, 24.
What it is. CEO Insight and Corporate R&D gain categories, collapsible sections, a total-time-to-finish-everything figure, a one-item lookahead cap on the research queue, and a tree view of prerequisites modelled on the Starmap's own node display.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 0 open, 4 resolved.

### CEO Insight: categories, collapsible Programs section and category subsections (Requirement AB#2474, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. Research (2473). Board review item 21. / What it is. Insight programs gain categories; the Programs section as a whole collapses, and each category subsection collapses independently.

- [x] Programs are grouped into named categories.
- [x] The Programs section collapses and expands as a whole.
- [x] Each category subsection collapses and expands independently.
- [x] Screenshot at 1280x800 and 375x812.

### CEO Insight and Corporate R&D: total time to complete all research (Requirement AB#2475, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. Research (2473). Board review item 22. / What it is. Both pages show the total time required to finish every research item still outstanding, summed from the research tree's own durations.

- [x] Both pages show a total time figure for completing all remaining research.
- [x] The figure updates as research completes.

### Research queue: at most one item queued ahead of the one in progress (Requirement AB#2476, Resolved, not verified) (lane: interstellar-settlement-protocol/economy)

What: Where it sits. Research (2473). Board review item 23. / What it is. The research queue accepts at most one item behind the one currently running, so a player is never forced to return at an odd hour just to keep the queue moving.

- [x] Attempting to queue a second item behind the one in progress is refused with a clear reason.
- [x] Completing the in-progress item allows the queued one to start and a new one to be queued behind it.
- [x] A test covers the refusal and the roll-forward.

### CEO Insight and Corporate R&D: a research-tree view of prerequisites (Requirement AB#2477, Resolved, not verified) (lane: interstellar-settlement-protocol/client-views)

What: Where it sits. Research (2473). Board review item 24. / What it is. Both pages show prerequisites as a tree/node view, modelled on the Starmap's own node display, rather than a flat list. The exact visual form is left to the Builder.

- [x] Prerequisites render as a connected tree or node graph, not a flat list.
- [x] A locked item's tree shows what it is still waiting on.
- [x] Screenshot at 1280x800 and 375x812.

## Demo script

_To be written._
