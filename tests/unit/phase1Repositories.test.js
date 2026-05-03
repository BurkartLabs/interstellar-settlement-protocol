import { describe, it, expect } from "vitest";
import {
  mapAccountToCorpRow,
  mapAccountToFinanceRow,
  mapAccountToMilitaryRow,
  mapAccountToUnlocksRow,
  mapAccountToMarketSectorRows,
  mapAccountToUnlockedTechRows,
  mapAccountToMilestoneRows,
  applyCorpRowToAccount,
  applyFinanceRowToAccount,
  applyMilitaryRowToAccount,
  applyUnlocksRowToAccount,
  applyMarketSectorsToAccount,
  applyUnlockedTechToAccount,
  applyMilestonesToAccount,
  isPersistableAccount,
  persistAccountsPhase1,
  hydrateOverlayPhase1
} from "../../server/db/repositories/index.js";

function makeAccount(overrides = {}) {
  return {
    id: "user-1",
    email: "alice@example.com",
    state: {
      corp: {
        ceo: "Alice Director",
        corporationName: "Frontier Co",
        location: "Earth",
        currentStationId: "earth-station-prime",
        currentSystemId: "sol",
        level: 3,
        levelCap: 40,
        employeeCap: 12,
        employeeCount: 7,
        buildingSlots: 4,
        finances: {
          credits: 250000,
          liabilities: 1500,
          assets: 80000,
          dailyRevenue: 5000,
          dailyCosts: 2000,
          taxRatePct: 14,
          bondYieldPct: 1.5,
          exchangeSalesTaxPct: 8
        },
        military: {
          lightFighters: 4,
          destroyers: 1,
          siegeEngines: 0,
          attackValue: 120,
          defenseValue: 80,
          modifiers: { rdBonusPct: 5.5, ceoLeadershipPct: 2.25 }
        },
        unlocks: {
          marketSectors: ["energy", "logistics"],
          maxUpgradeTier: 2,
          maxFleetSize: 45,
          maxBasicExtractorYards: 3
        },
        unlockedTech: ["tt-basic-extraction", "tt-supply-forecast"],
        milestonesCompleted: ["first-contract", "first-extractor"]
      },
      playerProfile: {
        isNewPlayer: false,
        registeredAt: 1700000000000,
        walkthroughCompleted: true
      }
    },
    ...overrides
  };
}

