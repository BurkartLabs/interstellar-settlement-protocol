// server/db/repositories/operationsRepo.js
// Remaining normalized-table domains after Phase 2.

import { supabaseAdmin } from "../supabaseClient.js";

const toNum = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function stableId(prefix, ownerId, index) {
  return `${prefix}-${ownerId}-${index + 1}`;
}

function normalizeQueueStatus(status, startedAt, completesAt) {
  if (status === "complete" || status === "completed") return "complete";
  if (status === "in_progress" || status === "active") return "in_progress";
  if (startedAt != null && completesAt != null) return "in_progress";
  return "queued";
}

function mapQueueRows(corpId, queue, prefix, idField) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item, index) => ({
    corp_id: corpId,
    node_id: String(item?.[idField] || item?.nodeId || item?.id || item?.name || `${prefix}-${index + 1}`),
    position: toNum(item?.position, index),
    status: normalizeQueueStatus(item?.status, item?.startedAt, item?.completesAt),
    queued_at: item?.queuedAt != null ? toNum(item.queuedAt) : null,
    started_at: item?.startedAt != null ? toNum(item.startedAt) : null,
    completes_at:
      item?.completesAt != null
        ? toNum(item.completesAt)
        : item?.startedAt != null && Number.isFinite(Number(item?.durationHours))
          ? toNum(item.startedAt) + Math.round(Number(item.durationHours) * 3_600_000)
          : null
  }));
}

function normalizeScoutEntries(scoutedBelts) {
  if (!Array.isArray(scoutedBelts)) return [];
  return scoutedBelts
    .map((entry) => {
      if (typeof entry === "string") {
        return { beltKey: entry, scoutedAt: null };
      }
      if (!entry || typeof entry !== "object") return null;
      return {
        beltKey: entry.beltKey || entry.key || entry.id || null,
        scoutedAt: entry.scoutedAt ?? null
      };
    })
    .filter((entry) => entry && entry.beltKey);
}

export function mapAccountToRefineryRows(account) {
  const corpId = account?.id;
  const refineries = account?.state?.corp?.refineries;
  if (!corpId || !Array.isArray(refineries)) return [];
  return refineries.map((refinery, index) => ({
    id: String(refinery?.id || stableId("ref", corpId, index)),
    corp_id: corpId,
    name: String(refinery?.name || `Refinery #${index + 1}`),
    tier: toNum(refinery?.tier, 1),
    active: Boolean(refinery?.active),
    chain_id: refinery?.chainId ?? null,
    cycle_scale: Math.max(1, toNum(refinery?.cycleScale, 1)),
    started_at: refinery?.startedAt != null ? toNum(refinery.startedAt) : null,
    last_tick_at: refinery?.lastTickAt != null ? toNum(refinery.lastTickAt) : null,
    ends_at: refinery?.endsAt != null ? toNum(refinery.endsAt) : null,
    cycles_completed: toNum(refinery?.cyclesCompleted, 0),
    total_input_consumed: toNum(refinery?.totalInputConsumed, 0),
    total_output_produced: toNum(refinery?.totalOutputProduced, 0)
  }));
}

export function mapAccountToAsteroidCoreRow(account) {
  const corpId = account?.id;
  const asteroidMining = account?.state?.corp?.asteroidMining || {};
  if (!corpId) return null;
  return {
    corp_id: corpId,
    probe_count: toNum(asteroidMining?.probeCount, 0),
    max_probes: toNum(asteroidMining?.maxProbes, 2),
    max_deployments: toNum(asteroidMining?.maxDeployments, 1)
  };
}

export function mapAccountToProbeFabricationRows(account) {
  const corpId = account?.id;
  const queue = account?.state?.corp?.asteroidMining?.fabricationQueue;
  if (!corpId || !Array.isArray(queue)) return [];
  return queue.map((item, index) => ({
    id: String(item?.id || stableId("fab", corpId, index)),
    corp_id: corpId,
    started_at: toNum(item?.startedAt, Date.now()),
    completes_at: toNum(item?.completesAt, Date.now()),
    status: item?.status === "complete" ? "complete" : "in_progress"
  }));
}

