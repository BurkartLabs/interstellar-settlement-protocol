# ISP 1.0 release-candidate gate run (AB#971)

Commit f39c9ce0, 2026-09-29T18:20:17.707Z to 2026-09-29T18:24:32.148Z. Production image, 0.5 CPU, 1 GiB, real TLS mail to a local catcher (scripts/rc-gate.mjs).

## Steps: 27 of 27 passed

- ok public-landing: the public page /. `shots/001-public-landing.png`
- ok public-how-to-start: the public page /how-to-start.html. `shots/002-public-how-to-start.png`
- ok public-login: the public page /login.html. `shots/003-public-login.png`
- ok public-register: the public page /register.html. `shots/004-public-register.png`
- ok a-register: A registers; the site says to check the mail. `shots/005-a-register.png`
- ok a-verified: A opens the emailed link, verifies, and signs in. `shots/007-a-verified.png`
- ok a-inbox: the inbox: the licence letter. `shots/008-a-inbox.png`
- ok a-office: rent an office for 7 days. `shots/009-a-office.png`
- ok a-hire: hire five. `shots/010-a-hire.png`
- ok a-lease: file the Earth claim. `shots/011-a-lease.png`
- ok a-yard: commission a yard. `shots/012-a-yard.png`
- ok a-cycle: start a cycle, and wait for the first tonnes. `shots/013-a-cycle.png`
- ok a-sell: sell to the standing order. `shots/014-a-sell.png`
- ok a-research: queue research. `shots/015-a-research.png`
- ok a-contract: accept a contract. `shots/016-a-contract.png`
- ok b-register: B registers. `shots/067-b-register.png`
- ok b-verified: B verifies from the emailed link and signs in. `shots/069-b-verified.png`
- ok a-lists: A lists 200 Silicates on the Exchange at 30. `shots/070-a-lists.png`
- ok b-buys: B buys 150 of A's Silicates. `shots/071-b-buys.png`
- ok a-sold: A sees the sale in its trade history. `shots/072-a-sold.png`
- ok b-fleet: B forms a fleet from its reserve: 6 destroyers and 12 attack troops. `shots/073-b-fleet.png`
- ok b-raid: B declares a raid on A's holdings at Earth. `shots/074-b-raid.png`
- ok a-warned: A is warned of the raid coming. `shots/075-a-warned.png`
- ok b-report: B reads its raid report. `shots/076-b-report.png`
- ok a-phone-raid-report: A, on a phone, reads the defender's report. `shots/077-a-phone-raid-report.png`
- ok a-return: A returns: the page opens on its saved session (or asks to sign in). `shots/128-a-return.png`
- ok a-return-notifications: A's notifications after the return. `shots/129-a-return-notifications.png`

## Fast-forwards (the saved world advanced with the server's own code, the app stopped)

- weeks: {"a":{"id":"acc-1790706029803-wm2ta1ks","level":12},"b":{"id":"acc-1790706110787-9algh3x5","level":12}}
- arrive: {"raid":"raid-mun07kad-1","inbound":1}

## Screens: 100 (50 at 1280, 50 at 375)

Scrolls sideways at 375: none.

Nearly empty: none.

## Page errors: 0


## Checks

- Telemetry rows stored: 22; by event: {"app_open":9,"verb_first":3,"rank_up":1,"verb_repeat":7,"session_end":2}.
- Design allowlist entries: 76 (the gate asks for 0).
- Mails caught: 2.
- Return visit: {"url":"http://127.0.0.1:40613/","signedIn":true}.
- First-day briefing offered again on a later sign-in (a new browser): gate-a-mun04m96, gate-b-mun04m96, gate-b-mun04m96, gate-a-mun04m96.
