import { describe, it, expect } from "vitest";
import {
  mapAccountToBuildingRows,
  mapAccountToOfficeRows,
  mapAccountToLeaseRows,
  mapAccountToExtractorRows,
  applyInfrastructureRowsToAccount,
  persistAccountsPhase2,
  hydrateOverlayPhase2
} from "../../server/db/repositories/index.js";

function makePhase2Account(overrides = {}) {
  return {
    id: "user-42",
    state: {
      corp: {
        buildings: [
          { name: "Headquarters", tier: 1, status: "Operational" },
          {
            id: "bld-custom-1",
            stationId: "earth-station-prime",
            name: "Basic Extractor Yard",
            tier: 1,
            status: "Operational",
            builtAt: 1700000000000,
            completesAt: null
          }
        ],
        offices: [
          {
            stationId: "earth-station-prime",
            body: "Earth",
            systemId: "sol",
            name: "Earth Station Prime",
            tier: 1,
            rentedAt: 1700000000000,
            rentedUntil: 1700600000000,
            durationDays: 7
          }
        ],
        miningLeases: [
          {
            id: "lease-a",
            body: "Earth",
            leaseType: "Silicate Extraction",
            issuedAt: 1700000000000,
            cost: 20000,
            buildingSlots: 2,
            extractorIds: ["ext-a-1", "ext-a-2"]
          }
        ],
        mining: {
          silicateExtractors: [
            {
              id: "ext-a-1",
              name: "Basic Extractor Yard #1",
              tier: 1,
              active: true,
              startedAt: 1700000010000,
              lastTickAt: 1700000020000,
              endsAt: 1700003600000,
              throughputPerHour: 40,
              operationCostPerHour: 640,
              totalMined: 150,
              minedRemainder: 0.75,
              totalSpent: 2400,
              lastCompletedAt: null,
              leaseId: "lease-a",
              downtimeActive: false,
              downtimeStartedAt: null,
              downtimeRecoveredAt: null
            },
            {
              id: "ext-a-2",
              name: "Basic Extractor Yard #2",
              tier: 1,
              active: false,
              startedAt: null,
              lastTickAt: null,
              endsAt: null,
              throughputPerHour: 50,
              operationCostPerHour: 800,
              totalMined: 300,
              minedRemainder: 0.12,
              totalSpent: 5000,
              lastCompletedAt: 1700007200000,
              leaseId: "lease-a",
              downtimeActive: true,
              downtimeStartedAt: 1700007100000,
              downtimeRecoveredAt: null
            }
          ]
        }
      }
    },
    ...overrides
  };
}

describe("Phase 2 mappers", () => {
  it("maps buildings with stable IDs and keeps existing IDs", () => {
    const rows = mapAccountToBuildingRows(makePhase2Account());
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("user-42::bld-user-42-1");
    expect(rows[1].id).toBe("user-42::bld-custom-1");
    expect(rows[1].station_id).toBe("earth-station-prime");
  });

  it("maps offices/leases/extractors to DB column naming", () => {
    const account = makePhase2Account();

    const officeRows = mapAccountToOfficeRows(account);
    expect(officeRows[0]).toMatchObject({
      corp_id: "user-42",
      station_id: "earth-station-prime",
      rented_at: 1700000000000,
      rented_until: 1700600000000,
      duration_days: 7
    });

    const leaseRows = mapAccountToLeaseRows(account);
    expect(leaseRows[0]).toMatchObject({
      id: "user-42::lease-a",
      corp_id: "user-42",
      body: "Earth",
      lease_type: "Silicate Extraction",
      building_slots: 2
    });

    const extractorRows = mapAccountToExtractorRows(account);
    expect(extractorRows[0]).toMatchObject({
      id: "user-42::ext-a-1",
      corp_id: "user-42",
      lease_id: "user-42::lease-a",
      throughput_per_hour: 40,
      mined_remainder: 0.75,
      downtime_active: false
    });
  });

  it("returns empty arrays for sparse accounts", () => {
    const sparse = { id: "x", state: { corp: { mining: {} } } };
    expect(mapAccountToBuildingRows(sparse)).toEqual([]);
    expect(mapAccountToOfficeRows(sparse)).toEqual([]);
    expect(mapAccountToLeaseRows(sparse)).toEqual([]);
    expect(mapAccountToExtractorRows(sparse)).toEqual([]);
  });
});

describe("Phase 2 row -> account apply", () => {
  it("rebuilds corp arrays and lease.extractorIds from extractor rows", () => {
    const account = { id: "user-42", state: { corp: {} } };
    applyInfrastructureRowsToAccount(account, {
      buildings: [
        { id: "b1", station_id: null, name: "HQ", tier: 1, status: "Operational", built_at: null, completes_at: null }
      ],
      offices: [
        {
          id: "o1",
          station_id: "earth-station-prime",
          body: "Earth",
          system_id: "sol",
          name: "Earth Station Prime",
          tier: 1,
          rented_at: 1,
          rented_until: 2,
          duration_days: 7
        }
      ],
      leases: [
        {
          id: "lease-a",
          body: "Earth",
          lease_type: "Silicate Extraction",
          cost: 20000,
          building_slots: 2,
          issued_at: 3,
          expires_at: null
        }
      ],
      extractors: [
        {
          id: "ext-a-1",
          lease_id: "lease-a",
          name: "Extractor A",
          tier: 1,
          active: false,
          started_at: null,
          last_tick_at: null,
          ends_at: null,
          last_completed_at: null,
          throughput_per_hour: 40,
          operation_cost_per_hour: 640,
          total_mined: 10,
          total_spent: 20,
          mined_remainder: 0.5,
          downtime_active: false,
          downtime_started_at: null,
          downtime_recovered_at: null
        }
      ]
    });

    expect(account.state.corp.buildings).toHaveLength(1);
    expect(account.state.corp.offices).toHaveLength(1);
    expect(account.state.corp.miningLeases).toHaveLength(1);
    expect(account.state.corp.miningLeases[0].extractorIds).toEqual(["ext-a-1"]);
    expect(account.state.corp.mining.silicateExtractors[0].minedRemainder).toBe(0.5);
    expect(account.state.corp.mining.silicateExtractor.id).toBe("ext-a-1");
  });
});

describe("Phase 2 feature-flag no-ops (test env)", () => {
  it("persistAccountsPhase2 resolves without side effects when normalized flag is off", async () => {
    await expect(persistAccountsPhase2([makePhase2Account()])).resolves.toBeUndefined();
  });

  it("hydrateOverlayPhase2 resolves without side effects when normalized flag is off", async () => {
    const hydrated = { "user-42": makePhase2Account() };
    await expect(hydrateOverlayPhase2(hydrated)).resolves.toBeUndefined();
    expect(hydrated["user-42"].state.corp.buildings).toHaveLength(2);
  });
});
