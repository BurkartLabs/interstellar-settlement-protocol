// ISP-220 (AB#915): move the v0.12 playthrough's saved world past what only time or other players can do, with the
// server stopped. Each step says what it stands in for; everything else in the playthrough is done in the UI.
// - level:   three days pass at level 1, and two filler corporations join (level 2 needs 4 of 5 members, 3 days).
// - station: the conglomerate stands at level 4 (the ladder takes 11 days and 16 members; it is bought in the UI once,
//            at level 2, and set here for the rest), so a station project can be filed.
// - open:    the funded project's 14 days of construction pass.
// Usage: node e2e/v012-fast-forward.mjs <dataDir> <level|station|open>
const [, , dataDir, step] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "construction-panel-e2e-fixture-secret-0123";
process.env.NODE_ENV = "test";

const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const { conglomerateList } = await import("../server/game/conglomerates.js");
const DAY = 86_400_000;
const c = conglomerateList().find((x) => !x.dissolvedAt);
if (!c) throw new Error("no conglomerate to fast-forward: found one in the UI first");
const fillers = Object.values(accountsStore.accounts).filter((a) => /^Filler Holdings/.test(a.state?.corp?.corporationName || "") && !a.state.corp.conglomerateId);
const join = (n) => {
  for (const a of fillers.slice(0, n)) {
    c.members.push({ corp: a.state.corp.publicId, role: "member", joinedAt: Date.now() - 4 * DAY });
    a.state.corp.conglomerateId = c.id;
  }
};

if (step === "level") {
  join(Math.max(0, 4 - c.members.length));
  for (const key of ["foundedAt", "levelSince"]) if (c[key]) c[key] -= 4 * DAY;
} else if (step === "station") {
  join(Math.max(0, 16 - c.members.length));
  c.level = 4;
  c.maxMembers = 20;
  c.levelSince = Date.now() - 6 * DAY;
} else if (step === "open") {
  const p = c.stationProject;
  if (!p || p.state !== "building") throw new Error(`no funded project to open (${p?.state ?? "none"})`);
  p.completesAt = Date.now() - 1;
} else throw new Error(`unknown step ${step}`);
await store.saveAccountsNow();
console.log(`fast-forwarded: ${step}`);
