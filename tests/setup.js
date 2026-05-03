// Ensure deterministic, isolated test environment.
// Force-blank any Supabase / JWT env vars so server/gameState.js falls back to
// pure in-memory mode and never attempts a real network call.
//
// IMPORTANT: we set these to "" rather than `delete`-ing them. server/gameState.js
// imports server/loadEnv.js which re-reads `.env` and only skips keys that are
// already defined (`process.env[key] !== undefined`). A deleted key is undefined,
// so it would be silently repopulated from `.env` — which now contains real
// Supabase credentials and would cause integration tests to hammer the live DB.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
process.env.USE_NORMALIZED_TABLES = "";

// Pretend we're serverless so scheduleSave()/scheduleAccountsSave() short-circuit
// instead of writing to data/state.json during tests. (gameState.js checks
// `process.env.VERCEL` at module load to set IS_SERVERLESS = true.)
process.env.VERCEL = "1";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod";
// Tests import server/index.js for supertest / socket tests. This flag stops
// the 8 setInterval ticker registrations so the test process can exit cleanly.
process.env.ISP_DISABLE_TICKERS = "1";
// Allow the dummy-login routes during tests.
process.env.ALLOW_DUMMY_AUTH = "1";

