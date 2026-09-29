# Art debt: every visible placeholder, and what became of it

ISP-253 (AB#949), for the v1.0 RUBRIC gate "Nothing placeholder is visible". DOCTRINE treats a placeholder as a debt with
a due date, and 1.0 is that date. Each item below was resolved in one of four ways:
- with art already in the repository;
- with a treatment drawn by the design system;
- by removal;
- or listed as **needs art**, which is a spend call for the Board, filed as a Decision.

Nothing was sourced or commissioned here. The inventory was taken at `origin/main` f872b844 (2026-09-29). Screenshots
of every screen that changed are in `docs/ab-949/` at 1280x800, and `node scripts/look-art-debt.mjs docs/ab-949` takes
them again.

## Inventory

**1. Building `imageFile` entries (17, data file only).** Screen: none.
- `data/buildings.json` named 17 PNGs under `buildings/` that never existed. Nothing read the field (no client or
  server code), so no broken image was ever shown; the debt was a data file promising art that did not exist.
- **Removed.** `scripts/design-check.mjs` now also checks an image a data file names relative to `public/images/`. It
  used to match only paths starting `images/`, which is why these 17 passed. `tests/unit/designCheck.test.js` seeds one.

**2. Station office headers with art (3).** Screen: Station → Offices → the office.
- **Resolved, existing art:**
  - Orbital Executive Suites and ISA Claims & Leases show a 960x640 photograph behind the caption scrim
    (`.station__art--oes`, `--icl`).
  - The Galactic Exchange Hub's Enter opens the Market tab, whose background is `galactic_exchange.jpg`. The
    `station__art--ge` branch in `views/station.js` is never reached, because no building is called
    `galactic-exchange`.

**3. Station office headers without art (7).** Screen: Station → Offices → the office.
- **Needs art: Decision AB#4876.** These offices a player can open show the plain design-system header (badge, section
  code, title): Earth Assembly, Galactic Arbitration Council, Corporate Registry & Charters, Interplanetary Trade
  Commission, Conglomerate Affairs Bureau, Deep Space Development Bank and Intergalactic Stock Exchange.
- The header is finished, not broken, but a tier below the three above. Compare `station-executive-suites` with
  `station-development-bank`.
- **Size of work:** 7 images at 960x640 JPG, about 50 KB each, plus one CSS rule per office.

**4. Offices never shown (6).** Screen: none.
- Interstellar Settlement Authority, SolSec, Regulatory Compliance, Risk Assessment & Insurance, Orbital Visa &
  Personnel and ISA Enforcement Division are `available: false`, and the Offices list filters them out. The Contracting
  & Assignments Bureau opens the Assignments tab.
- **Nothing visible to resolve.** An office made available later is a new item in section 3.

**5. Planets and moons of Sol (17).** Screens: Starmap, Station header.
- **Resolved, existing art.** Each has a NASA image (AB#741) whose source is recorded in
  `public/images/planets/CREDITS.md`.

**6. Bodies of the other systems (v0.7+).** Screens: Starmap, Station header.
- **Resolved, code-drawn.** Each is drawn procedurally from its style in `data/systems.json` (AB#742). The plain
  gradient "placeholder" kind is unreachable, and `tests/unit/bodyRender.test.js` walks every body to hold that.
- The asteroid belt is drawn as a field of asteroids, not a disc.

**7. Icon glyphs, Forums.** Screen: Chat → Forums.
- **Removed:** 💬 before the reply count, ▲ before the like count and on the Like button, ↩ on Reply, ❝ on Quote.
- Each label already said it. The thread card's like count now reads "1 like" / "N likes".

**8. Icon glyphs, Assignments.** Screen: Assignments.
- **Removed:** ⚠ on the Remote badge and the docking warning, ● on the Local badge, ✓ on the completed log's badge.
- The badge's tone (warn, success) carries the meaning, as BUREAUCRATIC_UI.md asks.

**9. Glyphs kept as typography.** Everywhere.
- **Kept, not icons:**
  - ¤ is the currency sign.
  - → and ← in link and button labels.
  - ▾ and ▸ disclosure carets, which are `aria-hidden`.
  - ▲ ▼ ▬ on the Financial Core's change figures, each beside its signed number.
  - ◂ in a Starmap canvas label.

**10. Image licences (5).** Screens: Station, the liaison, Operations.
- **Board: Decision AB#4876.** These five images have been in the build since v0.2 with no recorded source or licence:
  - `orbital_executive_suites.jpg`
  - `isa_claims_leases_division.jpg`
  - `galactic_exchange.jpg`
  - `elara_voss.jpg`
  - `mining_probe.png`
- They are not placeholders. A public release needs them confirmed, the way `planets/CREDITS.md` records the planets.

## Still owed

- **Section 3:** 7 office headers, or the Board's word that the plain header ships (AB#4876).
- **Section 10:** the five images' sources (AB#4876).
