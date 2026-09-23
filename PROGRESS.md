# ISP — handoff

**2026-09-23, Builder (Sonnet 5), non-visual session (no CONTROL_URL, no Chrome extension attached — see
"Blind spot" below).**

## What's now true

- An office authorizes a corporation only at the station it was rented at, and only while its lease has not
  lapsed (AB#1124, merged PR !388): hiring, renting an office, filing a mining lease and starting a mining
  cycle all read one helper, `activeOfficeAt(corp, stationId, now)`, in `server/index.js`. Previously hiring
  checked no office at all, renting one worked from any station in the registry (including systems a fresh
  corporation cannot reach), and filing a lease accepted any office ever rented anywhere, expired or not. Six
  existing suites needed an office added to their fixtures to keep passing; one of those changes matters beyond
  test plumbing — "at the employee cap but not yet promoted" is no longer reachable at level 0, because hiring
  now needs an office, and any office plus 5+ employees already completes level 1's own requirements. New
  coverage: `tests/integration/office-requirement.test.js` (9 tests, 7 of which fail on the pre-fix code).
  Confidence medium, as the original filing said: this reads the Suites/claims-office copy as requiring a
  *local* office; flagged in the PR for the Board to veto if a company-wide office was intended.
- AB#1122 (a blank Head Count/Throughput/durationDays hiring or renting for the default price) was **not**
  fixed this session: it was already fixed by AB#731's merge two days earlier, filed just after that fix
  landed but at a commit that predated it reaching the branch this session found it on. Closed as a duplicate
  with the read of current `server/gameplayInput.js` as evidence (P-DUPLICATE-FIX), rather than re-fixing it.

## Blind spot

This session has no browser (no Chrome extension connected, no CONTROL_URL/token — Builder panes don't get
either by design). AB#1124 is a server-route fix, but its new refusal text is also read from the Orbital
Executive Suites and ISA Claims & Leases screens; those screens were not looked at. Verified instead with
`npm test` (146 files / 1489 tests green, `node --check server/index.js`) and a live server run with
`ISP_DEV=1`, exercising the real HTTP routes directly (registered a fresh corporation, confirmed each of the
four repro cases and the normal path by direct request) — real evidence, not a screenshot.

Several other v0.5-security items were checked and left unclaimed rather than forced by the prior session; that
list (AB#756, AB#734, AB#753/755/757/781/987/989) still stands — see the "What's next" note below.

## What's next

Continuing the ISP backlog by state/priority. Two things worth a look next session:
- **AB#752's rate limiter** (`server/rateLimiters.js:86`, merged today) logs `ERR_ERL_KEY_GEN_IPV6` on every
  server start — the server still starts, so this was not treated as a blocker, but it wants filing and a look
  at whether the IPv6 key generator is actually safe under the current keying scheme.
- Re-check AB#731/#732/#756 next session — once those land, AB#734 becomes buildable.
- The screenshot-gated v0.5 items (AB#753/755/757/781/987/989) are ready to pick up once a browser session is
  available.

## In flight / blocked

Nothing blocked, nothing left uncommitted. `fix/1124-office-requirement` merged and its worktree removed
(P-STRANDED); this PROGRESS.md update rides its own branch, `docs/1124-progress`, since the fix's branch was
already finished when the gap was noticed.
