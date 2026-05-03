// server/db/repositories/index.js
// Facade over normalized-table repository modules.
//
// Phase 1: corporations, finances, military, unlocks, and set tables.
// Phase 2: buildings, offices, mining leases, and extractors.

import { USE_NORMALIZED_TABLES } from "../supabaseClient.js";

import {
  mapAccountToCorpRow,
  applyCorpRowToAccount,
  upsertCorporations,
  loadAllCorporations
} from "./corporationRepo.js";
import {
  mapAccountToFinanceRow,
  applyFinanceRowToAccount,
  upsertFinances,
  loadAllFinances
} from "./financeRepo.js";
import {
  mapAccountToMilitaryRow,
  applyMilitaryRowToAccount,
  upsertMilitary,
  loadAllMilitary
} from "./militaryRepo.js";
import {
  mapAccountToUnlocksRow,
  applyUnlocksRowToAccount,
  upsertUnlocks,
  loadAllUnlocks
} from "./unlocksRepo.js";
import {
  mapAccountToMarketSectorRows,
  mapAccountToUnlockedTechRows,
  mapAccountToMilestoneRows,
  applyMarketSectorsToAccount,
  applyUnlockedTechToAccount,
  applyMilestonesToAccount,
  replaceMarketSectors,
  replaceUnlockedTech,
  replaceMilestones,
  loadAllMarketSectors,
  loadAllUnlockedTech,
  loadAllMilestones
} from "./setsRepo.js";
import {
  mapAccountToBuildingRows,
  mapAccountToOfficeRows,
  mapAccountToLeaseRows,
  mapAccountToExtractorRows,
  applyInfrastructureRowsToAccount,
  replaceInfrastructureRows,
  loadAllBuildings,
  loadAllOffices,
  loadAllLeases,
  loadAllExtractors
} from "./infrastructureRepo.js";
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
  replaceOperationsRows,
  loadAllRefineries,
  loadAllAsteroidCore,
  loadAllProbeFabrications,
  loadAllExpeditions,
  loadAllExpeditionYields,
  loadAllScoutedBelts,
  loadAllInventory,
  loadAllTradeHistory,
  loadAllActiveMissions,
  loadAllCompletedMissions,
  loadAllAgentReputation,
  loadAllContractOfferings,
  loadAllContractOfferingMissions,
  loadAllRdQueue,
  loadAllInsightQueue,
  loadAllCompletedInsights,
  loadAllNotifications,
  loadAllMessages
} from "./operationsRepo.js";

export function isPersistableAccount(account) {
  return Boolean(account && account.id);
}

/**
 * Dual-write the Phase 1 normalized tables for every persistable account.
 * No-op when USE_NORMALIZED_TABLES is false. Errors propagate so the caller
 * can decide between fail-loud and log-and-continue.
 */
export async function persistAccountsPhase1(accounts) {
  if (!USE_NORMALIZED_TABLES) return;
  const persistable = (accounts || []).filter(isPersistableAccount);
  if (!persistable.length) return;

  const corpRows = persistable.map(mapAccountToCorpRow);
  const financeRows = persistable.map(mapAccountToFinanceRow);
  const militaryRows = persistable.map(mapAccountToMilitaryRow);
  const unlocksRows = persistable.map(mapAccountToUnlocksRow);

  // Corporations must land first — every other Phase 1 table FKs into it.
  await upsertCorporations(corpRows);
  await Promise.all([
    upsertFinances(financeRows),
    upsertMilitary(militaryRows),
    upsertUnlocks(unlocksRows)
  ]);

  // Set tables: replace-by-corp for each account.
  for (const account of persistable) {
    await Promise.all([
      replaceMarketSectors(account.id, mapAccountToMarketSectorRows(account)),
      replaceUnlockedTech(account.id, mapAccountToUnlockedTechRows(account)),
      replaceMilestones(account.id, mapAccountToMilestoneRows(account))
    ]);
  }
}

/**
 * Overlay Phase 1 normalized data on top of an already-hydrated accounts map.
 * Mutates accounts in place. No-op when USE_NORMALIZED_TABLES is false.
 *
 * `hydratedAccounts` is the object returned by the legacy state_json hydrate;
 * shape: { [accountId]: account }.
 */
