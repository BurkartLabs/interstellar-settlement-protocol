import { describe, it, expect } from "vitest";
import { validateCorporationName, CORPORATION_NAME_MAX_LENGTH, CORPORATION_NAME_MIN_LENGTH } from "../../server/corporationName.js";

// Bug #433: the corporation name is the only trust signal on the order book, in trade history, on the forums and in
// mail, and it was never checked. It is now validated when the corporation is created.
const ok = (raw, opts) => validateCorporationName(raw, { existingNames: [], reservedNames: [], ...opts });

describe("validateCorporationName (Bug #433)", () => {
  it("keeps a good name, trimmed with runs of spaces collapsed", () => {
    expect(CORPORATION_NAME_MIN_LENGTH).toBe(3);
    expect(CORPORATION_NAME_MAX_LENGTH).toBe(40);
    expect(ok("Frontier Protocol Ventures")).toEqual({ name: "Frontier Protocol Ventures" });
    expect(ok("  Frontier   Protocol \t Ventures ")).toEqual({ name: "Frontier Protocol Ventures" });
    expect(ok("O'Neill & Sons Mining Co.")).toEqual({ name: "O'Neill & Sons Mining Co." });
    expect(ok("Belt-Runner 9")).toEqual({ name: "Belt-Runner 9" });
  });

  it("requires a name, of 3 to 40 characters", () => {
    for (const raw of [undefined, null, "", "   "]) expect(ok(raw).error, String(raw)).toBe("A corporation name is required.");
    expect(ok("ab").error).toBe("A corporation name must be 3 to 40 characters.");
    expect(ok("x".repeat(41)).error).toBe("A corporation name must be 3 to 40 characters.");
    expect(ok("x".repeat(40)).name).toBe("x".repeat(40));
  });

  it("allows letters, digits, spaces and - ' . & only, so look-alike letters cannot pass for a real name", () => {
    for (const raw of ["<img src=x>", "Corp™", "Best_Corp", "Corp\u0000Name", "G\u0415X Commodities Authority", "Ünter Holdings"]) {
      expect(ok(raw).error, raw).toBe("A corporation name may use letters, digits, spaces and - ' . & only.");
    }
  });

  it("refuses a name another corporation has, ignoring case and spacing", () => {
    expect(ok("frontier  PROTOCOL ventures", { existingNames: ["Frontier Protocol Ventures"] }).error).toBe("A corporation with this name already exists.");
  });

  it("refuses a reserved name, or one containing it as whole words, and nothing more", () => {
    const reservedNames = ["GEX Commodities Authority", "ISA System"];
    expect(ok("GEX Commodities Authority", { reservedNames }).error).toBe("That name belongs to an institution in the game; choose another.");
    expect(ok("gex commodities authority holdings", { reservedNames }).error).toBe("That name belongs to an institution in the game; choose another.");
    expect(ok("The ISA  System Office", { reservedNames }).error).toBe("That name belongs to an institution in the game; choose another.");
    expect(ok("Visa Systems Inc", { reservedNames }).name).toBe("Visa Systems Inc");
  });
});
