# LEARNING — interstellar-settlement-protocol

Every session's brief tells it to read this file. ISP-277 adds the 1.0 retrospective above this section. What follows
is codebase knowledge that Builders learned the hard way between 2026-09-21 and 09-23, folded from their `learning`
Issues by the doctrine fold (AB#1749). Each line was checked against main `a271151` on 2026-09-25. The general
lessons behind most of them are in hq `learnings/TRANSFERABLE.md` T-076 to T-084 and are not repeated here.

## Working in this codebase

- **New fields on a record get dropped silently.** The `ensureCorp*Model` normalisers (`server/game/mining.js`,
  `refining.js`, `asteroids.js`, `corporation.js`) rebuild records from a field list, and `normalizeStateShape`
  (`server/game/shape.js`) shapes both the global state and every account's state. Before adding state, grep all of
  them, and any second route that does the same job; a global-only field seeded in `normalizeStateShape` would be
  written into every account. *AB#979, 1026, 1095, 1181, 1300.*
- **Importing `server/index.js` starts the server** (Bug #578: it always listens). A test waits for it rather than
  listening again, and uses its own `ISP_DATA_DIR` so it never reads what a local server wrote. *AB#1199, 1162, 1034.*
- **Runtime state lives in `ISP_DATA_DIR`** (defaults to `data/`): `state.json` and `accounts-snapshot.json`. To look
  at a state that is slow to reach, register an account, stop the server, edit the snapshot (for example an office's
  `rentedUntil`), restart, and say so in the repro; delete the file afterwards. Seeded values are normalised on load,
  so read the rendered result. *AB#1008, 1144, 1212.*
- **A rule both the server and the page enforce lives in `public/scripts/`** as a pure module the server imports
  (the travel gate and transfers already do). Player-visible list templates go in `public/scripts/html.js` as pure
  functions, which gives a browser-free test. *AB#1007, 1246, 1006, 1041, 1432.*
- **`pushFeedback` writes to the one `#feedback-log` list.** A refusal raised on another tab is invisible unless it
  is also shown where the click happened. *AB#1289.*
- **Dev mode is any `NODE_ENV` other than `production`** (`IS_DEV` in `server/game/asteroids.js`) and runs scaled
  timings and yields. Per-tick arithmetic that floors to zero only shows in a production-mode run played to the end.
  *AB#1275.*
- **The demo login is on for `localhost` and `127.0.0.1` only.** Serve a look from `127.0.0.2` to see production
  behaviour; a page script can register a throwaway account there. *AB#1193, 1227.*
- **Onboarding dialogue types at about a character a second in a background window.** Budget minutes per Replay
  Onboarding. *AB#1118, 1392.*
- **Phone layout**: whole panels capped in `vw` collapse to about 100px on a phone. `tests/unit/phonePanels.test.js`
  derives the list from the stylesheet; keep new panels inside it. *AB#1063, 1230.*
- **Images from images.nasa.gov** carry their credit line in the record and mark the cases that are not public domain
  (CC BY citizen processing, DLR, ESA), so licence checks can be scripted before downloading. *AB#1556.*
- **Open defect**: the milestone roadmap renders into `#milestone-list`, which no page contains (Bug AB#1752, from
  AB#1020).
