// server/db/supabaseClient.js
// Single source of truth for the Supabase admin client + persistence flags.
// gameState.js historically created its own client; this module mirrors that
// configuration so the new repository layer doesn't fight the legacy code.
//
// Flags:
//   USE_SUPABASE             — true iff URL + service-role key are set.
//   USE_SUPABASE_AUTH        — true iff anon key is also set (Supabase-managed auth).
//   USE_NORMALIZED_TABLES    — opt-in for the normalized schema migration.
//                              Default: false. Set USE_NORMALIZED_TABLES=true
//                              in env to enable dual-write + cutover reads for
//                              the Phase 1 domains (corporations, finances,
//                              military, unlocks, sets).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
export const USE_SUPABASE_AUTH = Boolean(USE_SUPABASE && SUPABASE_ANON_KEY);

const NORMALIZED_FLAG = String(process.env.USE_NORMALIZED_TABLES || "").trim().toLowerCase();
export const USE_NORMALIZED_TABLES =
  USE_SUPABASE && (NORMALIZED_FLAG === "1" || NORMALIZED_FLAG === "true" || NORMALIZED_FLAG === "yes");

export const supabaseAdmin = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
