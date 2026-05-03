// server/db/repositories/infrastructureRepo.js
// Phase 2 domain: buildings, offices, mining leases, and extractors.
//
// Persistence strategy is replace-by-corp for all four tables. This keeps the
// write path simple and guarantees stale rows are removed when gameplay mutates
// or deletes items in these arrays.

import { supabaseAdmin } from "../supabaseClient.js";

const toNum = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function stableId(prefix, corpId, index) {
  return `${prefix}-${corpId}-${index + 1}`;
}

// Phase 2 row PKs are global, but the in-memory gameplay ids (e.g. "bld-1",
// "lease-...", "ext-basic-1") are only unique per corp. Namespace every row
// id with the owning corp id so cross-corp inserts can't collide, and strip
// the prefix on hydrate so foreign-key references inside a corp's state
// (lease.extractorIds, extractor.leaseId) keep matching.
const ROW_ID_SEP = "::";
function wrapRowId(corpId, rawId) {
  const id = String(rawId || "");
  if (!corpId) return id;
  const prefix = `${corpId}${ROW_ID_SEP}`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}
function unwrapRowId(corpId, rowId) {
  const id = String(rowId || "");
  if (!corpId) return id;
  const prefix = `${corpId}${ROW_ID_SEP}`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}
// Backwards-compatible aliases retained in case anything imported them.
const buildExtractorRowId = wrapRowId;
const unwrapExtractorRowId = unwrapRowId;

export function mapAccountToBuildingRows(account) {
  const corpId = account?.id;
  const buildings = account?.state?.corp?.buildings;
  if (!corpId || !Array.isArray(buildings)) return [];
  return buildings.map((building, index) => ({
    id: wrapRowId(corpId, building?.id || stableId("bld", corpId, index)),
    corp_id: corpId,
    station_id: building?.stationId || null,
    name: String(building?.name || "Structure"),
    tier: toNum(building?.tier, 1),
    status: String(building?.status || "Operational"),
    built_at: building?.builtAt != null ? toNum(building.builtAt) : null,
    completes_at: building?.completesAt != null ? toNum(building.completesAt) : null
  }));
}

export function mapAccountToOfficeRows(account) {
  const corpId = account?.id;
  const offices = account?.state?.corp?.offices;
  if (!corpId || !Array.isArray(offices)) return [];
  return offices.map((office, index) => ({
    id: wrapRowId(corpId, office?.id || stableId("office", corpId, index)),
    corp_id: corpId,
    station_id: String(office?.stationId || "earth-station-prime"),
    body: office?.body || null,
    system_id: office?.systemId || null,
    name: office?.name || null,
    tier: toNum(office?.tier, 1),
    rented_at: office?.rentedAt != null ? toNum(office.rentedAt) : null,
    rented_until: office?.rentedUntil != null ? toNum(office.rentedUntil) : null,
    duration_days: office?.durationDays != null ? toNum(office.durationDays) : null
  }));
}

export function mapAccountToLeaseRows(account) {
  const corpId = account?.id;
  const leases = account?.state?.corp?.miningLeases;
  if (!corpId || !Array.isArray(leases)) return [];
  return leases.map((lease, index) => ({
    id: wrapRowId(corpId, lease?.id || stableId("lease", corpId, index)),
    corp_id: corpId,
    body: String(lease?.body || "Unknown"),
    lease_type: lease?.leaseType || null,
    cost: toNum(lease?.cost, 0),
    building_slots: toNum(lease?.buildingSlots, 0),
    issued_at: lease?.issuedAt != null ? toNum(lease.issuedAt) : null,
    expires_at: lease?.expiresAt != null ? toNum(lease.expiresAt) : null
  }));
}