export function mapAccountToExpeditionRows(account) {
  const corpId = account?.id;
  const asteroidMining = account?.state?.corp?.asteroidMining || {};
  if (!corpId) return [];

  const active = Array.isArray(asteroidMining.activeExpeditions) ? asteroidMining.activeExpeditions : [];
  const completed = Array.isArray(asteroidMining.completedExpeditions)
    ? asteroidMining.completedExpeditions
    : [];

  return [...active, ...completed].map((expedition, index) => ({
    id: String(expedition?.id || stableId("exp", corpId, index)),
    corp_id: corpId,
    belt_key: String(expedition?.beltKey || "sol:belt"),
    system_id: String(expedition?.systemId || "sol"),
    duration: expedition?.duration || "standard",
    deployed_at: toNum(expedition?.deployedAt, Date.now()),
    completes_at: toNum(expedition?.completesAt, Date.now()),
    last_tick_at: expedition?.lastTickAt != null ? toNum(expedition.lastTickAt) : null,
    launch_cost: toNum(expedition?.launchCost, 0),
    status: expedition?.status === "completed" ? "completed" : "active",
    completed_at: expedition?.completedAt != null ? toNum(expedition.completedAt) : null,
    deposit_station_id: expedition?.depositStationId || null
  }));
}

export function mapAccountToExpeditionYieldRows(account) {
  const corpId = account?.id;
  const asteroidMining = account?.state?.corp?.asteroidMining || {};
  if (!corpId) return [];

  const allExpeditions = [
    ...(Array.isArray(asteroidMining.activeExpeditions) ? asteroidMining.activeExpeditions : []),
    ...(Array.isArray(asteroidMining.completedExpeditions) ? asteroidMining.completedExpeditions : [])
  ];

  const rows = [];
  for (const expedition of allExpeditions) {
    if (!expedition?.id || !expedition?.yields || typeof expedition.yields !== "object") continue;
    for (const [resource, quantity] of Object.entries(expedition.yields)) {
      const numericQty = toNum(quantity, 0);
      if (numericQty <= 0) continue;
      rows.push({
        expedition_id: expedition.id,
        resource,
        quantity: numericQty
      });
    }
  }
  return rows;
}

export function mapAccountToScoutedBeltRows(account) {
  const corpId = account?.id;
  const scoutedBelts = account?.state?.corp?.asteroidMining?.scoutedBelts;
  if (!corpId) return [];
  return normalizeScoutEntries(scoutedBelts).map((entry) => ({
    corp_id: corpId,
    belt_key: entry.beltKey,
    scouted_at: entry.scoutedAt != null ? toNum(entry.scoutedAt) : null
  }));
}

export function mapAccountToInventoryRows(account) {
  const corpId = account?.id;
  const inventory = account?.state?.corp?.inventory;
  if (!corpId || !inventory || typeof inventory !== "object") return [];

  const rows = [];
  for (const [stationId, stack] of Object.entries(inventory)) {
    if (!stack || typeof stack !== "object") continue;
    for (const [item, quantity] of Object.entries(stack)) {
      const numericQty = toNum(quantity, 0);
      if (numericQty <= 0) continue;
      rows.push({
        corp_id: corpId,
        station_id: stationId,
        item,
        quantity: numericQty
      });
    }
  }
  return rows;
}

export function mapAccountToTradeHistoryRows(account) {
  const corpId = account?.id;
  const history = account?.state?.corp?.tradeHistory;
  if (!corpId || !Array.isArray(history)) return [];
  return history.map((trade, index) => ({
    id: String(trade?.id || stableId("trade", corpId, index)),
    corp_id: corpId,
    type: String(trade?.type || "trade"),
    item: String(trade?.item || "Unknown"),
    quantity: toNum(trade?.quantity, 0),
    unit_price: toNum(trade?.unitPrice, 0),
    total: toNum(trade?.total, 0),
    counterparty: trade?.counterparty || null,
    at: toNum(trade?.at, Date.now())
  }));
}

