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

## The store's query and write cost (ISP-267, AB#963)

The store is the accounts snapshot and the world state, held in memory and written to JSON files. It keeps no query
log. `npm run load:test -- --profile` records a V8 CPU profile of the server under the load, and
`scripts/profile-store.mjs` reads it as the store's query statistics:
- **A query** is a store function, or any function that walks every account.
- **Its total** is the time it spent on the stack, including what it calls.
- **A run** is an unbroken stretch of samples. At the 1 ms interval a slow call is measured well, and short
  back-to-back calls merge, so p95 per run is an upper bound for fast queries.

The probe also counts every file the server writes. `--data tmpfs` puts `/data` in memory: a bind mount from a
Windows host's non-system drive took about a minute per snapshot write, which measured the host, not the server.

**2026-09-29, 200 corporations, 5 minutes, 0.5 CPU, profiled, `/data` in memory.** Bot numbers: cloned corporations,
one machine, loopback, and the profiler roughly doubles every time against AB#962's unprofiled run above. Before is
origin/main; after is this change.

| # | before: query | total | share | p95/run | after: query | total | share | p95/run |
|---|---|---|---|---|---|---|---|---|
| 1 | writeAccountsSnapshotToDiskNow | 98.1 s | 31.2% | 975 ms | writeAccountsSnapshotToDiskNow | 111.1 s | 35.4% | 912 ms |
| 2 | its debounce timer | 97.4 s | 31.0% | 975 ms | its debounce timer | 110.3 s | 35.2% | 925 ms |
| 3 | getAccountById | 71.5 s | 22.7% | 95 ms | mutateAccountState | 58.1 s | 18.5% | 103 ms |
| 4 | sanitizeAccount | 63.7 s | 20.2% | 71 ms | miningTick | 32.3 s | 10.3% | 407 ms |
| 5 | mutateAccountState | 52.5 s | 16.7% | 100 ms | getAccountById | 31.1 s | 9.9% | 60 ms |
| 6 | miningTick | 28.0 s | 8.9% | 496 ms | sanitizeAccount | 28.2 s | 9.0% | 59 ms |
| 7 | raidTick | 18.0 s | 5.7% | 714 ms | financialSnapshotTick | 8.4 s | 2.7% | 494 ms |
| 8 | openLoans | 9.4 s | 3.0% | 781 ms | processRndCompletions | 4.7 s | 1.5% | 100 ms |
| 9 | financialSnapshotTick | 8.7 s | 2.8% | 500 ms | shipmentTick | 4.4 s | 1.4% | 99 ms |
| 10 | defaultRecoveryTick | 8.5 s | 2.7% | 912 ms | processCeoInsightCompletions | 4.3 s | 1.4% | 100 ms |

- **What changed.** Scans that looked for rare records (loans, defaults, dividends, raid moves) read every account
  through getAccountById, which settles and deep-copies it. They now look with `peekCorp` (Bug #4816), and
  getAccountById's total fell from 71.5 s to 31.1 s, two thirds of it now the GET route itself.
- **Ticker runs.** loanServicingTick + defaultRecoveryTick 3,606 → 2 ms p50; shareOfferingTick + dividendTick 1,431 →
  1 ms; raidTick 1,803 → 1 ms.
- **The event loop.** The median window's p50 delay fell from 1,111 to 85 ms; HTTP p50 went from 3.5 to 2.1 s, and
  errors from 90 to 0.
- **No GET writes.** Before, 29 GET routes scheduled or made a write; now none does
  (tests/integration/get-routes-write-nothing.test.js). Write amplification did not fall, though: 2,007 MB before,
  2,164 MB after, about 1 MB per HTTP request. The accounts snapshot (16.6 MB at 200 corporations) was written 120
  and 129 times, 0.43 a second. Reads were not what kept it writing: seven 5-second and 10-second tickers mutate
  every account on every run (Bug #4848), and each mutation schedules a write (Bug #4815, still open).
- **Indexes.** None was added. No lookup by public id or email reached the query list, so no index's benefit could
  be measured.
- **Filed, each remaining query over 50 ms p95.**
  - The snapshot write: Bug #4815.
  - The idle tickers and mutateAccountState: Bug #4848.
  - getAccountById/sanitizeAccount's deep copy, and the GC pauses it drives into small queries: Bug #4849.
  - miningTick and financialSnapshotTick's per-mutation passes: Bug #4850.
  - Startup and shutdown work (loading and seeding the store, the save on SIGTERM) runs once and is not a request's
    cost.

## The accounts snapshot write (Bug #4815, Bug #4852)

Each account carried its own copy of the world catalog: 51 KB of every 85 KB account, identical in all of them, with
every belt's contents in it (Bug #4852, a leak past Bug #2355's scout gate). The snapshot re-stringified it on every
write, and every read deep-copied it. Accounts now keep no world. Old saves drop it at load, and a read attaches one
shared, frozen public view (catalogView.js `publicWorld`). Write timing is unchanged: the same debounce, and the same
crash window as above.

**2026-09-29, 200 corporations, 5 minutes, 0.5 CPU, unprofiled, `/data` in memory** (bot numbers: cloned
corporations, one machine, loopback):

| | before | after |
|---|---|---|
| snapshot size per write | 16.6 MB | 6.9 MB |
| snapshot write, p50 / p95 | 503 / 788 ms | 109 / 205 ms |
| snapshot writes' share of the run | 28.1% | 5.5% |
| all timers' share of the run | 43.7% | 15.6% |
| event-loop delay, worst five-second p99 | 1,404 ms (23 of 59 windows over 100 ms) | 78 ms (none over) |
| GET /api/accounts/:id, p50 / p95 | 872 / 3,402 ms | 123 / 596 ms |
| bytes written per HTTP request | 1,014 KiB | 362 KiB |

The write still happens about 0.44 times a second, because the tickers change every account every few seconds (Bug
#4848). At 110 ms a write that is 5% of the server, so a longer interval (and a longer crash window) is not worth it
now. HTTP p95 is still over its 500 ms budget, which is Bug #4849's deep copy on every read.

## The account read (Bug #4849) and what sets HTTP p95 (Bug #4859)

`GET /api/accounts/:id` deep-copied the account (`JSON.parse(JSON.stringify(state))`) and then stringified the copy
to send it. It now stringifies the held account once (`server/accountJson.js`). The public world's JSON is made once,
and the result is the same string, which a test holds it to. The loan, bond and equity routes also stopped
sanitising an already sanitised account.

**2026-09-29, 200 corporations, 5 minutes, 0.5 CPU, `/data` in memory** (bot numbers):

| | before | after |
|---|---|---|
| GET /api/accounts/:id p50 (unprofiled) | 123 ms | 63 ms |
| GET /api/accounts/:id p95 (unprofiled) | 596 ms | 591 ms |
| event-loop worst five-second p99 (profiled) | 1,482 ms, 11 of 60 windows over 100 ms | 216 ms, 1 window |
| getAccountById + sanitizeAccount, share of CPU (profiled) | 3.1% + 2.3% | out of the top 10 |

p95 did not move, because the handler no longer sets it. A request that arrives during a ticker run waits for the
whole run: financialSnapshotTick p95 663 ms, miningTick 488 ms. That is Bug #4859, whose proposed fix is to walk the
accounts in slices and yield between them.
