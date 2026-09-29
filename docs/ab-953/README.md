# AB#953 (ISP-257): the landing for a public audience

## What a stranger sees above the fold

At 375, 768 and 1280, measured on this branch's server; the primary call to action ends at 664px on a 812px phone.

1. The logo and the tagline. The Board put them first (AB#2462), and they stay there.
2. "Earth Assembly Act 2147" and the title.
3. **The verb, in one sentence:** "*Allocate* your corporation's credits, crews and building slots across Sol: lease a world, refine what it yields, and sell it on an exchange where the buyer is another corporation." It is taken from BRIEF.md's verb and one-sentence pitch.
4. **Who it is for:** "For players who would rather run the market than fight the war. A text-first strategy game in the browser, played over months, not minutes." It is from BRIEF.md's audience ("the EVE player who lives in the market window") and its "not a mobile idle game".
5. **One primary call to action,** Register Corporation. Log In stays as a secondary button for returning players.
6. **The starmap,** a real in-game screen, beside the pitch at 1280, and mostly visible at 768. At 375 it comes after the Board's description, just under the fold.

## Proof points: three screens, not a list

Each is a real screen from a seeded game, captured by e2e/seed-industry-account.mjs and seed-exchange-account.mjs, with the seeded numbers:

- **Refine, then wait for it:** a refinery run, 100 Silicates becoming Aerogel and Quantum Insulators, 2h 59m remaining. This is the delayed payout the design bets on (BRIEF: day-3 return).
- **The other side of the order is a corporation:** the exchange's sell orders, each lodged by another corporation. This is BRIEF's second measure, a player-driven economy.
- **Levels are built, not ground:** a level's milestones (research, build, hire) and what the next level opens.

## Removed

- The feature catalogue: "What ISP Is", "Core Gameplay Pillars", "Map, Warfare, And Discovery", "Economic Engine In Detail" and "Long-Horizon Campaign Structure", 20 cards in all.
- "Why This Prototype Exists".
- On login.html, the dev-only button "Developer: Log In To Demo Account" (id dummy-login-btn). It is now "Log In To Demo Account" (demo-login-btn), still hidden unless dev access is on.
- `tests/unit/landingPublic.test.js` holds these: no public page says prototype, dummy or developer.

## Veto points for the Board

1. **The three proof points:** refining, the player exchange and milestone levels. Leasing a world, the starmap's leases, or the conglomerates were the alternatives.
2. **The verb sentence and the audience line,** word for word, and whether the audience line should name other games (BRIEF names EVE, Gaia Project and Football Manager; the page does not).
3. **Your description (AB#2462) is kept verbatim** under the actions. It now repeats some of what the verb line says. Keep it, trim it, or move it below the proof points?
4. **Tone.** The headings are dry and administrative ("On file: a corporation at work") rather than the full protocol voice with phrase and code. The in-universe dashboard voice felt like a wall for a stranger.
5. **Screenshots show seeded test data.** The seller is "Kessler Ore Brokers", a seeded corporation. They could be retaken from a real game later.

## Not done by me

AB#953's first acceptance line needs a person who has not seen ISP to look at a silent screenshot and say what the game is. I cannot do that, and a model's reading would be a proxy, not that. The fold shots below are the ones to show them.

## Screenshots

- `fold-375.png`, `fold-768.png`, `fold-1280.png`: what is above the fold at each width.
- `page-375.png`, `page-768.png`, `page-1280.png`: the whole page at each width.
