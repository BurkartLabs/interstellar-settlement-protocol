// server/db/repositories/unlocksRepo.js
// Scalar unlocks (max_upgrade_tier / max_fleet_size / max_basic_extractor_yards).
// The marketSectors *array* lives in the sets repo.

import { supabaseAdmin } from "../supabaseClient.js";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function mapAccountToUnlocksRow(account) {
  const u = account?.state?.corp?.unlocks || {};
  return {
    corp_id: account.id,
    max_upgrade_tier: num(u.maxUpgradeTier, 1),
    max_fleet_size: num(u.maxFleetSize, 0),
    max_basic_extractor_yards: num(u.maxBasicExtractorYards, 1)
  };
}

export function applyUnlocksRowToAccount(account, row) {
  if (!row || !account?.state?.corp) return;
  const u = (account.state.corp.unlocks ||= {});
  u.maxUpgradeTier = num(row.max_upgrade_tier, u.maxUpgradeTier ?? 1);
  u.maxFleetSize = num(row.max_fleet_size, u.maxFleetSize ?? 0);
  u.maxBasicExtractorYards = num(row.max_basic_extractor_yards, u.maxBasicExtractorYards ?? 1);
}

export async function upsertUnlocks(rows) {
  if (!supabaseAdmin || !rows.length) return;
  const { error } = await supabaseAdmin
    .from("corp_unlocks")
    .upsert(rows, { onConflict: "corp_id" });
  if (error) throw error;
}

export async function loadAllUnlocks() {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin.from("corp_unlocks").select("*");
  if (error) throw error;
  const byCorpId = new Map();
  for (const row of data || []) byCorpId.set(row.corp_id, row);
  return byCorpId;
}
