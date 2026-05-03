import { describe, it, expect } from "vitest";
import { mergeDummyAccount } from "../../server/gameState.js";

describe("mergeDummyAccount", () => {
  it("re-attaches the dummy account to a hydrated store that lacks one", () => {
    const fallback = {
      accounts: {
        dummy: { id: "dummy", email: "dummy@isp.local", state: { tag: "fallback-dummy" } }
      }
    };
    const hydrated = {
      accounts: {
        "user-1": { id: "user-1", email: "alice@example.com", state: { tag: "real-user" } }
      }
    };
    const merged = mergeDummyAccount(hydrated, fallback);
    expect(merged.accounts["user-1"]).toBeDefined();
    expect(merged.accounts.dummy).toBeDefined();
    expect(merged.accounts.dummy.state.tag).toBe("fallback-dummy");
  });

  it("does not overwrite an existing dummy account in the hydrated store", () => {
    const fallback = {
      accounts: { dummy: { id: "dummy", state: { tag: "fallback" } } }
    };
    const hydrated = {
      accounts: { dummy: { id: "dummy", state: { tag: "hydrated" } } }
    };
    const merged = mergeDummyAccount(hydrated, fallback);
    expect(merged.accounts.dummy.state.tag).toBe("hydrated");
  });

  it("is a no-op when the fallback has no dummy account", () => {
    const fallback = { accounts: {} };
    const hydrated = { accounts: { "user-1": { id: "user-1" } } };
    const merged = mergeDummyAccount(hydrated, fallback);
    expect(Object.keys(merged.accounts)).toEqual(["user-1"]);
  });

  it("returns the same hydrated store reference (mutates in place)", () => {
    const fallback = { accounts: { dummy: { id: "dummy" } } };
    const hydrated = { accounts: {} };
    const merged = mergeDummyAccount(hydrated, fallback);
    expect(merged).toBe(hydrated);
  });
});
