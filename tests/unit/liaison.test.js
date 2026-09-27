import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { ASSIGNED_COORDINATOR, COORDINATOR_BYLINE, welcomeLetter } from "../../public/scripts/liaison.js";

// AB#585: the game had two ISA officers named Voss. The Board kept Elara and removed Aria.
describe("the assigned coordinator (AB#585)", () => {
  it("is Elara Voss, Senior Logistics Coordinator, with her existing portrait", () => {
    expect(ASSIGNED_COORDINATOR).toMatchObject({ id: "elara-voss", name: "Elara Voss", title: "Senior Logistics Coordinator" });
    expect(COORDINATOR_BYLINE).toBe("Elara Voss, Senior Logistics Coordinator");
    expect(() => readFileSync(new URL(`../../public${ASSIGNED_COORDINATOR.portrait}`, import.meta.url))).not.toThrow();
  });

  it("signs the welcome letter with her one title and says the Bureau assigned her", () => {
    const letter = welcomeLetter("Orison Minerals", "LIC-2147-7K3Q9A"); // ISP-249 (AB#945): the licence's reference, never the account id
    expect(letter.subject).toBe("ISA Settlement Licence — Ref. LIC-2147-7K3Q9A");
    expect(letter.body.startsWith("To the registered CEO of Orison Minerals,")).toBe(true);
    expect(letter.body).toContain("assigns every newly chartered corporation a coordinator. I have been assigned to yours.");
    expect(letter.body.trimEnd().endsWith(`Elara Voss\nSenior Logistics Coordinator\nInterstellar Settlement Authority — Earth Station Prime`)).toBe(true);
    expect(letter.body).toContain("Founding Charter Ref: LIC-2147-7K3Q9A");
  });

  // A guard on text, not on behaviour: it fails if the removed name is written back into shipped source.
  it("leaves no reference to Aria Voss in server or client source", () => {
    const hits = [];
    for (const dir of ["server", "public/scripts"]) {
      const walk = (rel) => {
        for (const entry of readdirSync(new URL(`../../${rel}`, import.meta.url), { withFileTypes: true })) {
          const path = `${rel}/${entry.name}`;
          if (entry.isDirectory()) walk(path);
          else if (/\.(js|html)$/.test(entry.name) && /aria voss/i.test(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"))) hits.push(path);
        }
      };
      walk(dir);
    }
    if (/aria voss/i.test(readFileSync(new URL("../../public/index.html", import.meta.url), "utf8"))) hits.push("public/index.html");
    expect(hits).toEqual([]);
  });
});