export function mapAccountToActiveMissionRows(account) {
  const corpId = account?.id;
  const active = account?.state?.corp?.activeMissions;
  if (!corpId || !Array.isArray(active)) return [];
  return active.map((mission, index) => ({
    id: String(mission?.id || stableId("mission-active", corpId, index)),
    corp_id: corpId,
    mission_template_id: String(mission?.missionTemplateId || mission?.id || "unknown-mission"),
    accepted_at: mission?.acceptedAt != null ? toNum(mission.acceptedAt) : null,
    expires_at: mission?.expiresAt != null ? toNum(mission.expiresAt) : null,
    progress_quantity: toNum(mission?.progressQuantity, mission?.progress || 0),
    status: mission?.status || "active"
  }));
}

export function mapAccountToCompletedMissionRows(account) {
  const corpId = account?.id;
  const completed = account?.state?.corp?.completedMissions;
  if (!corpId || !Array.isArray(completed)) return [];
  return completed.map((mission) => ({
    corp_id: corpId,
    mission_template_id: String(mission?.missionTemplateId || mission?.id || "unknown-mission"),
    title: mission?.title || null,
    type: mission?.type || null,
    agent_id: mission?.agentId || null,
    reward: mission?.reward || null,
    completed_at: toNum(mission?.completedAt, Date.now())
  }));
}

export function mapAccountToAgentReputationRows(account) {
  const corpId = account?.id;
  const reputation = account?.state?.corp?.agentReputation;
  if (!corpId || !reputation || typeof reputation !== "object") return [];
  return Object.entries(reputation).map(([agentId, value]) => {
    if (value && typeof value === "object") {
      return {
        corp_id: corpId,
        agent_id: agentId,
        completed_count: toNum(value.completedCount, 0),
        standing: toNum(value.standing, 0)
      };
    }
    return {
      corp_id: corpId,
      agent_id: agentId,
      completed_count: 0,
      standing: toNum(value, 0)
    };
  });
}

export function mapAccountToContractOfferingRow(account) {
  const corpId = account?.id;
  const offerings = account?.state?.corp?.contractOfferings || {};
  if (!corpId) return null;
  return {
    corp_id: corpId,
    next_refresh_at: toNum(offerings?.nextRefreshAt, 0)
  };
}

export function mapAccountToContractOfferingMissionRows(account) {
  const corpId = account?.id;
  const missions = account?.state?.corp?.contractOfferings?.missions;
  if (!corpId || !Array.isArray(missions)) return [];
  return missions.map((mission, slot) => ({
    corp_id: corpId,
    slot,
    mission_template_id: String(mission?.missionTemplateId || mission?.id || `mission-slot-${slot + 1}`)
  }));
}

export function mapAccountToRdQueueRows(account) {
  const corpId = account?.id;
  const queue = account?.state?.queues?.corporateRnD;
  if (!corpId) return [];
  return mapQueueRows(corpId, queue, "rnd", "techId");
}

export function mapAccountToInsightQueueRows(account) {
  const corpId = account?.id;
  const queue = account?.state?.queues?.ceoInsight;
  if (!corpId) return [];
  return mapQueueRows(corpId, queue, "insight", "programId");
}

export function mapAccountToCompletedInsightRows(account) {
  const corpId = account?.id;
  const completedInsights = account?.state?.corp?.completedInsights;
  if (!corpId || !Array.isArray(completedInsights)) return [];

  const levelByProgram = new Map();
  for (const programId of completedInsights) {
    if (typeof programId !== "string" || !programId) continue;
    levelByProgram.set(programId, (levelByProgram.get(programId) || 0) + 1);
  }

  return Array.from(levelByProgram.entries()).map(([programId, level]) => ({
    corp_id: corpId,
    program_id: programId,
    level,
    completed_at: Date.now()
  }));
}

