import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { serverCodeFiles } from "../helpers/serverSource.js";
import { clientCode } from "../helpers/clientSource.js";

// AB#576: the Galactic Exchange shipped an empty "Mercenary Rentals" card, fed from market.mercenaryContracts, which
// nothing on the server writes. A guard on text, not on behaviour: it fails if the dead panel is written back in.
// ISP-177 (AB#871) ships the real Mercenary Rentals panel, fed by the mercenary routes (server/mercenaries.js), so the
// guard is now on the dead list and the dead panel's id, and on the real panel reading the real routes.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the Galactic Exchange ships no mercenary placeholder (AB#576)", () => {
  it("has no dead Mercenary Rentals card in index.html; the real one is ISP-177's", () => {
    const html = read("public/index.html");
    expect(html).not.toMatch(/id="mercenary-book"/);
    expect(html.match(/<h3[^>]*>Mercenary Rentals<\/h3>/g)).toHaveLength(1);
    expect(html).toContain('id="exchange-mercenary-section"');
  });

  it("does not render or default mercenaryContracts in the client, and reads the real routes instead", () => {
    const code = clientCode(); // AB#739: app.js and every module it loads
    expect(code).not.toMatch(/mercenaryContracts/);
    expect(code).toContain("/gameplay/mercenaries");
  });

  it("and the server never wrote the list the panel read", () => {
    // AB#1815: server/index.js and every module it was split into.
    for (const f of [...serverCodeFiles(), "server/gameState.js"]) expect(read(f), f).not.toMatch(/mercenaryContracts/);
  });
});
