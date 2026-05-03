// server/db/repositories/setsRepo.js
// Three small junction tables that mirror in-memory string-arrays:
//   corp_unlocked_market_sectors  (corp.unlocks.marketSectors)
//   corp_unlocked_tech            (corp.unlockedTech)
//   corp_milestones_completed     (corp.milestonesCompleted)
//
// Strategy: replace-by-corp. We delete this corp's existing rows, then insert
// the current set. That keeps the code trivial and the in-memory model
// (a string[]) as the source of truth during the cutover.

import { supabaseAdmin } from "../supabaseClient.js";

export function mapAccountToMarketSectorRows(account) {
  const sectors = account?.state?.corp?.unlocks?.marketSectors;
  if (!Array.isArray(sectors)) return [];
  return sectors
    .filter((s) => typeof s === "string" && s.length > 0)
    .map((sector) => ({ corp_id: account.id, sector }));
}

export function mapAccountToUnlockedTechRows(account) {
  const tech = account?.state?.corp?.unlockedTech;
  if (!Array.isArray(tech)) return [];
  return tech
    .filter((t) => typeof t === "string" && t.length > 0)
    .map((tech_id) => ({ corp_id: account.id, tech_id, unlocked_at: null }));
}

export function mapAccountToMilestoneRows(account) {
  const milestones = account?.state?.corp?.milestonesCompleted;
  if (!Array.isArray(milestones)) return [];
  return milestones
    .filter((m) => typeof m === "string" && m.length > 0)
    .map((milestone) => ({ corp_id: account.id, milestone, completed_at: null }));
}

export function applyMarketSectorsToAccount(account, sectors) {
  if (!account?.state?.corp) return;
  const u = (account.state.corp.unlocks ||= {});
  u.marketSectors = Array.isArray(sectors) ? Array.from(new Set(sectors)) : [];
}

export function applyUnlockedTechToAccount(account, techIds) {
  if (!account?.state?.corp) return;
  account.state.corp.unlockedTech = Array.isArray(techIds) ? Array.from(new Set(techIds)) : [];
}

export function applyMilestonesToAccount(account, milestones) {
  if (!account?.state?.corp) return;
  account.state.corp.milestonesCompleted = Array.isArray(milestones)
    ? Array.from(new Set(milestones))
    : [];
}

async function replaceByCorp(table, corpId, rows) {
  if (!supabaseAdmin) return;
  const { error: deleteError } = await supabaseAdmin.from(table).delete().eq("corp_id", corpId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error: insertError } = await supabaseAdmin.from(table).insert(rows);
  if (insertError) throw insertError;
}

export async function replaceMarketSectors(corpId, rows) {
  await replaceByCorp("corp_unlocked_market_sectors", corpId, rows);
}
export async function replaceUnlockedTech(corpId, rows) {
  await replaceByCorp("corp_unlocked_tech", corpId, rows);
}
export async function replaceMilestones(corpId, rows) {
  await replaceByCorp("corp_milestones_completed", corpId, rows);
}

async function loadGroupedByCorp(table, valueColumn) {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin.from(table).select(`corp_id, ${valueColumn}`);
  if (error) throw error;
  const byCorpId = new Map();
  for (const row of data || []) {
    if (!byCorpId.has(row.corp_id)) byCorpId.set(row.corp_id, []);
    byCorpId.get(row.corp_id).push(row[valueColumn]);
  }
  return byCorpId;
}

export const loadAllMarketSectors = () => loadGroupedByCorp("corp_unlocked_market_sectors", "sector");
export const loadAllUnlockedTech = () => loadGroupedByCorp("corp_unlocked_tech", "tech_id");
export const loadAllMilestones = () => loadGroupedByCorp("corp_milestones_completed", "milestone");
