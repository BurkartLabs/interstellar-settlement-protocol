import { describe, it, expect } from "vitest";
import { summarize } from "../../scripts/csp-audit.mjs";

// AB#959: the CSP audit's count, grouped so a report names what to fix rather than listing every page load.
describe("csp-audit summarize (AB#959)", () => {
  it("counts nothing in an empty report", () => {
    expect(summarize("")).toEqual({ total: 0, groups: [] });
  });

  it("groups by directive and blocked resource, most frequent first, and skips unreadable lines", () => {
    const line = (o) => JSON.stringify(o);
    const text = [
      line({ page: "http://127.0.0.1:1/?account=a", directive: "img-src", blocked: "https://x.test/a.png" }),
      line({ page: "http://127.0.0.1:1/login.html", directive: "script-src-elem", blocked: "inline", source: "http://127.0.0.1:1/scripts/app.js", line: 3 }),
      "not json",
      line({ page: "http://127.0.0.1:2/", directive: "script-src-elem", blocked: "inline", source: "http://127.0.0.1:2/scripts/app.js", line: 3 })
    ].join("\n");
    const { total, groups } = summarize(text);
    expect(total).toBe(3);
    expect(groups.map((g) => [g.key, g.count])).toEqual([["script-src-elem blocked inline", 2], ["img-src blocked https://x.test/a.png", 1]]);
    expect([...groups[0].pages]).toEqual(["/login.html", "/"]);
    expect([...groups[0].sources]).toEqual(["/scripts/app.js:3"]);
  });
});
