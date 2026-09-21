import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// AB#576: the Galactic Exchange shipped an empty "Mercenary Rentals" card, fed from market.mercenaryContracts, which
// nothing on the server writes. A guard on text, not on behaviour: it fails if the dead panel is written back in.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the Galactic Exchange ships no mercenary placeholder (AB#576)", () => {
  it("has no Mercenary Rentals card in index.html", () => {
    const html = read("public/index.html");
    expect(html).not.toMatch(/Mercenary Rentals/);
    expect(html).not.toMatch(/id="mercenary-book"/);
  });

  it("does not render or default mercenaryContracts in app.js", () => {
    expect(read("public/scripts/app.js")).not.toMatch(/mercenar/i);
  });

  it("and the server never wrote the list the panel read", () => {
    for (const f of ["server/index.js", "server/gameState.js"]) expect(read(f)).not.toMatch(/mercenaryContracts/);
  });
});
