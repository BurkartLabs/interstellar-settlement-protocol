# AB#955 (ISP-259): the path from the landing to the first verb, measured

## How it is measured

`npm run measure:first-verb [width height outDir]` (scripts/first-verb-path.mjs) walks a stranger's path in a real
browser, on its own scratch server:

1. land, Register Corporation, and fill the four fields;
2. open the email's link, press Verify My Email, then log in;
3. Brief me;
4. follow the walkthrough to an office, five hires, the Earth lease and an extractor.

It counts every click and every field, including confirmations, receipts and, on a phone, the nav group taps. It flags
any control the page left covered, screenshots each stage, and reads back the telemetry the page sent from the server's
own store. The counts are per stage in `counts-*.json`, with every action listed.

## Before and after

| | 375x812 | 1280x800 |
|---|---|---|
| Clicks to the first extractor, before | 23 | 23 |
| Clicks, after | 23 | 23 |
| Fields, before | 7 | 7 |
| Fields, after | 7 | 7 |
| Controls the walkthrough left covered, before | **2** (the Offices tab under the card and the bottom nav; Back to Station under the header) | 0 |
| Controls left covered, after | **1** (Back to Station, filed as #4860) | 0 |
| Submits to see all four mistakes in a form with four, before | **4**: one message a submit (`register-four-mistakes-before.png` shows only the first) | same |
| Submits, after | **1**: all four at once (`register-four-mistakes-after.png`) | same |

The walk's time, landing to extractor at 375: about 25 seconds of script time. That measures the page, not a person reading.

**Telemetry recorded on the walk:** app_open; funnel_step for licence, station, office, hire, lease, yard and cycle;
verb_first, rank_up and verb_repeat. Every walkthrough stage on the path sends its funnel_step.

## The 23 clicks and 7 fields, in order

1. **Landing and registration:** Register Corporation; 4 fields; Register And Continue.
2. **Verification and login:** the email's link; Verify My Email; Log In; 2 fields; Log In.
3. **The opening:** Brief me.
4. **Office:** Inbox; the Station group; Station; Offices; the suites' Enter; Rent office; acknowledge.
5. **Staff:** 1 field (5); Hire; acknowledge.
6. **Lease:** Back to Station; the claims office's Enter; Purchase the Earth lease; acknowledge.
7. **Extractor:** Manage lease; Build extractor; acknowledge.

## Fixed here

- **Bug #4858:** on a phone the walkthrough left its highlighted control under its own card and the fixed bottom nav
  after a tab opened. The cause was the tab's reveal scroll running after the walkthrough had placed the control.
- **Bug #4861:** the register form named one mistake a submit, and its first message did not say what was wrong.
  - It now names every mistake at once, each with the fix, by the server's own rules.
  - A taken email keeps its Log in link beside the field, and a taken corporation name says to choose another.
  - An invalid field stays red under the pointer.
  - Server validation and the register rate limit are unchanged. No field is pre-filled, and no new data is collected.

## Filed, not fixed

- **#4860:** after hiring, at 375, Back to Station ends up under the header (the header is sticky only within its
  container).
- **#4863:** after verifying, the player logs in again: 1 click and 2 fields. A Board call on the session rule.
- **#4864:** four receipts to acknowledge on the path: 4 clicks. A Board call on AB#744.
- **#4865:** the walkthrough leaves the Station group and the Offices subpage to the player: 2 clicks.

Together those would take the path from 23 clicks and 7 fields to about 15 and 5.

## Screenshots

`375/01-landing.png` to `375/11-first-extractor.png` show each stage at 375px. They need a human's look, as the
acceptance asks.
