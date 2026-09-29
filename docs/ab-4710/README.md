# AB#4710: the Exchange's standing buy orders, short by default

**The proposal, built for the Board to veto:** with All picked (and no tier), Standing buy orders lists the buyers for
what the corporation holds at the station it is docked at. Under the table it says "Showing the N buyers for what you
hold at {station}" or "You hold nothing these buyers want at {station}", and gives one control:

- **Show all N buyers** lists every buyer, in the chosen sort;
- **Show only what you hold here** cuts them back.

A resource or tier filter lists every order it leaves, held or not, as before. The alternative the item named, tier
sub-tabs, was not built.

## Measured

The seeded industry corporation (e2e/seed-industry-account.mjs, the one e2e/scroll-audit.spec.js uses) holds Silicates
and Nickel at Earth Station Prime. The page is Standing orders with All picked.

| Viewport | Screens before | Screens after | Standing buy rows shown |
|---|---:|---:|---|
| 1440x900 | 5.05 | **1.95** | 49 → 2 |
| 1280x800 | 7.17 | 2.25 | 49 → 2 |
| 375x812 | 25.7 | 5.89 | 49 → 2 |

- **Show all** lists all 49 buyers and cuts back to 2 again.
- **The Titanium filter** (not held) still lists Titanium's buyer.
- **The Silicates buyer** is on the page with no extra step, because the first hour's Silicates are held when they are sold.
- **At 375** most of the remaining length is the six standing *sell* orders, each drawn as a tall card (2,067px). That is filed as #4870.

## Screenshots

- `page-before-1440x900.png` and `page-after-1440x900.png`: the whole page.
- `page-after-1280x800.png`: the whole page at 1280.
- `standing-buy-default-1280x800.png` and `standing-buy-default-375x812.png`: the table as it opens, with the note and the control.
- `standing-buy-show-all-1280x800.png`: after Show all.
