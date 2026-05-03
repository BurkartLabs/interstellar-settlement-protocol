import { describe, it, expect } from "vitest";
import {
  mapAccountToRefineryRows,
  mapAccountToAsteroidCoreRow,
  mapAccountToProbeFabricationRows,
  mapAccountToExpeditionRows,
  mapAccountToExpeditionYieldRows,
  mapAccountToScoutedBeltRows,
  mapAccountToInventoryRows,
  mapAccountToTradeHistoryRows,
  mapAccountToActiveMissionRows,
  mapAccountToCompletedMissionRows,
  mapAccountToAgentReputationRows,
  mapAccountToContractOfferingRow,
  mapAccountToContractOfferingMissionRows,
  mapAccountToRdQueueRows,
  mapAccountToInsightQueueRows,
  mapAccountToCompletedInsightRows,
  mapAccountToNotificationRows,
  mapAccountToMessageRows,
  applyOperationsRowsToAccount,
  persistAccountsPhase3,
  hydrateOverlayPhase3
} from "../../server/db/repositories/index.js";

function makePhase3Account(overrides = {}) {
  return {
    id: "user-73",
    notifications: [
      {
        id: "ntf-1",
        accountId: "user-73",
        type: "system",
        title: "Welcome",
        body: "Boot complete",
        createdAt: 1700000001000,
        readAt: null
      }
    ],
    messages: [
      {
        id: "msg-1",
        fromType: "system",
        fromId: "system",
        fromName: "ISA System",
        toAccountId: "user-73",
        toCorpName: "Helix Frontier",
        toName: "Helix Frontier",
        subject: "Initial Brief",
        body: "Proceed to Earth Station Prime.",
        sentAt: 1700000002000,
        readAt: null,
        folder: "inbox",
        trashedAt: null
      }
    ],
    state: {
      corp: {
        refineries: [
          {
            id: "ref-7",
            name: "Refinery #7",
            tier: 2,
            active: true,
            chainId: "ref-basic",
            startedAt: 1700000000000,
            lastTickAt: 1700000100000,
            endsAt: 1700000600000,
            cyclesCompleted: 2,
            totalInputConsumed: 600,
            totalOutputProduced: 420
          }
        ],
        asteroidMining: {
          probeCount: 1,
          maxProbes: 4,
          maxDeployments: 2,
          fabricationQueue: [
            { id: "fab-1", startedAt: 1700000000000, completesAt: 1700000300000, status: "in_progress" }
          ],
          activeExpeditions: [
            {
              id: "exp-a",
              beltKey: "sol:belt",
              systemId: "sol",
              duration: "standard",
              deployedAt: 1700000000000,
              completesAt: 1700001000000,
              lastTickAt: 1700000100000,
              launchCost: 3000,
              status: "active",
              yields: { Silicates: 90, Nickel: 15 }
            }
          ],
          completedExpeditions: [
            {
              id: "exp-b",
              beltKey: "sol:belt",
              systemId: "sol",
              duration: "short",
              deployedAt: 1699999000000,
              completesAt: 1699999600000,
              lastTickAt: 1699999600000,
              launchCost: 3000,
              status: "completed",
              completedAt: 1699999600000,
              depositStationId: "earth-station-prime",
              yields: { Carbon: 20 }
            }
          ],
          scoutedBelts: ["sol:belt", { beltKey: "alpha-centauri:ac-belt", scoutedAt: 1700000500000 }]
        },
        inventory: {
          "earth-station-prime": { Silicates: 120, Nickel: 40 },
          "luna-trade-hub": { Carbon: 55 }
        },
        tradeHistory: [
          {
            id: "trade-1",
            type: "sell",
            item: "Silicates",
            quantity: 100,
            unitPrice: 24,
            total: 2400,
            counterparty: "GEX",
            at: 1700000200000
          }
        ],
        activeMissions: [
          {
            id: "ms-log-001",
            missionTemplateId: "ms-log-001",
            acceptedAt: 1700000000000,
            expiresAt: 1700100000000,
            progressQuantity: 150,
            status: "active"
          }
        ],
        completedMissions: [
          {
            id: "ms-log-002",
            missionTemplateId: "ms-log-002",
            title: "Nickel Freight Manifest",
            type: "Logistics",
            agentId: "elara-voss",
            reward: "15,000 Credits",
            completedAt: 1699999900000
          }
        ],
        agentReputation: {
          "elara-voss": { completedCount: 2, standing: 1.5 }
        },
        contractOfferings: {
          nextRefreshAt: 1700005000000,
          missions: [{ id: "ms-log-003" }, { id: "ms-log-004" }]
        },
        completedInsights: ["ceo-negotiation-fundamentals", "ceo-negotiation-fundamentals", "ceo-charter-ops"]
      },
      queues: {
        corporateRnD: [
          {
            id: "rnd-1",
            nodeId: "tt-basic-extraction",
            position: 0,
            status: "in_progress",
            queuedAt: 1700000000000,
            startedAt: 1700000100000,
            completesAt: 1700000800000
          }
        ],
        ceoInsight: [
          {
            id: "insight-1",
            nodeId: "ceo-negotiation-fundamentals",
            position: 0,
            status: "queued",
            queuedAt: 1700000200000,
            startedAt: null,
            completesAt: null
          }
        ]
      }
    },
    ...overrides
  };
}