export function mapAccountToNotificationRows(account) {
  const accountId = account?.id;
  const notifications = account?.notifications;
  if (!accountId || !Array.isArray(notifications)) return [];
  return notifications.map((notification, index) => ({
    id: String(notification?.id || stableId("ntf", accountId, index)),
    account_id: accountId,
    type: String(notification?.type || "system"),
    title: String(notification?.title || "Notification"),
    body: String(notification?.body || ""),
    created_at: toNum(notification?.createdAt, Date.now()),
    read_at: notification?.readAt != null ? toNum(notification.readAt) : null
  }));
}

export function mapAccountToMessageRows(account) {
  const accountId = account?.id;
  const messages = account?.messages;
  if (!accountId || !Array.isArray(messages)) return [];
  return messages.map((message, index) => ({
    id: String(message?.id || stableId("msg", accountId, index)),
    account_id: accountId,
    from_type: message?.fromType === "player" ? "player" : "system",
    from_id: message?.fromId || null,
    from_name: message?.fromName || null,
    to_account_id: message?.toAccountId || null,
    to_corp_name: message?.toCorpName || null,
    to_name: message?.toName || null,
    subject: message?.subject || null,
    body: message?.body || null,
    sent_at: toNum(message?.sentAt, Date.now()),
    read_at: message?.readAt != null ? toNum(message.readAt) : null,
    folder: message?.folder || "inbox",
    trashed_at: message?.trashedAt != null ? toNum(message.trashedAt) : null
  }));
}

