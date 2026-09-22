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

## The last run (2026-09-22)

```text
Machine: Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz (12 logical cores), 32 GB RAM, Windows_NT 10.0.19045, Node 26.7.0.
Each ticker called 5 times in-process; median (slowest) in milliseconds. No sockets connected.

ticker                        | every |              N = 10 |             N = 100 |           N = 1,000
-------------------------------------------------------------------------------------------------------
miningTick                    |    5s |         3.76 (5.94) |         32.1 (36.9) |           294 (363)
refineryTick                  |   10s |         3.25 (3.79) |         29.8 (35.6) |           292 (326)
asteroidExpeditionTick        |   10s |         2.88 (3.75) |         32.9 (39.4) |           286 (347)
fabricationTick               |    5s |         3.18 (4.90) |         29.7 (42.2) |           291 (329)
travelTick                    |    5s |         3.60 (4.77) |         25.8 (39.2) |           287 (303)
processRndCompletions         |    5s |         2.73 (3.97) |         28.7 (30.1) |           285 (313)
processCeoInsightCompletions  |    5s |         2.75 (4.08) |         27.3 (31.7) |           267 (280)
checkAndResetNpcBuyOrders     |   60s |         0.08 (0.18) |         0.07 (0.19) |         0.10 (0.23)
financialSnapshotTick         |   30s |         4.19 (4.91) |         31.1 (37.6) |           336 (386)
-------------------------------------------------------------------------------------------------------
state write (accounts + world) |       |             6.33 ms |             35.8 ms |              403 ms
accounts-snapshot.json        |       |             0.62 MB |             5.96 MB |            59.40 MB
state.json                    |       |             0.02 MB |             0.02 MB |             0.02 MB

Budget at N = 1,000: each ticker under 50% of its interval; a state write under 1,000 ms.
  Everything is within budget.
All tickers together keep the event loop busy 35% of the time at N = 1,000, before any request is served.
```

Every ticker is within its own budget. The weak point is the total, not any one ticker:

- **Load:** at 1,000 corporations the tickers together hold the event loop about a third of the time, before a single
  request is served.
- **Cost per corporation:** almost all of it is the same per-corporation work, about 0.29 ms, repeated by every
  ticker. Each ticker calls `mutateAccountState` on every account, and that runs mining twice, the contract refresh and
  the level check, then deep-clones the whole account to return it; the tickers throw the clone away.
- **Growth:** it scales linearly. At about 1,400 corporations the tickers would hold the event loop half the time, and at
  about 2,900 all of it. Filed as **AB#1448**: tickers that do their work without the clone.

## Persistence and what a crash loses

- **Accounts (`accounts-snapshot.json`):** a change schedules a write 500 ms later, and later changes do not delay it.
  The write is atomic (a temp file, then a rename). A crash loses at most the changes of the last 500 ms plus the write
  in progress: **about 0.9 s at N = 1,000**, where the file is 59 MB and takes 0.4 s to write. At that size it is
  rewritten after every ticker burst, every 5 seconds.
- **The world (`state.json`, market, chat, forums):** a change schedules a write 300 ms later, **and every further
  change restarts the wait**. While changes keep coming faster than every 300 ms, nothing is written, and a crash
  loses everything since the last quiet moment. Filed as **Bug #1447**, with a repro.