export function mapAccountToExtractorRows(account) {
  const corpId = account?.id;
  const extractors = account?.state?.corp?.mining?.silicateExtractors;
  if (!corpId || !Array.isArray(extractors)) return [];
  // Build a leaseId -> body lookup so we can backfill the new extractor.body
  // column from the lease's body when the in-memory extractor only knows its
  // leaseId.
  const leases = Array.isArray(account?.state?.corp?.miningLeases) ? account.state.corp.miningLeases : [];
  const leaseBody = new Map(leases.map((l) => [String(l?.id || ""), l?.body || null]));
  return extractors.map((extractor, index) => ({
    id: wrapRowId(corpId, extractor?.id || stableId("ext", corpId, index)),
    corp_id: corpId,
    lease_id: extractor?.leaseId ? wrapRowId(corpId, extractor.leaseId) : null,
    body: extractor?.body || (extractor?.leaseId ? leaseBody.get(String(extractor.leaseId)) : null) || null,
    name: String(extractor?.name || `Basic Extractor Yard #${index + 1}`),
    tier: toNum(extractor?.tier, 1),
    active: Boolean(extractor?.active),
    started_at: extractor?.startedAt != null ? toNum(extractor.startedAt) : null,
    last_tick_at: extractor?.lastTickAt != null ? toNum(extractor.lastTickAt) : null,
    ends_at: extractor?.endsAt != null ? toNum(extractor.endsAt) : null,
    last_completed_at: extractor?.lastCompletedAt != null ? toNum(extractor.lastCompletedAt) : null,
    throughput_per_hour: toNum(extractor?.throughputPerHour, 0),
    operation_cost_per_hour: toNum(extractor?.operationCostPerHour, 0),
    total_mined: toNum(extractor?.totalMined, 0),
    total_spent: toNum(extractor?.totalSpent, 0),
    mined_remainder: toNum(extractor?.minedRemainder, 0),
    downtime_active: Boolean(extractor?.downtimeActive),
    downtime_started_at: extractor?.downtimeStartedAt != null ? toNum(extractor.downtimeStartedAt) : null,
    downtime_recovered_at: extractor?.downtimeRecoveredAt != null ? toNum(extractor.downtimeRecoveredAt) : null
  }));
}

export function applyInfrastructureRowsToAccount(account, rows) {
  if (!account?.state?.corp || !rows) return;

  const buildings = Array.isArray(rows.buildings) ? rows.buildings : [];
  const offices = Array.isArray(rows.offices) ? rows.offices : [];
  const leases = Array.isArray(rows.leases) ? rows.leases : [];
  const extractors = Array.isArray(rows.extractors) ? rows.extractors : [];

  account.state.corp.buildings = buildings.map((row) => ({
    id: unwrapRowId(account?.id, row.id),
    stationId: row.station_id ?? null,
    name: row.name,
    tier: toNum(row.tier, 1),
    status: row.status || "Operational",
    builtAt: row.built_at != null ? Number(row.built_at) : null,
    completesAt: row.completes_at != null ? Number(row.completes_at) : null
  }));

  account.state.corp.offices = offices.map((row) => ({
    id: unwrapRowId(account?.id, row.id),
    stationId: row.station_id,
    body: row.body,
    systemId: row.system_id,
    name: row.name,
    tier: toNum(row.tier, 1),
    rentedAt: row.rented_at != null ? Number(row.rented_at) : null,
    rentedUntil: row.rented_until != null ? Number(row.rented_until) : null,
    durationDays: row.duration_days != null ? Number(row.duration_days) : null
  }));

  account.state.corp.miningLeases = leases.map((row) => ({
    id: unwrapRowId(account?.id, row.id),
    body: row.body,
    leaseType: row.lease_type,
    cost: toNum(row.cost, 0),
    buildingSlots: toNum(row.building_slots, 0),
    issuedAt: row.issued_at != null ? Number(row.issued_at) : null,
    expiresAt: row.expires_at != null ? Number(row.expires_at) : null,
    extractorIds: []
  }));

  const leaseById = new Map(account.state.corp.miningLeases.map((lease) => [lease.id, lease]));
  const corpId = account?.id;
  const mappedExtractors = extractors.map((row, index) => {
    const mapped = {
      id: unwrapExtractorRowId(corpId, row.id),
      name: row.name || `Basic Extractor Yard #${index + 1}`,
      tier: toNum(row.tier, 1),
      active: Boolean(row.active),
      startedAt: row.started_at != null ? Number(row.started_at) : null,
      lastTickAt: row.last_tick_at != null ? Number(row.last_tick_at) : null,
      endsAt: row.ends_at != null ? Number(row.ends_at) : null,
      lastCompletedAt: row.last_completed_at != null ? Number(row.last_completed_at) : null,
      throughputPerHour: toNum(row.throughput_per_hour, 0),
      operationCostPerHour: toNum(row.operation_cost_per_hour, 0),
      totalMined: toNum(row.total_mined, 0),
      totalSpent: toNum(row.total_spent, 0),
      minedRemainder: toNum(row.mined_remainder, 0),
      leaseId: row.lease_id ? unwrapRowId(corpId, row.lease_id) : null,
      body: row.body || null,
      downtimeActive: Boolean(row.downtime_active),
      downtimeStartedAt: row.downtime_started_at != null ? Number(row.downtime_started_at) : null,
      downtimeRecoveredAt: row.downtime_recovered_at != null ? Number(row.downtime_recovered_at) : null
    };

    if (mapped.leaseId && leaseById.has(mapped.leaseId)) {
      leaseById.get(mapped.leaseId).extractorIds.push(mapped.id);
    }
    return mapped;
  });

  if (!account.state.corp.mining || typeof account.state.corp.mining !== "object") {
    account.state.corp.mining = {};
  }
  account.state.corp.mining.silicateExtractors = mappedExtractors;
  account.state.corp.mining.silicateExtractor = mappedExtractors[0] || null;
}

