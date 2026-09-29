# AB#940 (ISP-244): the v0.13 milestone playthrough

**A local run, not the deployed build.** The item asks for the deployed build. The beta (`isp-web`) is up, but its
image, `isp:202609271727-675604e`, was built on 2026-09-27 from commit 675604e, which is not on main and is 296
commits behind it. It also cannot take a new player: registration requires email verification (AB#2288), and the
container has no `ISP_SMTP_*`/`ISP_MAIL_FROM`, so every registration answers 503 and nothing is registered. That is
AB#989, waiting on the Board. I read this from the image tag, the container's settings and the code; nothing was sent to
the beta. Even with mail, a scripted run cannot read three inboxes. So this run is on a local server at origin/main
(`ad38bef1`), and **"on the deployed build" and "the Board has looked at the screenshots" are left open for the Board.**

## How it was played

`e2e/v013-playthrough.spec.js` drives three corporations through the page, each in its own browser: Orion (A), Bright (B)
and Cinder (C). It runs twice with the sizes swapped, so every screen is seen at both widths: first A and C at 1280 and
B at 375, then A and C at 375 and B at 1280. The server runs with its real tickers. Each of the 32 steps is screenshotted,
and a step that fails is recorded and passed over, so one run shows everything.

**Seeded** (`e2e/seed-v013-play.mjs`, each stand-in labelled there):
- three corporations at Verde Trade Hub, Tau Ceti (the tariff corridor, cap 5%), at level 10;
- Orion's 14 days of control readings, and the week of mining and selling in Tau Ceti that the server's own daily
  computation reads (without it, the startup computation rightly breaks the 14-day streak);
- Orion's completed Fusion Fuel Cycle research, two hours old, so it can be patented in the page;
- Earth Assembly standing for Orion and Bright;
- 12 days of Nickel trading at 24 credits, so the ITC has a normal value.

**Fast-forwarded** with the server stopped (`e2e/v013-fast-forward.mjs`): only what needs time. Each step moves a stored
clock back and runs the tick the server runs:
- the 72-hour petition review;
- the 72-hour tariff and lease-discount notice;
- travel arrival;
- the end of the day of cheap sales, so the ITC's 00:00 UTC watch reads it;
- the ITC levy's 24 hours;
- the lobbying pledge window;
- the Council's 72-hour response window.

**One stand-in is not time:** a copy of Bright's real tariff-paying sale, charged at 5% while 3% was in force. The game
should never charge that, but it is the overcharge a tariff case exists for, so the Council's upheld-and-enforced path
could be seen. The real sale's own case is in step 28.

## What happened (both passes: 30 of 32 steps pass, 2 known bugs)

| # | Who | Step | Result |
|---|---|---|---|
| 1 | Orion | Tau Ceti eligible (14 of the last 14 days), petition filed for 25,000 credits | pass |
| 2 | Bright | sees Orion's petition under review | pass |
| 3 | Orion | holds Tau Ceti; files a 10% lease discount and a 3% tariff (both wait out 72 h notice) | pass |
| 4-5 | Orion, Bright | the tariff (3% of a 5% cap) and the discount in force; Bright sees the tariff | pass |
| 6-7 | Bright, Cinder | Bright lists 500 Nickel at 26: the confirmation quotes "Concession Tariff (3%) −¤390"; Cinder buys | pass |
| 8 | Bright | the tariff in Trade History | **known: Bug #4853** (the row shows the tax, not the tariff) |
| 9-10 | Bright, Cinder | 1,500 Nickel at 12: the ITC's warning names the line (¤20.40), the volume and the duty; Cinder buys | pass |
| 11-15 | both | Bright jumps to Epsilon Eridani, Orion to Sol; both dock | pass |
| 13, 18 | Bright | the ITC opens an anti-dumping investigation; the duty is levied a day later | pass |
| 16-17 | Bright, Cinder | the same Nickel sold at Kestrel Platform pays no tariff (routed around) | pass |
| 19 | Orion | patents Fusion Fuel Cycle at 1% | pass |
| 20 | Bright | queues the patented node | pass, but nothing says it will cost a royalty: **known, Bug #4857** |
| 21, 26-27 | Orion, Bright | Orion opens a campaign to raise Tau Ceti's tariff cap; Bright pledges against; it fails, moving nothing | pass |
| 22-25 | Bright, Orion | Bright docks at Earth; pays 120 credits of royalty; Orion's register shows the patent | pass |
| 28 | Bright | the Council's evidence on the real 3% sale | pass, but it reads the lawful rate as 0%: **Bug #4854** |
| 29-32 | Bright, Orion | the stand-in case filed, answered, ruled upheld (900 credits), enforced from Orion's tariff income, on the docket | pass |

## Filed from this run

- **Bug #4854** (severity 2): once a holder has set a lease discount, the Council reads its concession as not granted,
  so every tariff it charges looks like an overcharge. Bright's real, lawful 3% sale reads "Holders' rates then 0%
  (lease-modifier) ... Lawful rate 0% ... Excess 540 credits" (step 28).
- **Bug #4853** (severity 3): Trade History shows a sale's tax but not its tariff: 390 credits taken with no line
  saying where (step 8, marked known in the spec).
- **Bug #4857** (severity 3): queuing a patented research node says nothing about the royalty (up to 25% of its cost),
  which is then taken at completion; the refinery quotes a patented chain's royalty before a run (step 20, known).
- **Bug #4856** (severity 4): after a jump, the sidebar's Location shows the raw system id ("sol") until the player docks.
- **Bug #4851**: filed from the first attempt and **withdrawn as a duplicate**. An open system view on the Starmap
  re-requested the Rats' activity about 40 times a second and rebuilt its buttons under the pointer. Main had already
  fixed it in 628b7130 (AB#4834) after my worktree's base; I had not fetched again before filing.

Seen, not filed:
- the campaign register says "Against: nobody yet" on a campaign that has closed (copy);
- 20,000 credits and 5 standing for, against 15,000 against, moved the tariff cap by nothing (as the formula gives);
- a value typed into the tariff or pledge form is put back if the panel redraws from an answer that lands within about
  a second (only a script is that fast: a typed rate survived 75 s of normal refreshes, a chosen side 30 s).

## The screenshots

`a-desktop/` and `a-phone/` hold each new screen, as a crop of the panel the step was about, at the player's size. The
v0.13 screens:
- the concession panel (petition, holder, discount and tariff), ISA-NAV-1;
- the listing confirmations with the tariff and the ITC warning;
- the notifications;
- the Corporate Registry's patent office, ISA-REG-13 to 16;
- the Earth Assembly's lobbying office, EA-LAW-5;
- the Galactic Arbitration Council's filing, cases and docket, GAC-LAW-2 to 4.

## Checks

- **Fresh clone** of origin/main at 26fa619 (the item's line "the full suite is green on a fresh clone"): check:design
  clean; vitest 466 of 466 files, 5,914 tests, all pass.
- **This branch**, at origin/main 60a1c607 with the harness added: check:design clean; vitest unit, schema and probes
  260 files and 2,682 tests pass; integration 212 of 213 files, 3,267 of 3,268 tests. The one failure is
  remote-dispatch.test.js, open Bug #4752, which fails on main.
- **The playthrough**: `npx playwright test e2e/v013-playthrough.spec.js`, both passes green (about 7.5 minutes), with
  steps 8 and 20 marked known against Bugs #4853 and #4857.

## Open for the Board

- Run it on the deployed build: redeploy the beta from main once AB#989 (the email sender) is in, then play it with
  three accounts whose mail can be read. The spec's steps are the script.
- Look at the screenshots in `a-desktop/` and `a-phone/` and say so on AB#940.
