import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";

// Bug #4850: miningTick and financialSnapshotTick skip the passes their mutators cannot have given anything to do.
// miningTick still evaluates the level, because what it mines moves it; this holds it to that.
let mod;
beforeAll(async () => { mod = await getApp(); });

describe("the tickers' fixed cost (Bug #4850)", () => {
  it("miningTick raises the level when what was mined completes it", async () => {
    const { account } = await registerAccount(mod.app);
    // written straight to the store, so no mutation has evaluated the level yet: level 1 met, level 2 met but unclaimed
    const corp = accountsStore.accounts[account.id].state.corp;
    Object.assign(corp, { level: 1, employeeCount: 5, offices: [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 86_400_000 }] });
    corp.miningLeases = [{ id: "lease-1", body: "Earth", buildingSlots: 2, extractorIds: ["ex-1"] }];
    corp.buildings = [...(corp.buildings || []), { id: "b-yard", name: "Basic Extractor Yard", tier: 1 }];
    corp.mining.silicateExtractors = [{ id: "ex-1", buildingId: "b-yard", leaseId: "lease-1", active: false, minedByItem: { Silicates: 300 }, totalMined: 300 }];
    expect(corp.level).toBe(1);
    mod.miningTick();
    // read as stored: getAccountById evaluates the level itself, and would hide a ticker that stopped doing it
    expect(accountsStore.accounts[account.id].state.corp.level).toBeGreaterThanOrEqual(2);
  });

  it("financialSnapshotTick still takes its snapshot and rates the corporation", async () => {
    const { account } = await registerAccount(mod.app);
    const before = (accountsStore.accounts[account.id].state.corp.finances.snapshots || []).length;
    mod.financialSnapshotTick();
    const corp = accountsStore.accounts[account.id].state.corp;
    expect(corp.finances.snapshots.length).toBe(before + 1);
    expect(corp.creditRating).toBeTruthy();
  });
});