export function applyOperationsRowsToAccount(account, rows) {
  if (!account?.state || !rows) return;

  const corp = (account.state.corp ||= {});
  const queues = (account.state.queues ||= {});

  // ── Refineries ──
  // IMPORTANT: only overwrite fields whose Phase-3 entry was explicitly
  // provided. Pass `undefined` (vs `[]`) to indicate "no normalized rows for
  // this corp" so we preserve whatever the JSON state blob already has —
  // this avoids wiping in-flight chains, queues, and similar state when a
  // dual-write transiently failed.
  if (rows.refineries !== undefined) {
    const refineries = Array.isArray(rows.refineries) ? rows.refineries : [];
    // Preserve in-blob-only fields (cycleScale, inputItem, perCycle metadata)
    // by merging row data on top of the existing in-memory refinery.
    const existingById = new Map((corp.refineries || []).map((r) => [r.id, r]));
    corp.refineries = refineries.map((row) => {
      const prior = existingById.get(row.id) || {};
      return {
        ...prior,
        id: row.id,
        name: row.name,
        tier: toNum(row.tier, 1),
        active: Boolean(row.active),
        chainId: row.chain_id ?? null,
        cycleScale: Math.max(1, toNum(row.cycle_scale, prior.cycleScale ?? 1)),
        startedAt: row.started_at != null ? Number(row.started_at) : null,
        lastTickAt: row.last_tick_at != null ? Number(row.last_tick_at) : null,
        endsAt: row.ends_at != null ? Number(row.ends_at) : null,
        cyclesCompleted: toNum(row.cycles_completed, 0),
        totalInputConsumed: toNum(row.total_input_consumed, 0),
        totalOutputProduced: toNum(row.total_output_produced, 0)
      };
    });
  }

  // ── Asteroid mining ──
  if (rows.asteroidCore !== undefined ||
      rows.probeFabrications !== undefined ||
      rows.expeditions !== undefined ||
      rows.scoutedBelts !== undefined) {
    const asteroidCore = rows.asteroidCore || null;
    const fabricationQueue = Array.isArray(rows.probeFabrications) ? rows.probeFabrications : [];
    const expeditions = Array.isArray(rows.expeditions) ? rows.expeditions : [];
    const expeditionYields = Array.isArray(rows.expeditionYields) ? rows.expeditionYields : [];
    const scoutedBelts = Array.isArray(rows.scoutedBelts) ? rows.scoutedBelts : [];
    const yieldsByExpeditionId = new Map();
    for (const row of expeditionYields) {
      if (!yieldsByExpeditionId.has(row.expedition_id)) yieldsByExpeditionId.set(row.expedition_id, {});
      yieldsByExpeditionId.get(row.expedition_id)[row.resource] = toNum(row.quantity, 0);
    }

    if (!corp.asteroidMining || typeof corp.asteroidMining !== "object") {
      corp.asteroidMining = {};
    }

    if (asteroidCore) {
      corp.asteroidMining.probeCount = toNum(asteroidCore.probe_count, 0);
      corp.asteroidMining.maxProbes = toNum(asteroidCore.max_probes, 2);
      corp.asteroidMining.maxDeployments = toNum(asteroidCore.max_deployments, 1);
    }

    if (rows.probeFabrications !== undefined) {
      corp.asteroidMining.fabricationQueue = fabricationQueue.map((row) => ({
        id: row.id,
        startedAt: Number(row.started_at),
        completesAt: Number(row.completes_at),
        status: row.status
      }));
    }

    if (rows.expeditions !== undefined) {
      const mappedExpeditions = expeditions.map((row) => ({
        id: row.id,
        beltKey: row.belt_key,
        systemId: row.system_id,
        duration: row.duration,
        deployedAt: Number(row.deployed_at),
        completesAt: Number(row.completes_at),
        lastTickAt: row.last_tick_at != null ? Number(row.last_tick_at) : Number(row.deployed_at),
        launchCost: toNum(row.launch_cost, 0),
        status: row.status,
        completedAt: row.completed_at != null ? Number(row.completed_at) : null,
        depositStationId: row.deposit_station_id || null,
        yields: yieldsByExpeditionId.get(row.id) || {}
      }));
      corp.asteroidMining.activeExpeditions = mappedExpeditions.filter((exp) => exp.status === "active");
      corp.asteroidMining.completedExpeditions = mappedExpeditions.filter((exp) => exp.status === "completed");
    }

    if (rows.scoutedBelts !== undefined) {
      corp.asteroidMining.scoutedBelts = scoutedBelts.map((row) => row.belt_key);
    }
  }

  if (rows.inventory !== undefined) {
    const inventoryRows = Array.isArray(rows.inventory) ? rows.inventory : [];
    corp.inventory = {};
    for (const row of inventoryRows) {
      if (!corp.inventory[row.station_id]) corp.inventory[row.station_id] = {};
      corp.inventory[row.station_id][row.item] = toNum(row.quantity, 0);
    }
  }

  if (rows.tradeHistory !== undefined) {
    const tradeHistoryRows = Array.isArray(rows.tradeHistory) ? rows.tradeHistory : [];
    corp.tradeHistory = tradeHistoryRows
      .sort((a, b) => Number(b.at) - Number(a.at))
      .map((row) => ({
        id: row.id,
        type: row.type,
        item: row.item,
        quantity: toNum(row.quantity, 0),
        unitPrice: toNum(row.unit_price, 0),
        total: toNum(row.total, 0),
        counterparty: row.counterparty || null,
        at: Number(row.at)
      }));
  }

  if (rows.activeMissions !== undefined) {
    const activeMissions = Array.isArray(rows.activeMissions) ? rows.activeMissions : [];
    corp.activeMissions = activeMissions.map((row) => ({
      id: row.id,
      missionTemplateId: row.mission_template_id,
      acceptedAt: row.accepted_at != null ? Number(row.accepted_at) : null,
      expiresAt: row.expires_at != null ? Number(row.expires_at) : null,
      progressQuantity: toNum(row.progress_quantity, 0),
      status: row.status || "active"
    }));
  }

  if (rows.completedMissions !== undefined) {
    const completedMissions = Array.isArray(rows.completedMissions) ? rows.completedMissions : [];
    corp.completedMissions = completedMissions
      .sort((a, b) => Number(b.completed_at) - Number(a.completed_at))
      .map((row, index) => ({
        id: row.mission_template_id || `completed-${index + 1}`,
        missionTemplateId: row.mission_template_id,
        title: row.title,
        type: row.type,
        agentId: row.agent_id,
        reward: row.reward,
        completedAt: Number(row.completed_at)
      }));
  }

  if (rows.agentReputation !== undefined) {
    const agentReputationRows = Array.isArray(rows.agentReputation) ? rows.agentReputation : [];
    corp.agentReputation = {};
    for (const row of agentReputationRows) {
      corp.agentReputation[row.agent_id] = {
        completedCount: toNum(row.completed_count, 0),
        standing: toNum(row.standing, 0)
      };
    }
  }

  if (rows.contractOffering !== undefined || rows.contractOfferingMissions !== undefined) {
    const contractOffering = rows.contractOffering || null;
    const offeringMissions = Array.isArray(rows.contractOfferingMissions) ? rows.contractOfferingMissions : [];
    if (!corp.contractOfferings || typeof corp.contractOfferings !== "object") {
      corp.contractOfferings = { missions: [], nextRefreshAt: 0 };
    }
    if (contractOffering) {
      corp.contractOfferings.nextRefreshAt = toNum(contractOffering.next_refresh_at, 0);
    }
    if (rows.contractOfferingMissions !== undefined) {
      const existingOfferingById = new Map(
        (Array.isArray(corp.contractOfferings.missions) ? corp.contractOfferings.missions : [])
          .filter((mission) => mission && (mission.id || mission.missionTemplateId))
          .map((mission) => [mission.id || mission.missionTemplateId, mission])
      );
      corp.contractOfferings.missions = offeringMissions
        .sort((a, b) => Number(a.slot) - Number(b.slot))
        .map((row) => {
          const missionId = row.mission_template_id;
          return existingOfferingById.get(missionId) || { id: missionId, missionTemplateId: missionId };
        });
    }
  }

  if (rows.rdQueue !== undefined) {
    const rdQueueRows = Array.isArray(rows.rdQueue) ? rows.rdQueue : [];
    const existingRdByNode = new Map(
      (Array.isArray(queues.corporateRnD) ? queues.corporateRnD : [])
        .filter((item) => item && (item.techId || item.nodeId))
        .map((item) => [item.techId || item.nodeId, item])
    );
    queues.corporateRnD = rdQueueRows
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((row) => {
        const prior = existingRdByNode.get(row.node_id) || {};
        const startedAt = row.started_at != null ? Number(row.started_at) : null;
        const completesAt = row.completes_at != null ? Number(row.completes_at) : null;
        const durationHours =
          startedAt != null && completesAt != null
            ? Math.max(0, (completesAt - startedAt) / 3_600_000)
            : Number.isFinite(Number(prior.durationHours))
              ? Number(prior.durationHours)
              : null;
        return {
          id: row.id,
          nodeId: row.node_id,
          techId: row.node_id,
          name: prior.name || row.node_id,
          effect: prior.effect || "",
          costCredits: Number.isFinite(Number(prior.costCredits)) ? Number(prior.costCredits) : 0,
          durationHours,
          position: toNum(row.position, 0),
          status: row.status,
          queuedAt: row.queued_at != null ? Number(row.queued_at) : null,
          startedAt,
          completesAt
        };
      });
  }

  if (rows.insightQueue !== undefined) {
    const insightQueueRows = Array.isArray(rows.insightQueue) ? rows.insightQueue : [];
    const existingInsightByNode = new Map(
      (Array.isArray(queues.ceoInsight) ? queues.ceoInsight : [])
        .filter((item) => item && (item.programId || item.nodeId))
        .map((item) => [item.programId || item.nodeId, item])
    );
    queues.ceoInsight = insightQueueRows
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((row) => {
        const prior = existingInsightByNode.get(row.node_id) || {};
        const startedAt = row.started_at != null ? Number(row.started_at) : null;
        const completesAt = row.completes_at != null ? Number(row.completes_at) : null;
        const durationHours =
          startedAt != null && completesAt != null
            ? Math.max(0, (completesAt - startedAt) / 3_600_000)
            : Number.isFinite(Number(prior.durationHours))
              ? Number(prior.durationHours)
              : null;
        return {
          id: row.id,
          nodeId: row.node_id,
          programId: row.node_id,
          name: prior.name || row.node_id,
          effect: prior.effect || "",
          costCredits: Number.isFinite(Number(prior.costCredits)) ? Number(prior.costCredits) : 0,
          durationHours,
          position: toNum(row.position, 0),
          status: row.status,
          queuedAt: row.queued_at != null ? Number(row.queued_at) : null,
          startedAt,
          completesAt
        };
      });
  }

  if (rows.completedInsights !== undefined) {
    const completedInsights = Array.isArray(rows.completedInsights) ? rows.completedInsights : [];
    corp.completedInsights = [];
    for (const row of completedInsights) {
      const level = Math.max(1, toNum(row.level, 1));
      for (let i = 0; i < level; i += 1) {
        corp.completedInsights.push(row.program_id);
      }
    }
  }

  if (rows.notifications !== undefined) {
    const notifications = Array.isArray(rows.notifications) ? rows.notifications : [];
    account.notifications = notifications
      .sort((a, b) => Number(b.created_at) - Number(a.created_at))
      .map((row) => ({
        id: row.id,
        accountId: row.account_id,
        type: row.type,
        title: row.title,
        body: row.body,
        createdAt: Number(row.created_at),
        readAt: row.read_at != null ? Number(row.read_at) : null
      }));
  }

  if (rows.messages !== undefined) {
    const messages = Array.isArray(rows.messages) ? rows.messages : [];
    account.messages = messages
      .sort((a, b) => Number(b.sent_at) - Number(a.sent_at))
      .map((row) => ({
        id: row.id,
        fromType: row.from_type,
        fromId: row.from_id,
        fromName: row.from_name,
        toAccountId: row.to_account_id,
        toCorpName: row.to_corp_name,
        toName: row.to_name,
        subject: row.subject,
        body: row.body,
        sentAt: Number(row.sent_at),
        readAt: row.read_at != null ? Number(row.read_at) : null,
        folder: row.folder,
        trashedAt: row.trashed_at != null ? Number(row.trashed_at) : null
      }));
  }
}

