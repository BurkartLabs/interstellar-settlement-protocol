# The bureaucratic voice: document codes, protocol phrasing, UTC and reference numbers (ISP-247, AB#943)

Plan line (v1.0 Facelift, Feature AB#398): *"Bureaucratic UI pass — reinforce the cold corporate sci-fi tone: section
headers as for[ms]…"*. LORE.md sets the tone in one line: **"Earth did not collapse. It bureaucratized."** The player
runs a chartered corporation inside a treaty. Every screen is paperwork someone at the ISA filed, and the interface
should read that way.

This guide says how, so that three sessions do not invent three schemes. It has one rule above the others:

> **The plain words always stay.** A code, a protocol phrase or an in-fiction date is added *beside* the plain title,
> the plain status and the real time. It never replaces them. A new player, and a screen reader, must never need to
> decode anything to use the game.

The registry is `data/section-codes.json`. `tests/unit/sectionCodes.test.js` holds it to the page. The build stories
are ISP-248 (AB#944: the section header on the design system, applied everywhere) and ISP-249 (AB#945: UTC timestamps
and reference numbers).

## What the build already does

The voice is not new. Several things in the build already speak it, each its own way:

| Where | Today | This guide |
| --- | --- | --- |
| Header, landing | "Est. 2147", "Earth Assembly Act 2147" | The in-fiction year, and its offset, fixed below |
| Financial Core lede | "CORP-FIN-1 // Real-time consolidation of…" | Kept: the Financial Core's code is CORP-FIN-1 |
| Assignments agent card | "ISA // {the agent's title}" (`factionCode // title`) | The department prefixes are these faction codes |
| Contract titles (`data/missions.json`) | "Silicate Requisition Order — Batch 4-7A", "Nickel Freight Manifest — Consignment 9-2B" | The voice to match: a document type, then its batch |
| Starmap station card | "EER-STATION-001 // EPSILON-ERIDANI" | A station designation, left as it is: a name, not a document code |
| Mining probe return mail | "Ref: MPR-SOL-12345678" | Becomes MPR-2147-XXXXXX (below) |
| ISA licence mail | "Ref. ISP-2147-{ref}-AUTH" | Becomes LIC-2147-XXXXXX |
| Dates | "28 Sep, 06:00 UTC", "28 Sep 2026, 06:00 UTC", "2026-09-28 06:00 UTC", "11:55 UTC" | One format (below) |

## Prior art

| Source | What it does | What ISP takes |
| --- | --- | --- |
| **Papers, Please (Lucas Pope, 2013)** | The whole interface is diegetic paperwork: permits with seals and issuing offices, a rulebook, and the inspector's DENIED and APPROVED stamps. Its bureaucracy *is* the challenge: the player checks documents against each other and is fined for a missed discrepancy. | **Taken**: the interface as the world's own documents. Every record has an issuing office (the department code), a stamp-like status word (protocol phrasing) and a reference number. **Not taken**: the tedium as the game. ISP's paperwork never hides a fact, never asks the player to cross-check two documents, and never punishes a misread. The plain meaning is always printed beside the stamp. |
| **ISO 8601** (date and time representation) | Big-endian dates (year, month, day), 24-hour time, and an explicit zone: unambiguous across locales. | **Taken**: YYYY-MM-DD HH:MM with the zone always written (UTC). ISO 8601 writes a "T" between date and time. RFC 3339, its internet profile, allows a space instead for readability, and ISP takes the space. |

## Document codes

**The scheme is `DEPT-FUNC-N`.**
- `DEPT` is the issuing department.
- `FUNC` is the function.
- `N` is a number within that pair: the screen first, then its sections in page order.

A section header reads **`CORP-OPS-3 // Command Feedback`**: the code, two slashes, then the plain title.

| DEPT | Issuing department | FUNC | Function |
| --- | --- | --- | --- |
| CORP | The corporation's own records | OPS | operations |
| ISA | Interstellar Settlement Authority | FIN | finance |
| STA | Station Administration | RND | research |
| GEX | Galactic Exchange (GEX Commodities Authority) | EXE | executive programs |
| CGL | The conglomerate's register | IND | industry and refining |
| EA | Earth Assembly | MKT | markets |
| ITC | Interplanetary Trade Commission | MIL | military |
| GAC | Galactic Arbitration Council | AST, LOG, COM | assets, logistics, communications |
| SDSD | Solar Defense & Security Directorate | CON, NAV, TRN | contracts, navigation and charts, transit |
| | | REG, ADM, LAW | registration, administration, law and rulings |

The departments are the factions `data/buildings.json` already names (ISA, EA, ITC, GAC, SDSD, STA), plus CORP, GEX
and CGL. Each screen belongs to the office that would issue it:
- the corporation's own books are CORP;
- the Starmap is the ISA's charts (ISA-NAV);
- the Exchange is GEX's (GEX-MKT);
- the Station is Station Administration's (STA-OPS);
- the contract board is the ISA's (ISA-CON);
- signing in and registering is the ISA's registry (ISA-REG).

**The registry has 24 screens and 43 sections**:
- the 17 tabs of the game;
- the 7 signed-out pages;
- every titled section inside a tab in `public/index.html`.

A section counts when it has a title: its `aria-labelledby` target, or its own first heading. Twelve titled sections had
no id, and this item gave them one (ids only; nothing visible changes).

**The rules:**
- **Codes are permanent.** A section that goes away has its code moved to `retired`, and the code is never reused. A new
  section takes the next free number in its pair. Renumbering would break every reference a player or a support
  thread has made.
- **The registry is the only source.** A view that draws a titled section at run time (Conglomerate, Assets,
  Logistics, Chat, Forums, Inbox, Starmap and Travel draw theirs in JavaScript) takes its code from the registry. It
  never writes one inline. ISP-248 adds those sections as it applies the header, and extends the test to them.
- **One code per section**, not per card or row. Records get reference numbers instead (below).

## Status vocabulary

The plain word is what a badge or a status line says. The protocol phrase is what the record's document says: a
receipt, a notice, the secondary line under a status. They always appear together, plain first.

| Plain | Protocol | When | Example |
| --- | --- | --- | --- |
| **Pending** | FILED, AWAITING REVIEW | Submitted; someone else decides, or a time must pass | Concession petition: **Pending**. *Filed, awaiting review; decided 2147-09-30 11:00 UTC.* |
| **Queued** | LODGED | Waiting its turn behind another item | Research: **Queued**. *Lodged; begins when Actinide Handling completes.* |
| **Active** | IN FORCE | Running now, or in effect | Patent on Antimatter Confinement: **Active**. *In force until 2147-10-25 12:00 UTC.* |
| **Complete** | CONCLUDED | Finished as intended | Contract: **Complete**. *Concluded; 400 Silicates delivered, 12,000 credits paid.* |
| **Failed** | UNSUCCESSFUL | Ran, did not achieve its end | Raid on Kestrel Holdings: **Failed**. *Unsuccessful; the garrison held.* |
| **Expired** | LAPSED | Its time ran out before it was used or renewed | Buy order: **Expired**. *Lapsed at 2147-09-29 00:00 UTC; 3,000 credits released.* |
| **Refused** | DENIED | The request was not accepted; nothing changed | Patent filing: **Refused**. *Denied: another corporation completed it first.* |
| **Insufficient funds** | UNFUNDED, BALANCE INSUFFICIENT | Refused only for want of credits | Listing fee: **Insufficient funds**. *Unfunded: 5,000 credits required, 3,120 held.* |
| **Cancelled** | WITHDRAWN | Stopped by the one who started it | Sell order: **Cancelled**. *Withdrawn; 200 Nickel returned to Earth Station Prime.* |
| **Suspended** | SUSPENDED | In effect, but its benefits are paused | Concession: **Suspended**. *Suspended; upkeep unpaid, grace ends 2147-10-04.* |
| **Owed** | IN ARREARS | A debt standing against the corporation | Royalty to Helios Freight: **Owed**. *In arrears: 181 credits, withheld from sales at 50%.* |

**How a refusal reads.** The plain reason stays the message, as today ("Your corporation has not completed this, so it
cannot patent it."). A protocol line may frame it ("DENIED // Corporate Registry & Charters"), never replace it.
**Colour and icons follow the meaning, not the word.** "Denied" gets the same token "Refused" has, and there is no new
alarm colour for the tone.

## Timestamps

**Format: `YYYY-MM-DD HH:MM UTC`**, for example **2147-03-14 09:42 UTC**. Always in UTC, always with "UTC" written,
24-hour, never a weekday.
- The date is left out only when it is today's: **09:42 UTC**.
- A deadline within a day also says how far away it is: **in 1 h 55 min (2147-09-27 11:55 UTC)**.

**The in-fiction year replaces the real one, offset +121 years.** The world is 2147 (LORE.md), and the header already
says "Est. 2147". 2026 + 121 = 2147, so today is 2147 in the game, and the year advances with the real one.
- Only the year is relabelled: month, day, hour and minute are the real UTC instant.
- A player coordinating a raid or a tariff notice with someone outside the game reads the same day and hour.
- The dates are relabelled, not recomputed. A 29 February in a real leap year is shown in its in-fiction year even
  where the Gregorian rule would have none (the ISA Standard Calendar keeps the real one's days). That is also why
  weekdays are never shown: the 2147 weekday of a date is not the real one.
- Machines get the real instant. Every displayed time is a `<time datetime="…Z">` with the real ISO 8601 timestamp, so
  copying, sorting and assistive technology see the truth.

**Where the real year stays.** Anything outside the fiction:
- account and security emails (verification, password reset and their expiry);
- the game's version and release notes;
- legal text;
- anything a player might reconcile with a bank or a calendar.

## Reference numbers

**Format: `TYPE-YYYY-XXXXXX`.**
- `TYPE` is three letters (below).
- `YYYY` is the in-fiction year of issue.
- `XXXXXX` is six characters of Crockford base-32 derived from the record's own id, so a record's reference never
  changes, is the same wherever it is shown, and never exposes an account id. Crockford's alphabet has no I, L, O or
  U, so a reference read aloud or retyped is not misread.

For example: **PAT-2147-7K3Q9A**.

**A record carries one when someone may refer back to it**: a later screen, the other party, the Arbitration Council,
or support.

| TYPE | Record | TYPE | Record |
| --- | --- | --- | --- |
| LIC | the corporation's ISA licence (today "ISP-2147-…-AUTH") | LOA | a loan |
| LSE | a mining lease | BND | a bond series |
| CON | an ISA contract | SHR | a share offering |
| MPR | a mining probe return (today "MPR-SOL-…") | PAT | a patent |
| RCP | a trade receipt: a sale, a purchase, a filled order | CSN | a concession |
| RAD | a raid and its battle report | ARB | an arbitration case |
| ITC | an ITC dumping finding | LOB | a lobbying campaign |

Not a record: a notification, a chat message, a price. They cite a record's reference instead. The two formats in the
build today (LIC's and MPR's) move to this one in ISP-249. The old references stay readable in mail already sent.

## Accessibility

- **A code is secondary visual text.** The accessible name of every section is its plain title. The header's
  `aria-labelledby` points at the title element alone. The code sits in its own element marked `aria-hidden="true"`,
  and the two slashes with it.
- **A code never carries meaning alone.** It is never the only label of a control, a link or a status, and never the
  only thing in a message.
- **It is read as text, not decoration**, so it meets the same floors: the caption token's contrast, and on a phone
  the 14px floor the screen specs measure (`e2e/*.spec.js`, "text under 14px").
- **Protocol phrases and in-fiction years are visible text beside the plain ones**, so a screen reader hears both, plain
  first. An abbreviation a phrase uses (UTC) is spelled out once per page in an `<abbr title>`.

## What builds it

| Story | What it takes from this guide |
| --- | --- |
| ISP-248, AB#944 | The section header component (`CODE // Title`, the code `aria-hidden`) on the design system, applied to every registered screen and section; the run-time sections added to the registry and the test |
| ISP-249, AB#945 | One time formatter (the format, the +121 offset, `<time datetime>`) for every timestamp; reference numbers on the records in the table, and LIC and MPR moved to the format |
| ISP-245, AB#941 (v1.0-01) | The screenshot inventory this item assumed. It did not exist yet, so the registry is derived from the page itself, and the test keeps it complete as the page changes |

## For the Board and the PM

- **The in-fiction year** (+121, only the year relabelled) is a veto point. The alternative is the real year with
  "Est. 2147" as flavour only. Relabelling was chosen because the header and landing already speak 2147, and a 2026
  date beside "Est. 2147" reads like a mistake.
- **The protocol phrases** are placeholders in tone. Changing a phrase is one row here and one string in ISP-249; the
  plain words are the contract.