describe("Phase 1 mappers", () => {
  it("maps corp scalars including the 1:1 corp_id == account_id rule", () => {
    const row = mapAccountToCorpRow(makeAccount());
    expect(row).toMatchObject({
      id: "user-1",
      account_id: "user-1",
      name: "Frontier Co",
      ceo_name: "Alice Director",
      level: 3,
      level_cap: 40,
      employee_cap: 12,
      employee_count: 7,
      building_slots: 4,
      current_station_id: "earth-station-prime",
      current_system_id: "sol",
      location: "Earth",
      is_new_player: false,
      registered_at: 1700000000000
    });
    expect(row.updated_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("maps finances and preserves numeric precision on tax pcts", () => {
    const row = mapAccountToFinanceRow(makeAccount());
    expect(row).toMatchObject({
      corp_id: "user-1",
      credits: 250000,
      liabilities: 1500,
      assets: 80000,
      daily_revenue: 5000,
      daily_costs: 2000,
      tax_rate_pct: 14,
      bond_yield_pct: 1.5,
      exchange_sales_tax_pct: 8,
      liquidity: 0,
      liquidity_cap: 0,
      liquidity_regen_per_hour: 0,
      last_liquidity_tick: null
    });
  });

  it("maps military including the nested modifiers sub-object", () => {
    const row = mapAccountToMilitaryRow(makeAccount());
    expect(row).toEqual({
      corp_id: "user-1",
      light_fighters: 4,
      destroyers: 1,
      siege_engines: 0,
      attack_value: 120,
      defense_value: 80,
      rd_bonus_pct: 5.5,
      ceo_leadership_pct: 2.25
    });
  });

  it("maps scalar unlocks and skips the marketSectors array (handled by sets repo)", () => {
    const row = mapAccountToUnlocksRow(makeAccount());
    expect(row).toEqual({
      corp_id: "user-1",
      max_upgrade_tier: 2,
      max_fleet_size: 45,
      max_basic_extractor_yards: 3
    });
  });

  it("explodes string-array sets into one row per entry", () => {
    expect(mapAccountToMarketSectorRows(makeAccount())).toEqual([
      { corp_id: "user-1", sector: "energy" },
      { corp_id: "user-1", sector: "logistics" }
    ]);
    expect(mapAccountToUnlockedTechRows(makeAccount())).toEqual([
      { corp_id: "user-1", tech_id: "tt-basic-extraction", unlocked_at: null },
      { corp_id: "user-1", tech_id: "tt-supply-forecast", unlocked_at: null }
    ]);
    expect(mapAccountToMilestoneRows(makeAccount())).toEqual([
      { corp_id: "user-1", milestone: "first-contract", completed_at: null },
      { corp_id: "user-1", milestone: "first-extractor", completed_at: null }
    ]);
  });

  it("handles a sparse account without crashing", () => {
    const sparse = { id: "user-2", state: { corp: {}, playerProfile: {} } };
    expect(mapAccountToCorpRow(sparse).id).toBe("user-2");
    expect(mapAccountToFinanceRow(sparse).credits).toBe(0);
    expect(mapAccountToMilitaryRow(sparse).light_fighters).toBe(0);
    expect(mapAccountToUnlocksRow(sparse).max_upgrade_tier).toBe(1);
    expect(mapAccountToMarketSectorRows(sparse)).toEqual([]);
    expect(mapAccountToUnlockedTechRows(sparse)).toEqual([]);
    expect(mapAccountToMilestoneRows(sparse)).toEqual([]);
  });

  it("filters out non-string set entries", () => {
    const account = makeAccount();
    account.state.corp.unlockedTech = ["tt-good", "", null, 42, "tt-also-good"];
    expect(mapAccountToUnlockedTechRows(account).map((r) => r.tech_id)).toEqual([
      "tt-good",
      "tt-also-good"
    ]);
  });
});

describe("Phase 1 row → account mutators (round trip)", () => {
  it("round-trips corp + finances + military + unlocks + sets", () => {
    const source = makeAccount();
    const target = makeAccount({ id: "user-1" });
    // Wipe target so we can prove the apply* fns repopulate it.
    target.state.corp = { unlocks: {} };
    target.state.playerProfile = {};

    applyCorpRowToAccount(target, mapAccountToCorpRow(source));
    applyFinanceRowToAccount(target, mapAccountToFinanceRow(source));
    applyMilitaryRowToAccount(target, mapAccountToMilitaryRow(source));
    applyUnlocksRowToAccount(target, mapAccountToUnlocksRow(source));
    applyMarketSectorsToAccount(
      target,
      mapAccountToMarketSectorRows(source).map((r) => r.sector)
    );
    applyUnlockedTechToAccount(
      target,
      mapAccountToUnlockedTechRows(source).map((r) => r.tech_id)
    );
    applyMilestonesToAccount(
      target,
      mapAccountToMilestoneRows(source).map((r) => r.milestone)
    );

    expect(target.state.corp.corporationName).toBe("Frontier Co");
    expect(target.state.corp.ceo).toBe("Alice Director");
    expect(target.state.corp.level).toBe(3);
    expect(target.state.corp.finances.credits).toBe(250000);
    expect(target.state.corp.finances.taxRatePct).toBe(14);
    expect(target.state.corp.military.lightFighters).toBe(4);
    expect(target.state.corp.military.modifiers.rdBonusPct).toBe(5.5);
    expect(target.state.corp.unlocks.maxUpgradeTier).toBe(2);
    expect(target.state.corp.unlocks.marketSectors).toEqual(["energy", "logistics"]);
    expect(target.state.corp.unlockedTech).toEqual([
      "tt-basic-extraction",
      "tt-supply-forecast"
    ]);
    expect(target.state.corp.milestonesCompleted).toEqual([
      "first-contract",
      "first-extractor"
    ]);
    expect(target.state.playerProfile.isNewPlayer).toBe(false);
    expect(target.state.playerProfile.registeredAt).toBe(1700000000000);
  });

  it("dedupes set arrays on apply (defensive against double-rows)", () => {
    const target = makeAccount();
    applyUnlockedTechToAccount(target, ["a", "b", "a", "c", "b"]);
    expect(target.state.corp.unlockedTech).toEqual(["a", "b", "c"]);
  });
});

describe("dummy account regression", () => {
  it("isPersistableAccount() accepts the dummy account (it persists like any other)", () => {
    expect(isPersistableAccount({ id: "dummy" })).toBe(true);
    expect(isPersistableAccount({ id: "user-1" })).toBe(true);
    expect(isPersistableAccount(null)).toBe(false);
    expect(isPersistableAccount({})).toBe(false);
  });

  it("persistAccountsPhase1 is a hard no-op when normalized tables are off (test env)", async () => {
    // tests/setup.js strips SUPABASE_URL → USE_SUPABASE=false → USE_NORMALIZED_TABLES=false.
    // Verify no exception even when called with a real-looking account list.
    await expect(
      persistAccountsPhase1([makeAccount(), { id: "dummy", state: { corp: {} } }])
    ).resolves.toBeUndefined();
  });

  it("hydrateOverlayPhase1 is a hard no-op when normalized tables are off", async () => {
    const hydrated = { "user-1": makeAccount() };
    await expect(hydrateOverlayPhase1(hydrated)).resolves.toBeUndefined();
    // The account is untouched.
    expect(hydrated["user-1"].state.corp.corporationName).toBe("Frontier Co");
  });
});