describe("Phase 3 mappers", () => {
  it("maps operational and account rows for all remaining domains", () => {
    const account = makePhase3Account();

    expect(mapAccountToRefineryRows(account)[0]).toMatchObject({
      id: "ref-7",
      corp_id: "user-73",
      chain_id: "ref-basic",
      total_output_produced: 420
    });

    expect(mapAccountToAsteroidCoreRow(account)).toEqual({
      corp_id: "user-73",
      probe_count: 1,
      max_probes: 4,
      max_deployments: 2
    });

    expect(mapAccountToProbeFabricationRows(account)[0]).toMatchObject({
      id: "fab-1",
      status: "in_progress"
    });

    const expeditionRows = mapAccountToExpeditionRows(account);
    expect(expeditionRows).toHaveLength(2);
    expect(expeditionRows.find((r) => r.id === "exp-b")).toMatchObject({
      status: "completed",
      deposit_station_id: "earth-station-prime"
    });

    const yieldRows = mapAccountToExpeditionYieldRows(account);
    expect(yieldRows).toEqual(
      expect.arrayContaining([
        { expedition_id: "exp-a", resource: "Silicates", quantity: 90 },
        { expedition_id: "exp-b", resource: "Carbon", quantity: 20 }
      ])
    );

    expect(mapAccountToScoutedBeltRows(account)).toEqual(
      expect.arrayContaining([
        { corp_id: "user-73", belt_key: "sol:belt", scouted_at: null },
        { corp_id: "user-73", belt_key: "alpha-centauri:ac-belt", scouted_at: 1700000500000 }
      ])
    );

    expect(mapAccountToInventoryRows(account)).toEqual(
      expect.arrayContaining([
        { corp_id: "user-73", station_id: "earth-station-prime", item: "Silicates", quantity: 120 },
        { corp_id: "user-73", station_id: "luna-trade-hub", item: "Carbon", quantity: 55 }
      ])
    );

    expect(mapAccountToTradeHistoryRows(account)[0]).toMatchObject({
      id: "trade-1",
      item: "Silicates",
      total: 2400
    });

    expect(mapAccountToActiveMissionRows(account)[0]).toMatchObject({
      id: "ms-log-001",
      mission_template_id: "ms-log-001"
    });

    expect(mapAccountToCompletedMissionRows(account)[0]).toMatchObject({
      mission_template_id: "ms-log-002",
      completed_at: 1699999900000
    });

    expect(mapAccountToAgentReputationRows(account)[0]).toEqual({
      corp_id: "user-73",
      agent_id: "elara-voss",
      completed_count: 2,
      standing: 1.5
    });

    expect(mapAccountToContractOfferingRow(account)).toEqual({
      corp_id: "user-73",
      next_refresh_at: 1700005000000
    });

    expect(mapAccountToContractOfferingMissionRows(account)).toEqual([
      { corp_id: "user-73", slot: 0, mission_template_id: "ms-log-003" },
      { corp_id: "user-73", slot: 1, mission_template_id: "ms-log-004" }
    ]);

    expect(mapAccountToRdQueueRows(account)[0]).toMatchObject({
      corp_id: "user-73",
      node_id: "tt-basic-extraction",
      status: "in_progress",
      started_at: 1700000100000,
      completes_at: 1700000800000
    });

    expect(mapAccountToInsightQueueRows(account)[0]).toMatchObject({
      corp_id: "user-73",
      node_id: "ceo-negotiation-fundamentals",
      status: "queued"
    });

    expect(mapAccountToCompletedInsightRows(account)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ corp_id: "user-73", program_id: "ceo-negotiation-fundamentals", level: 2 }),
        expect.objectContaining({ corp_id: "user-73", program_id: "ceo-charter-ops", level: 1 })
      ])
    );

    expect(mapAccountToNotificationRows(account)[0]).toMatchObject({
      id: "ntf-1",
      account_id: "user-73",
      title: "Welcome"
    });

    expect(mapAccountToMessageRows(account)[0]).toMatchObject({
      id: "msg-1",
      account_id: "user-73",
      subject: "Initial Brief",
      folder: "inbox"
    });
  });

  it("returns empty collections for sparse accounts", () => {
    const sparse = { id: "x", state: { corp: {}, queues: {} }, notifications: [], messages: [] };
    expect(mapAccountToRefineryRows(sparse)).toEqual([]);
    expect(mapAccountToProbeFabricationRows(sparse)).toEqual([]);
    expect(mapAccountToExpeditionRows(sparse)).toEqual([]);
    expect(mapAccountToExpeditionYieldRows(sparse)).toEqual([]);
    expect(mapAccountToScoutedBeltRows(sparse)).toEqual([]);
    expect(mapAccountToInventoryRows(sparse)).toEqual([]);
    expect(mapAccountToTradeHistoryRows(sparse)).toEqual([]);
    expect(mapAccountToActiveMissionRows(sparse)).toEqual([]);
    expect(mapAccountToCompletedMissionRows(sparse)).toEqual([]);
    expect(mapAccountToAgentReputationRows(sparse)).toEqual([]);
    expect(mapAccountToContractOfferingMissionRows(sparse)).toEqual([]);
    expect(mapAccountToRdQueueRows(sparse)).toEqual([]);
    expect(mapAccountToInsightQueueRows(sparse)).toEqual([]);
    expect(mapAccountToCompletedInsightRows(sparse)).toEqual([]);
    expect(mapAccountToNotificationRows(sparse)).toEqual([]);
    expect(mapAccountToMessageRows(sparse)).toEqual([]);
  });
});

