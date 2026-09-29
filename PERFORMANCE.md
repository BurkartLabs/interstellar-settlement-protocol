# PERFORMANCE: what the server costs at 10, 100 and 1,000 corporations

`npm run bench:ticks` (`scripts/bench-ticks.mjs`, AB#729) builds one corporation through the real routes: an office,
five hires, the Earth lease, an extractor mining at 250 t/h, research and a CEO program queued, and a full set of 60
finance snapshots. It clones that corporation N times, loads the clones the way the server loads its snapshot, times
each ticker in-process, and times one full write of the accounts and the world. Run it again after any change to a
ticker or to what an account holds.

**What it does not measure:** sockets. The benchmark connects no clients, so the cost of emitting `mining:updated` and
`finance:updated` to real players is not in these numbers. Nor is request handling while the tickers run.

## The budget

- Each ticker uses **under 50% of its own interval** at N = 1,000.
- A full state write takes **under 1 second**.

## The last run (2026-09-23, after AB#1448)

```text
Machine: Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz (12 logical cores), 32 GB RAM, Windows_NT 10.0.19045, Node 26.7.0.
Each ticker called 5 times in-process; median (slowest) in milliseconds. No sockets connected.

ticker                        | every |              N = 10 |             N = 100 |           N = 1,000
-------------------------------------------------------------------------------------------------------
miningTick                    |    5s |         0.56 (3.05) |         4.09 (8.63) |         24.4 (47.6)
refineryTick                  |   10s |         0.21 (1.38) |         2.22 (2.78) |         15.6 (21.8)
asteroidExpeditionTick        |   10s |         0.18 (0.59) |         1.59 (3.50) |         17.2 (21.3)
fabricationTick               |    5s |         0.21 (0.29) |         1.69 (2.59) |         16.9 (22.4)
travelTick                    |    5s |         0.21 (0.36) |         1.10 (1.63) |         13.6 (22.2)
processRndCompletions         |    5s |         0.17 (1.42) |         2.10 (4.32) |         14.6 (34.2)
processCeoInsightCompletions  |    5s |         0.21 (0.82) |         1.32 (2.91) |         21.7 (39.6)
checkAndResetNpcBuyOrders     |   60s |         0.07 (0.18) |         0.09 (0.19) |         0.08 (0.21)
financialSnapshotTick         |   30s |         0.84 (1.87) |         5.87 (6.55) |         60.5 (91.6)
-------------------------------------------------------------------------------------------------------
state write (accounts + world) |       |             6.73 ms |             22.7 ms |              230 ms
accounts-snapshot.json        |       |             0.32 MB |             3.07 MB |            30.59 MB
state.json                    |       |             0.02 MB |             0.02 MB |             0.02 MB

Budget at N = 1,000: each ticker under 50% of its interval; a state write under 1,000 ms.
  Everything is within budget.
All tickers together keep the event loop busy 2% of the time at N = 1,000, before any request is served.
```

Every ticker is within its own budget, and the total dropped from 35% to 2% of the event loop at N = 1,000 — a
17.5x reduction, well past the 2x this was filed for.

- **Before (2026-09-22, same machine):** almost all of the 0.29 ms/account/ticker was the same repeated work: each
  ticker called `mutateAccountState` on every account, which ran mining settlement twice, the contract refresh and
  the level check, then deep-cloned the whole account to return it — a clone none of the nine tickers used.
  `miningTick` additionally called mining settlement a third time itself, so its own account update ran it three
  times for one 5-second interval.
- **Fix (AB#1448):** `mutateAccountState` takes `{ sanitize, settleMining }`, both defaulting to `true` so every
  route handler (which does use the clone, and does need mining settled around its own mutation) is unchanged. The
  nine tickers now call it with both `false`. Mining still settles exactly once per elapsed interval — inside
  `miningTick`'s own mutator, as before — and every other ticker no longer touches mining at all; the next real
  account read (any route, or the next `miningTick`) settles what accumulated meanwhile, the same guarantee
  `getAccountById` already gave every API response. `tests/integration/ticker-mining-settle.test.js` asserts both:
  a non-mining ticker leaves mining unsettled, and `miningTick` settles it exactly once.
- **Growth:** before the fix this scaled to 50% of the event loop at about 1,400 corporations and 100% at about
  2,900; the reduction moves that ceiling out by roughly the same 17.5x.

## Persistence and what a crash loses

- **Accounts (`accounts-snapshot.json`):** a change schedules a write 500 ms later, and later changes do not delay it.
  The write is atomic (a temp file, then a rename). A crash loses at most the changes of the last 500 ms plus the write
  in progress: **about 0.9 s at N = 1,000**, where the file is 59 MB and takes 0.4 s to write. At that size it is
  rewritten after every ticker burst, every 5 seconds.
- **The world (`state.json`, market, chat, forums):** a change schedules a write 300 ms later, **and every further
  change restarts the wait**. While changes keep coming faster than every 300 ms, nothing is written, and a crash
  loses everything since the last quiet moment. Filed as **Bug #1447**, with a repro.

## At release scale, with sockets (ISP-266, AB#962)

`npm run bench:ticks` above times eleven tickers in-process with no clients. It predates the seventeen tickers added
since v0.6, and since AB#2288 it could not run at all (Bug #4813, fixed with this). `npm run load:test` is the whole
server instead: the production image built from the checkout, run locally at production's size (0.5 CPU, 1 GiB,
`ops/infra/isp/isp.bicep`), N cloned mid-game corporations (default 200; D-1.0-1 names no launch number), and one
real socket.io client per corporation. Each client reads its account every 20 s and says a line in global chat about
once a minute. `scripts/load-probe.mjs`, loaded with `NODE_OPTIONS=--import`, times every timer the server's own code
registers, and samples event-loop delay (`monitorEventLoopDelay`) and memory. Nothing touches production.

**2026-09-28, 200 corporations, 7 minutes, 0.5 CPU** (i7-8700K host, Docker Desktop). These are bot numbers: cloned
corporations, one machine, loopback, and Docker's CPU cap rather than Azure's.

| | p50 | p95 | share of the run |
|---|---|---|---|
| accounts snapshot write (407 in 7 min) | 398 ms | 526 ms | 39.7% |
| loanServicingTick + defaultRecoveryTick (60 s) | 1,506 ms | 1,725 ms | 2.2% |
| raidTick (30 s) | 791 ms | 1,010 ms | 2.4% |
| shareOfferingTick + dividendTick (60 s) | 749 ms | 971 ms | 1.1% |
| financialSnapshotTick (30 s) | 413 ms | 504 ms | 1.2% |
| miningTick (5 s) | 199 ms | 311 ms | 3.8% |
| every other ticker | under 16 ms | under 92 ms | under 1% each |

All timers together held the event loop for 55% of the run. Event-loop delay p99 reached 1,699 ms (max 2,965 ms) in 38 of
81 five-second windows, and `GET /api/accounts/:id` answered in p95 2,366 ms. Memory stayed small: RSS 218 MB at peak
of 1,024 MB. Fan-out was 713 events a second on average (peak 1,142), almost all `chat:new`: one line reaches every
socket. At 1 CPU the same load still reached p99 1,246 ms and HTTP p95 737 ms, so a bigger container does not fix it.

Filed, not fixed here: **Bug #4815**. Every `getAccountById` read schedules a full snapshot write, so under traffic the
whole store is stringified about once a second. **Bug #4816**: tickers that look for rare records (loans, raids,
dividends) settle and copy every account through `getAccountById` to find none.

What the harness cannot see: the seeded world has no concessions, arbitration, patents, lobbying, raids, bonds or
offerings, so those tickers are timed over empty stores. Clones finish things at the same moments. No network sits
between clients and server.
