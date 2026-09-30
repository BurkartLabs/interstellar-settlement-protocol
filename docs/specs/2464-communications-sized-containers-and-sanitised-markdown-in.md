# Communications: sized containers, and sanitised Markdown in messages (Board review, 2026-09-26)

Feature AB#2464 (Active) · product interstellar-settlement-protocol · migrated from Azure DevOps on 2026-09-30 (AB#4889)

## What it is

Where it sits. ISP epic AB#388. docs/board-reviews/interstellar-settlement-protocol-review-2026-09-26.md, items 8, 19, 36, 37, 38.
What it is. Inbox, Chat and Forums containers sized to the screen (about 70% width, 600px tall as the reference); Inbox messages and player-to-player messages support Markdown, sanitised since it is attacker-controlled input; Forums nest replies under what they answer.

## Acceptance

_To be written: the Feature had no acceptance criteria in Azure DevOps._

## Checklist

Each heading replaces a Requirement or Bug, which Azure DevOps keeps (Closed, tagged folded, linked here); its lines are its Acceptance. A checked line was Resolved and has not been verified. 0 open, 3 resolved.

### Inbox and Chat: sized containers (dynamic width/height), Chat fixed height and scrolling (Requirement AB#2465, Resolved, not verified)

What: Where it sits. Communications (2464). Board review items 19, 36. / What it is. Inbox's container is about 70% width, 600px tall as the reference, both dynamic to screen size; its minimum height rises (it can still grow taller if needed). Chat gets the same width/height treatment except its height is fixed - it never grows to fit more messages, and scrolls instead.

- [x] Inbox and Chat containers scale width and base height to the viewport, using 70%/600px as the reference at a standard desktop size.
- [x] Inbox's minimum height is higher than today's and the container can still grow past it.
- [x] Chat's height never grows past its fixed value regardless of message count; overflow scrolls.
- [x] Screenshot at 1280x800 and 375x812.

### Forums: sized container, replies nested under what they answer (Requirement AB#2466, Resolved, not verified)

What: Where it sits. Communications (2464). Board review items 37, 38. / What it is. Forums gets the same sized-container treatment as Inbox and Chat, and a reply renders nested under the comment it replies to instead of flat in posting order.

- [x] The Forums container scales to the viewport, matching Inbox/Chat's treatment.
- [x] A reply renders visually nested under its parent comment, to any depth the data supports.
- [x] Screenshot at 1280x800 and 375x812.

### Inbox messages support Markdown, sanitised before render (Requirement AB#2467, Resolved, not verified)

What: Where it sits. Communications (2464). Board review item 8. / What it is. Inbox messages (including player-to-player, once that exists) render Markdown formatting. Player-authored Markdown is attacker-controlled input (DOCTRINE, security first) and must be sanitised - no raw HTML, no script execution, no javascript: links, matching the escaping discipline already applied elsewhere in this app (AB#1002's own innerHTML fixes are the precedent to follow, not repeat past).

- [x] A message written in Markdown (bold, italic, links, lists) renders formatted.
- [x] A message containing raw HTML or a script tag renders as inert text, not executed markup - a test proves this with a real XSS payload.
- [x] A javascript: link is stripped or refused, not rendered as a clickable link.
- [x] Screenshot of a formatted message and of a sanitised hostile payload rendering safely.

## Demo script

_To be written._