async function replaceTableRowsByCorp(tableName, corpId, rows) {
  if (!supabaseAdmin) return;
  const { error: deleteError } = await supabaseAdmin.from(tableName).delete().eq("corp_id", corpId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error: insertError } = await supabaseAdmin.from(tableName).insert(rows);
  if (insertError) throw insertError;
}

async function deleteTableRowsByCorp(tableName, corpId) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from(tableName).delete().eq("corp_id", corpId);
  if (error) throw error;
}

async function insertTableRows(tableName, rows) {
  if (!supabaseAdmin || !rows.length) return;
  const { error } = await supabaseAdmin.from(tableName).insert(rows);
  if (error) throw error;
}

export async function replaceInfrastructureRows(corpId, rowsByTable) {
  if (!supabaseAdmin) return;

  // Delete child-first, then insert parent-first so extractor.lease_id always
  // references an existing lease row.
  await deleteTableRowsByCorp("corp_extractors", corpId);
  await deleteTableRowsByCorp("corp_buildings", corpId);
  await deleteTableRowsByCorp("corp_offices", corpId);
  await deleteTableRowsByCorp("corp_mining_leases", corpId);

  await insertTableRows("corp_buildings", rowsByTable.buildings || []);
  await insertTableRows("corp_offices", rowsByTable.offices || []);
  await insertTableRows("corp_mining_leases", rowsByTable.leases || []);
  await insertTableRows("corp_extractors", rowsByTable.extractors || []);
}

async function loadRowsByCorp(tableName, orderColumn) {
  if (!supabaseAdmin) return new Map();
  let query = supabaseAdmin.from(tableName).select("*");
  if (orderColumn) {
    query = query.order(orderColumn, { ascending: true });
  }
  const { data, error } = await query;
  if (error) throw error;

  const byCorpId = new Map();
  for (const row of data || []) {
    if (!byCorpId.has(row.corp_id)) {
      byCorpId.set(row.corp_id, []);
    }
    byCorpId.get(row.corp_id).push(row);
  }
  return byCorpId;
}

export const loadAllBuildings = () => loadRowsByCorp("corp_buildings", "id");
export const loadAllOffices = () => loadRowsByCorp("corp_offices", "id");
export const loadAllLeases = () => loadRowsByCorp("corp_mining_leases", "id");
export const loadAllExtractors = () => loadRowsByCorp("corp_extractors", "id");