describe("Phase 3 row -> account apply", () => {
  it("reconstructs asteroid, inventory, missions, queues, notifications, and messages", () => {
    const account = {
      id: "user-73",
      notifications: [],
      messages: [],
      state: {
        corp: { contractOfferings: { missions: [{ id: "ms-log-003", title: "Existing" }] } },
        queues: {}
      }
    };

    applyOperationsRowsToAccount(account, {
      refineries: [
        {
          id: "ref-1",
          name: "Refinery #1",
          tier: 1,
          active: false,
          chain_id: null,
          started_at: null,
          last_tick_at: null,
          ends_at: null,
          cycles_completed: 3,
          total_input_consumed: 50,
          total_output_produced: 45
        }
      ],
      asteroidCore: { probe_count: 2, max_probes: 5, max_deployments: 2 },
      probeFabrications: [{ id: "fab-1", started_at: 1, completes_at: 2, status: "in_progress" }],
      expeditions: [
        {
          id: "exp-a",
          belt_key: "sol:belt",
          system_id: "sol",
          duration: "standard",
          deployed_at: 10,
          completes_at: 20,
          last_tick_at: 15,
          launch_cost: 3000,
          status: "active",
          completed_at: null,
          deposit_station_id: null
        },
        {
          id: "exp-b",
          belt_key: "sol:belt",
          system_id: "sol",
          duration: "short",
          deployed_at: 1,
          completes_at: 2,
          last_tick_at: 2,
          launch_cost: 3000,
          status: "completed",
          completed_at: 2,
          deposit_station_id: "earth-station-prime"
        }
      ],
      expeditionYields: [
        { expedition_id: "exp-a", resource: "Silicates", quantity: 12 },
        { expedition_id: "exp-b", resource: "Carbon", quantity: 3 }
      ],
      scoutedBelts: [{ belt_key: "sol:belt" }],
      inventory: [{ station_id: "earth-station-prime", item: "Silicates", quantity: 99 }],
      tradeHistory: [
        {
          id: "trade-1",
          type: "sell",
          item: "Silicates",
          quantity: 10,
          unit_price: 24,
          total: 240,
          counterparty: "GEX",
          at: 100
        }
      ],
      activeMissions: [
        {
          id: "ms-log-001",
          mission_template_id: "ms-log-001",
          accepted_at: 11,
          expires_at: 21,
          progress_quantity: 7,
          status: "active"
        }
      ],
      completedMissions: [
        {
          mission_template_id: "ms-log-002",
          title: "Done",
          type: "Logistics",
          agent_id: "elara-voss",
          reward: "15,000 Credits",
          completed_at: 9
        }
      ],
      agentReputation: [{ agent_id: "elara-voss", completed_count: 3, standing: 2.2 }],
      contractOffering: { next_refresh_at: 999 },
      contractOfferingMissions: [{ slot: 0, mission_template_id: "ms-log-003" }],
      rdQueue: [
        {
          id: 10,
          node_id: "tt-basic-extraction",
          position: 0,
          status: "in_progress",
          queued_at: 10,
          started_at: 11,
          completes_at: 50
        }
      ],
      insightQueue: [
        {
          id: 11,
          node_id: "ceo-negotiation-fundamentals",
          position: 0,
          status: "queued",
          queued_at: 12,
          started_at: null,
          completes_at: null
        }
      ],
      completedInsights: [
        { program_id: "ceo-negotiation-fundamentals", level: 2 },
        { program_id: "ceo-charter-ops", level: 1 }
      ],
      notifications: [
        {
          id: "ntf-1",
          account_id: "user-73",
          type: "system",
          title: "Welcome",
          body: "Boot complete",
          created_at: 100,
          read_at: null
        }
      ],
      messages: [
        {
          id: "msg-1",
          account_id: "user-73",
          from_type: "system",
          from_id: "system",
          from_name: "ISA",
          to_account_id: "user-73",
          to_corp_name: "Helix",
          to_name: "Helix",
          subject: "Init",
          body: "Go",
          sent_at: 101,
          read_at: null,
          folder: "inbox",
          trashed_at: null
        }
      ]
    });

    expect(account.state.corp.refineries[0].cyclesCompleted).toBe(3);
    expect(account.state.corp.asteroidMining.probeCount).toBe(2);
    expect(account.state.corp.asteroidMining.activeExpeditions).toHaveLength(1);
    expect(account.state.corp.asteroidMining.completedExpeditions).toHaveLength(1);
    expect(account.state.corp.asteroidMining.completedExpeditions[0].yields.Carbon).toBe(3);
    expect(account.state.corp.inventory["earth-station-prime"].Silicates).toBe(99);
    expect(account.state.corp.activeMissions[0].missionTemplateId).toBe("ms-log-001");
    expect(account.state.corp.completedMissions[0].missionTemplateId).toBe("ms-log-002");
    expect(account.state.corp.agentReputation["elara-voss"].standing).toBe(2.2);
    expect(account.state.corp.contractOfferings.nextRefreshAt).toBe(999);
    expect(account.state.corp.contractOfferings.missions[0].id).toBe("ms-log-003");
    expect(account.state.queues.corporateRnD[0].nodeId).toBe("tt-basic-extraction");
    expect(account.state.queues.corporateRnD[0].techId).toBe("tt-basic-extraction");
    expect(account.state.queues.corporateRnD[0].durationHours).toBeCloseTo((50 - 11) / 3600000, 6);
    expect(account.state.queues.ceoInsight[0].nodeId).toBe("ceo-negotiation-fundamentals");
    expect(account.state.queues.ceoInsight[0].programId).toBe("ceo-negotiation-fundamentals");
    expect(account.state.queues.ceoInsight[0].durationHours).toBeNull();
    expect(account.state.corp.completedInsights).toEqual([
      "ceo-negotiation-fundamentals",
      "ceo-negotiation-fundamentals",
      "ceo-charter-ops"
    ]);
    expect(account.notifications[0].id).toBe("ntf-1");
    expect(account.messages[0].id).toBe("msg-1");
  });
});

describe("Phase 3 feature-flag no-ops (test env)", () => {
  it("persistAccountsPhase3 resolves without side effects when normalized flag is off", async () => {
    await expect(persistAccountsPhase3([makePhase3Account()])).resolves.toBeUndefined();
  });

  it("hydrateOverlayPhase3 resolves without side effects when normalized flag is off", async () => {
    const hydrated = { "user-73": makePhase3Account() };
    await expect(hydrateOverlayPhase3(hydrated)).resolves.toBeUndefined();
    expect(hydrated["user-73"].state.corp.refineries).toHaveLength(1);
    expect(hydrated["user-73"].state.queues.ceoInsight[0].nodeId).toBe("ceo-negotiation-fundamentals");
  });
});
