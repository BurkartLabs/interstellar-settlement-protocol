// server/db/repositories/corporationRepo.js
// Maps an in-memory account → a `corporations` row, and applies a row back
// onto an account's state. corp_id is intentionally identical to account_id
// (1:1 relationship enforced by the schema's `account_id unique`).

import { supabaseAdmin } from "../supabaseClient.js";

export function mapAccountToCorpRow(account) {
  const corp = account?.state?.corp || {};
  const profile = account?.state?.playerProfile || {};
  return {
    id: account.id,
    account_id: account.id,
    name: String(corp.corporationName || "Unnamed Corporation"),
    ceo_name: String(corp.ceo || "Unknown CEO"),
    level: Number.isFinite(Number(corp.level)) ? Number(corp.level) : 0,
    level_cap: Number.isFinite(Number(corp.levelCap)) ? Number(corp.levelCap) : 40,
    employee_cap: Number.isFinite(Number(corp.employeeCap)) ? Number(corp.employeeCap) : 0,
    employee_count: Number.isFinite(Number(corp.employeeCount)) ? Number(corp.employeeCount) : 0,
    building_slots: Number.isFinite(Number(corp.buildingSlots)) ? Number(corp.buildingSlots) : 0,
    current_station_id: corp.currentStationId || null,
    current_system_id: corp.currentSystemId || null,
    location: corp.location || null,
    is_new_player: Boolean(profile.isNewPlayer),
    registered_at: Number.isFinite(Number(profile.registeredAt)) ? Number(profile.registeredAt) : null,
    updated_at: new Date().toISOString()
  };
}

/** Apply a hydrated corporations row over the corp/playerProfile sub-objects. */
export function applyCorpRowToAccount(account, row) {
  if (!row || !account?.state) return;
  const corp = (account.state.corp ||= {});
  corp.corporationName = row.name ?? corp.corporationName;
  corp.ceo = row.ceo_name ?? corp.ceo;
  corp.level = row.level ?? corp.level;
  corp.levelCap = row.level_cap ?? corp.levelCap;
  corp.employeeCap = row.employee_cap ?? corp.employeeCap;
  corp.employeeCount = row.employee_count ?? corp.employeeCount;
  corp.buildingSlots = row.building_slots ?? corp.buildingSlots;
  corp.currentStationId = row.current_station_id ?? corp.currentStationId;
  corp.currentSystemId = row.current_system_id ?? corp.currentSystemId;
  corp.location = row.location ?? corp.location;

  const profile = (account.state.playerProfile ||= {});
  profile.isNewPlayer = Boolean(row.is_new_player);
  if (row.registered_at != null) profile.registeredAt = Number(row.registered_at);
}

export async function upsertCorporations(rows) {
  if (!supabaseAdmin || !rows.length) return;
  const { error } = await supabaseAdmin
    .from("corporations")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function loadAllCorporations() {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin
    .from("corporations")
    .select(
      "id, account_id, name, ceo_name, level, level_cap, employee_cap, employee_count, building_slots, current_station_id, current_system_id, location, is_new_player, registered_at"
    );
  if (error) throw error;
  const byAccountId = new Map();
  for (const row of data || []) {
    byAccountId.set(row.account_id, row);
  }
  return byAccountId;
}
