import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootFailureHtml } from "../../public/scripts/html.js";

// Bug AB#2297: when the game failed to start, app.js put the error's message into the landing as HTML, unescaped (the
// session-restore failure beside it escaped the same message). Both now draw the card through one function.
describe("the landing's failure card (Bug AB#2297)", () => {
  it("escapes a message that carries markup", () => {
    const html = bootFailureHtml("Bootstrap failed", '<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("is a design-system panel that says what failed, and something for an empty message", () => {
    expect(bootFailureHtml("Session restore failed", "")).toBe(
      '<article class="ui-panel landing__notice" role="alert"><p class="landing__lede">Session restore failed: Unknown error</p></article>'
    );
  });

  it("is what both of app.js's failure paths use, and no other card is written there", () => {
    const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
    expect((app.match(/authShell\.innerHTML = bootFailureHtml\(/g) || []).length).toBe(2);
    expect(app).not.toMatch(/authShell\.innerHTML = `/);
  });
});
