// server/db/repositories/militaryRepo.js

import { supabaseAdmin } from "../supabaseClient.js";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function mapAccountToMilitaryRow(account) {
  const m = account?.state?.corp?.military || {};
  const mods = m.modifiers || {};
  return {
    corp_id: account.id,
    light_fighters: num(m.lightFighters),
    destroyers: num(m.destroyers),
    siege_engines: num(m.siegeEngines),
    attack_value: num(m.attackValue),
    defense_value: num(m.defenseValue),
    rd_bonus_pct: num(mods.rdBonusPct),
    ceo_leadership_pct: num(mods.ceoLeadershipPct)
  };
}

export function applyMilitaryRowToAccount(account, row) {
  if (!row || !account?.state?.corp) return;
  const m = (account.state.corp.military ||= {});
  m.lightFighters = num(row.light_fighters, m.lightFighters);
  m.destroyers = num(row.destroyers, m.destroyers);
  m.siegeEngines = num(row.siege_engines, m.siegeEngines);
  m.attackValue = num(row.attack_value, m.attackValue);
  m.defenseValue = num(row.defense_value, m.defenseValue);
  const mods = (m.modifiers ||= {});
  mods.rdBonusPct = num(row.rd_bonus_pct, mods.rdBonusPct);
  mods.ceoLeadershipPct = num(row.ceo_leadership_pct, mods.ceoLeadershipPct);
}

export async function upsertMilitary(rows) {
  if (!supabaseAdmin || !rows.length) return;
  const { error } = await supabaseAdmin
    .from("corp_military")
    .upsert(rows, { onConflict: "corp_id" });
  if (error) throw error;
}

export async function loadAllMilitary() {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin.from("corp_military").select("*");
  if (error) throw error;
  const byCorpId = new Map();
  for (const row of data || []) byCorpId.set(row.corp_id, row);
  return byCorpId;
}