async function replaceRowsByColumn(table, ownerColumn, ownerId, rows) {
  if (!supabaseAdmin) return;
  const { error: deleteError } = await supabaseAdmin.from(table).delete().eq(ownerColumn, ownerId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error: insertError } = await supabaseAdmin.from(table).insert(rows);
  if (insertError) throw insertError;
}

export async function replaceOperationsRows(account, rowsByTable) {
  if (!supabaseAdmin) return;
  const corpId = account.id;
  const accountId = account.id;

  // Child-first delete order for FK-linked tables.
  const expeditionIds = new Set((rowsByTable.expeditions || []).map((row) => row.id));
  if (expeditionIds.size > 0) {
    const { error: deleteYieldError } = await supabaseAdmin
      .from("corp_expedition_yields")
      .delete()
      .in("expedition_id", Array.from(expeditionIds));
    if (deleteYieldError) throw deleteYieldError;
  }

  await replaceRowsByColumn("corp_refineries", "corp_id", corpId, rowsByTable.refineries || []);

  // asteroid core is single-row upsert.
  if (rowsByTable.asteroidCore) {
    const { error: asteroidError } = await supabaseAdmin
      .from("corp_asteroid_mining")
      .upsert([rowsByTable.asteroidCore], { onConflict: "corp_id" });
    if (asteroidError) throw asteroidError;
  }

  await replaceRowsByColumn("corp_probe_fabrications", "corp_id", corpId, rowsByTable.probeFabrications || []);
  await replaceRowsByColumn("corp_expeditions", "corp_id", corpId, rowsByTable.expeditions || []);
  if (rowsByTable.expeditionYields?.length) {
    const { error: yieldInsertError } = await supabaseAdmin
      .from("corp_expedition_yields")
      .insert(rowsByTable.expeditionYields);
    if (yieldInsertError) throw yieldInsertError;
  }
  await replaceRowsByColumn("corp_scouted_belts", "corp_id", corpId, rowsByTable.scoutedBelts || []);

  await replaceRowsByColumn("corp_station_inventory", "corp_id", corpId, rowsByTable.inventory || []);
  await replaceRowsByColumn("corp_trade_history", "corp_id", corpId, rowsByTable.tradeHistory || []);

  await replaceRowsByColumn("corp_active_missions", "corp_id", corpId, rowsByTable.activeMissions || []);
  await replaceRowsByColumn("corp_completed_missions", "corp_id", corpId, rowsByTable.completedMissions || []);
  await replaceRowsByColumn("corp_agent_reputation", "corp_id", corpId, rowsByTable.agentReputation || []);

  if (rowsByTable.contractOffering) {
    const { error: offeringError } = await supabaseAdmin
      .from("corp_contract_offerings")
      .upsert([rowsByTable.contractOffering], { onConflict: "corp_id" });
    if (offeringError) throw offeringError;
  }
  await replaceRowsByColumn(
    "corp_contract_offering_missions",
    "corp_id",
    corpId,
    rowsByTable.contractOfferingMissions || []
  );

  await replaceRowsByColumn("corp_rd_queue", "corp_id", corpId, rowsByTable.rdQueue || []);
  await replaceRowsByColumn("corp_ceo_insight_queue", "corp_id", corpId, rowsByTable.insightQueue || []);
  await replaceRowsByColumn("corp_completed_insights", "corp_id", corpId, rowsByTable.completedInsights || []);

  await replaceRowsByColumn("account_notifications", "account_id", accountId, rowsByTable.notifications || []);
  await replaceRowsByColumn("account_messages", "account_id", accountId, rowsByTable.messages || []);
}