export async function hydrateOverlayPhase1(hydratedAccounts) {
  if (!USE_NORMALIZED_TABLES) return;
  if (!hydratedAccounts || typeof hydratedAccounts !== "object") return;

  const [corps, finances, military, unlocks, sectors, tech, milestones] = await Promise.all([
    loadAllCorporations(),
    loadAllFinances(),
    loadAllMilitary(),
    loadAllUnlocks(),
    loadAllMarketSectors(),
    loadAllUnlockedTech(),
    loadAllMilestones()
  ]);

  for (const account of Object.values(hydratedAccounts)) {
    if (!isPersistableAccount(account)) continue;
    const corpRow = corps.get(account.id);
    if (!corpRow) continue; // Account not yet migrated; leave blob values intact.
    applyCorpRowToAccount(account, corpRow);
    if (finances.has(account.id)) applyFinanceRowToAccount(account, finances.get(account.id));
    if (military.has(account.id)) applyMilitaryRowToAccount(account, military.get(account.id));
    if (unlocks.has(account.id)) applyUnlocksRowToAccount(account, unlocks.get(account.id));
    if (sectors.has(account.id)) applyMarketSectorsToAccount(account, sectors.get(account.id));
    if (tech.has(account.id)) applyUnlockedTechToAccount(account, tech.get(account.id));
    if (milestones.has(account.id)) applyMilestonesToAccount(account, milestones.get(account.id));
  }
}

/**
 * Dual-write the Phase 2 normalized tables for every persistable account.
 * No-op when USE_NORMALIZED_TABLES is false.
 */
export async function persistAccountsPhase2(accounts) {
  if (!USE_NORMALIZED_TABLES) return;
  const persistable = (accounts || []).filter(isPersistableAccount);
  if (!persistable.length) return;

  for (const account of persistable) {
    const rowsByTable = {
      buildings: mapAccountToBuildingRows(account),
      offices: mapAccountToOfficeRows(account),
      leases: mapAccountToLeaseRows(account),
      extractors: mapAccountToExtractorRows(account)
    };
    await replaceInfrastructureRows(account.id, rowsByTable);
  }
}

/**
 * Overlay Phase 2 normalized data on top of an already-hydrated accounts map.
 * Mutates accounts in place. No-op when USE_NORMALIZED_TABLES is false.
 */
export async function hydrateOverlayPhase2(hydratedAccounts) {
  if (!USE_NORMALIZED_TABLES) return;
  if (!hydratedAccounts || typeof hydratedAccounts !== "object") return;

  const [buildings, offices, leases, extractors] = await Promise.all([
    loadAllBuildings(),
    loadAllOffices(),
    loadAllLeases(),
    loadAllExtractors()
  ]);

  for (const account of Object.values(hydratedAccounts)) {
    if (!isPersistableAccount(account)) continue;
    const accountId = account.id;
    const hasPhase2Rows =
      buildings.has(accountId) || offices.has(accountId) || leases.has(accountId) || extractors.has(accountId);
    if (!hasPhase2Rows) continue;

    applyInfrastructureRowsToAccount(account, {
      buildings: buildings.get(accountId) || [],
      offices: offices.get(accountId) || [],
      leases: leases.get(accountId) || [],
      extractors: extractors.get(accountId) || []
    });
  }
}

/**
 * Dual-write remaining normalized domains after Phase 2.
 * No-op when USE_NORMALIZED_TABLES is false.
 */
export async function persistAccountsPhase3(accounts) {
  if (!USE_NORMALIZED_TABLES) return;
  const persistable = (accounts || []).filter(isPersistableAccount);
  if (!persistable.length) return;

  for (const account of persistable) {
    await replaceOperationsRows(account, {
      refineries: mapAccountToRefineryRows(account),
      asteroidCore: mapAccountToAsteroidCoreRow(account),
      probeFabrications: mapAccountToProbeFabricationRows(account),
      expeditions: mapAccountToExpeditionRows(account),
      expeditionYields: mapAccountToExpeditionYieldRows(account),
      scoutedBelts: mapAccountToScoutedBeltRows(account),
      inventory: mapAccountToInventoryRows(account),
      tradeHistory: mapAccountToTradeHistoryRows(account),
      activeMissions: mapAccountToActiveMissionRows(account),
      completedMissions: mapAccountToCompletedMissionRows(account),
      agentReputation: mapAccountToAgentReputationRows(account),
      contractOffering: mapAccountToContractOfferingRow(account),
      contractOfferingMissions: mapAccountToContractOfferingMissionRows(account),
      rdQueue: mapAccountToRdQueueRows(account),
      insightQueue: mapAccountToInsightQueueRows(account),
      completedInsights: mapAccountToCompletedInsightRows(account),
      notifications: mapAccountToNotificationRows(account),
      messages: mapAccountToMessageRows(account)
    });
  }
}

/**
 * Overlay remaining normalized-domain rows on top of hydrated blob data.
 * Mutates accounts in place. No-op when USE_NORMALIZED_TABLES is false.
 */
