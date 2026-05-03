// server/db/repositories/financeRepo.js
// Per-corp finance rollup. Liquidity columns are reserved for a future
// feature; they're zero by default and we don't read them back yet.

import { supabaseAdmin } from "../supabaseClient.js";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function mapAccountToFinanceRow(account) {
  const f = account?.state?.corp?.finances || {};
  return {
    corp_id: account.id,
    credits: num(f.credits),
    liabilities: num(f.liabilities),
    assets: num(f.assets),
    daily_revenue: num(f.dailyRevenue),
    daily_costs: num(f.dailyCosts),
    liquidity: num(f.liquidity),
    liquidity_cap: num(f.liquidityCap),
    liquidity_regen_per_hour: num(f.liquidityRegenPerHour),
    last_liquidity_tick: f.lastLiquidityTick != null ? num(f.lastLiquidityTick, null) : null,
    tax_rate_pct: num(f.taxRatePct, 14),
    bond_yield_pct: num(f.bondYieldPct, 0),
    exchange_sales_tax_pct: num(f.exchangeSalesTaxPct, 8)
  };
}

export function applyFinanceRowToAccount(account, row) {
  if (!row || !account?.state?.corp) return;
  const f = (account.state.corp.finances ||= {});
  f.credits = num(row.credits, f.credits);
  f.liabilities = num(row.liabilities, f.liabilities);
  f.assets = num(row.assets, f.assets);
  f.dailyRevenue = num(row.daily_revenue, f.dailyRevenue);
  f.dailyCosts = num(row.daily_costs, f.dailyCosts);
  f.taxRatePct = num(row.tax_rate_pct, f.taxRatePct);
  f.bondYieldPct = num(row.bond_yield_pct, f.bondYieldPct);
  f.exchangeSalesTaxPct = num(row.exchange_sales_tax_pct, f.exchangeSalesTaxPct);
  // Liquidity fields kept on the corp for forward-compat; harmless if zero.
  f.liquidity = num(row.liquidity, f.liquidity ?? 0);
  f.liquidityCap = num(row.liquidity_cap, f.liquidityCap ?? 0);
  f.liquidityRegenPerHour = num(row.liquidity_regen_per_hour, f.liquidityRegenPerHour ?? 0);
  if (row.last_liquidity_tick != null) f.lastLiquidityTick = Number(row.last_liquidity_tick);
}

export async function upsertFinances(rows) {
  if (!supabaseAdmin || !rows.length) return;
  const { error } = await supabaseAdmin
    .from("corp_finances")
    .upsert(rows, { onConflict: "corp_id" });
  if (error) throw error;
}

export async function loadAllFinances() {
  if (!supabaseAdmin) return new Map();
  const { data, error } = await supabaseAdmin.from("corp_finances").select("*");
  if (error) throw error;
  const byCorpId = new Map();
  for (const row of data || []) byCorpId.set(row.corp_id, row);
  return byCorpId;
}