async function loadRowsByColumn(table, ownerColumn, orderColumn) {
  if (!supabaseAdmin) return new Map();
  let query = supabaseAdmin.from(table).select("*");
  if (orderColumn) query = query.order(orderColumn, { ascending: true });
  const { data, error } = await query;
  if (error) throw error;

  const grouped = new Map();
  for (const row of data || []) {
    const key = row[ownerColumn];
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

async function loadSingleByColumn(table, ownerColumn) {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin.from(table).select("*");
  if (error) throw error;
  const grouped = new Map();
  for (const row of data || []) grouped.set(row[ownerColumn], row);
  return grouped;
}

export const loadAllRefineries = () => loadRowsByColumn("corp_refineries", "corp_id", "id");
export const loadAllAsteroidCore = () => loadSingleByColumn("corp_asteroid_mining", "corp_id");
export const loadAllProbeFabrications = () => loadRowsByColumn("corp_probe_fabrications", "corp_id", "id");
export const loadAllExpeditions = () => loadRowsByColumn("corp_expeditions", "corp_id", "deployed_at");
export const loadAllExpeditionYields = () => loadRowsByColumn("corp_expedition_yields", "expedition_id", "resource");
export const loadAllScoutedBelts = () => loadRowsByColumn("corp_scouted_belts", "corp_id", "belt_key");
export const loadAllInventory = () => loadRowsByColumn("corp_station_inventory", "corp_id", "station_id");
export const loadAllTradeHistory = () => loadRowsByColumn("corp_trade_history", "corp_id", "at");
export const loadAllActiveMissions = () => loadRowsByColumn("corp_active_missions", "corp_id", "accepted_at");
export const loadAllCompletedMissions = () => loadRowsByColumn("corp_completed_missions", "corp_id", "completed_at");
export const loadAllAgentReputation = () => loadRowsByColumn("corp_agent_reputation", "corp_id", "agent_id");
export const loadAllContractOfferings = () => loadSingleByColumn("corp_contract_offerings", "corp_id");
export const loadAllContractOfferingMissions = () =>
  loadRowsByColumn("corp_contract_offering_missions", "corp_id", "slot");
export const loadAllRdQueue = () => loadRowsByColumn("corp_rd_queue", "corp_id", "position");
export const loadAllInsightQueue = () => loadRowsByColumn("corp_ceo_insight_queue", "corp_id", "position");
export const loadAllCompletedInsights = () =>
  loadRowsByColumn("corp_completed_insights", "corp_id", "completed_at");
export const loadAllNotifications = () => loadRowsByColumn("account_notifications", "account_id", "created_at");
export const loadAllMessages = () => loadRowsByColumn("account_messages", "account_id", "sent_at");