export async function hydrateOverlayPhase3(hydratedAccounts) {
  if (!USE_NORMALIZED_TABLES) return;
  if (!hydratedAccounts || typeof hydratedAccounts !== "object") return;

  const [
    refineries,
    asteroidCore,
    probeFabrications,
    expeditions,
    expeditionYieldsByExpedition,
    scoutedBelts,
    inventory,
    tradeHistory,
    activeMissions,
    completedMissions,
    agentReputation,
    contractOfferings,
    contractOfferingMissions,
    rdQueue,
    insightQueue,
    completedInsights,
    notifications,
    messages
  ] = await Promise.all([
    loadAllRefineries(),
    loadAllAsteroidCore(),
    loadAllProbeFabrications(),
    loadAllExpeditions(),
    loadAllExpeditionYields(),
    loadAllScoutedBelts(),
    loadAllInventory(),
    loadAllTradeHistory(),
    loadAllActiveMissions(),
    loadAllCompletedMissions(),
    loadAllAgentReputation(),
    loadAllContractOfferings(),
    loadAllContractOfferingMissions(),
    loadAllRdQueue(),
    loadAllInsightQueue(),
    loadAllCompletedInsights(),
    loadAllNotifications(),
    loadAllMessages()
  ]);

  const expeditionYieldsByCorp = new Map();
  for (const [corpId, corpExpeditions] of expeditions.entries()) {
    const rows = [];
    for (const expedition of corpExpeditions) {
      const yields = expeditionYieldsByExpedition.get(expedition.id) || [];
      rows.push(...yields);
    }
    expeditionYieldsByCorp.set(corpId, rows);
  }

  for (const account of Object.values(hydratedAccounts)) {
    if (!isPersistableAccount(account)) continue;
    const accountId = account.id;

    const hasRows =
      refineries.has(accountId) ||
      asteroidCore.has(accountId) ||
      probeFabrications.has(accountId) ||
      expeditions.has(accountId) ||
      scoutedBelts.has(accountId) ||
      inventory.has(accountId) ||
      tradeHistory.has(accountId) ||
      activeMissions.has(accountId) ||
      completedMissions.has(accountId) ||
      agentReputation.has(accountId) ||
      contractOfferings.has(accountId) ||
      contractOfferingMissions.has(accountId) ||
      rdQueue.has(accountId) ||
      insightQueue.has(accountId) ||
      completedInsights.has(accountId) ||
      notifications.has(accountId) ||
      messages.has(accountId);
    if (!hasRows) continue;

    applyOperationsRowsToAccount(account, {
      refineries: refineries.has(accountId) ? refineries.get(accountId) : undefined,
      asteroidCore: asteroidCore.has(accountId) ? asteroidCore.get(accountId) : undefined,
      probeFabrications: probeFabrications.has(accountId) ? probeFabrications.get(accountId) : undefined,
      expeditions: expeditions.has(accountId) ? expeditions.get(accountId) : undefined,
      expeditionYields: expeditions.has(accountId) ? (expeditionYieldsByCorp.get(accountId) || []) : undefined,
      scoutedBelts: scoutedBelts.has(accountId) ? scoutedBelts.get(accountId) : undefined,
      inventory: inventory.has(accountId) ? inventory.get(accountId) : undefined,
      tradeHistory: tradeHistory.has(accountId) ? tradeHistory.get(accountId) : undefined,
      activeMissions: activeMissions.has(accountId) ? activeMissions.get(accountId) : undefined,
      completedMissions: completedMissions.has(accountId) ? completedMissions.get(accountId) : undefined,
      agentReputation: agentReputation.has(accountId) ? agentReputation.get(accountId) : undefined,
      contractOffering: contractOfferings.has(accountId) ? contractOfferings.get(accountId) : undefined,
      contractOfferingMissions: contractOfferingMissions.has(accountId) ? contractOfferingMissions.get(accountId) : undefined,
      rdQueue: rdQueue.has(accountId) ? rdQueue.get(accountId) : undefined,
      insightQueue: insightQueue.has(accountId) ? insightQueue.get(accountId) : undefined,
      completedInsights: completedInsights.has(accountId) ? completedInsights.get(accountId) : undefined,
      notifications: notifications.has(accountId) ? notifications.get(accountId) : undefined,
      messages: messages.has(accountId) ? messages.get(accountId) : undefined
    });
  }
}

// Re-exports for unit testing.
export {
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
  mapAccountToBuildingRows,
  mapAccountToOfficeRows,
  mapAccountToLeaseRows,
  mapAccountToExtractorRows,
  applyInfrastructureRowsToAccount,
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
  applyOperationsRowsToAccount
};
