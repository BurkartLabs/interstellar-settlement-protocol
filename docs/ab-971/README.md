# ISP-275 (AB#971): the 1.0 release-candidate gate, first run

`npm run gate:rc` (scripts/rc-gate.mjs) builds the production image and runs it locally at 0.5 CPU and 1 GiB, with real
TLS mail to a local catcher. It plays the release candidate in Chromium: a fresh account's first hour, every
navigation group at 1280 and 375, a second account that trades with the first and raids it, the defender reading the
report on a phone, and a return visit. Nothing is deployed and production is not touched. The run writes
`report.md`, `results.json` and one screenshot per step and per screen.

This folder holds the run at f39c9ce0 (main c0a03819 plus the script): `report.md`, `results.json` and the 27 step
screenshots in `shots/`. All 129 shots, including the 100 screens, are attached to AB#971 as a zip.

## What passed

- 27 of 27 steps; 100 screens (50 at 1280, 50 at 375); 0 page errors; nothing scrolls sideways at 375.
- Mail: both accounts verified from the emailed link (2 mails caught).
- Trade: A lists 200 Silicates at ¤30, B buys 150, and A sees the sale in its history.
- Combat: B forms a fleet and raids A at Earth. A is warned; both read the report, A on a phone.
- Return visit: A's saved session opens signed in.
- Telemetry in the store: 22 rows (app_open 9, verb_repeat 7, verb_first 3, session_end 2, rank_up 1). These are
  the gate's two scripted players, not players. funnel_step is absent because the run declines the briefing; it
  fires when the briefing is played (AB#955).
- Fresh clone at c0a03819: `npm test` passed all 496 files and 6,086 tests, none not run.

## Two fast-forwards, stated

1. **weeks.** Both corporations are moved to level 12 and past new-corporation protection. A gets goods and a garrison;
   B gets ships and troops in reserve.
2. **arrive.** The raid's arrival time is moved to now.

Both use the server's own code with the app stopped. Every player action is taken in the browser. The level-12
targets on the return shot (e.g. 15 of 394,000 Silicates) come from the fast-forward, not from play.

## Findings

- Bug #4885: declining the first-day briefing is remembered only in localStorage, so it is offered again on every
  new browser. Severity 3. Fixed since the run (PR 1400).
- Bug #4886: the design allowlist still holds 76 entries; the gate requires 0. Severity 3, effort 5.
- Bug #4887: the Exchange price history printed the real year (2026-09-29). Fixed in its own pull request.
- Not filed: the header says v0.4; the version is set when 1.0 is cut.

## Not met by this run

The item stays open for these:

- a Critic review returning SHIP;
- the Board playing it and looking at the screenshots;
- the open predecessors AB#959 and AB#964, and the balance decisions in AB#968;
- the empty allowlist (#4886).
