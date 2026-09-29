// ISP-244 (AB#940): move the v0.13 playthrough's saved world past what only time can do, with the server stopped.
// Each step moves a stored clock back by the wait it stands for and runs the tick the server would run, so what
// happens next is the game's own code, not numbers written here. Everything else in the playthrough is done in the page.
// - review:   the concession petition's 72-hour review passes (concessionReviewHours).
// - notice:   a tariff increase's and a lease discount's 72-hour notice pass (tariffs.noticeHours,
//             concessionLeaseModifierNoticeHours).
// - travel:   every jump or docking run under way arrives (corp.travel.arrivesAt); the server's travel tick lands it.
// - research: Bright's queued research finishes (its duration passes); the server's R&D tick completes it on restart.
// - dump:     the day of Bright's cheap sales ends, so the ITC's 00:00 UTC watch reads it (sales move back one day).
// - levy:     the finding's 24 hours pass before its duty is levied (dumping.levyAfterHours).
// - pledges:  the lobbying campaign's 72-hour pledge window closes (lobbying.pledgeHours).
// - standin:  STAND-IN, not a time wait: a copy of Bright's own tariff-paying sale, charged at the system's 5% cap while
//             the rate in force was lower. The game should never charge this; it is the overcharge a tariff case
//             exists for, so the Council's upheld-and-enforced path can be seen. It is labelled in the trade history.
// - rule:     the arbitration cases' 72-hour response windows pass, to the Council's next 00:00 UTC ruling.
// Usage: node e2e/v013-fast-forward.mjs <dataDir> <step[,step...]> [brightPublicId]
const [, , dataDir, steps, brightPublicId] = process.argv;
process.env.ISP_DATA_DIR = dataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || "v013-play-e2e-fixture-secret-0123456789ab";
process.env.NODE_ENV = "test";
process.env.ISP_DISABLE_TICKERS = "1";

const H = 3_600_000, DAY = 24 * H;
const now = Date.now();
const store = await import("../server/gameState.js");
const { accountsStore } = await import("../server/game/store.js");
const back = (obj, keys, by) => { for (const k of keys) if (Number.isFinite(obj?.[k])) obj[k] -= by; };
const brightAccount = () => Object.values(accountsStore.accounts).find((a) => a.state?.corp?.publicId === brightPublicId);

async function run(step) {
  const done = (what) => { process.stdout.write(`${JSON.stringify({ step, ...what })}\n`); };
  if (step === "review") {
    const c = await import("../server/concessions.js");
    let moved = 0;
    c.dataStore.rewrite((s) => { for (const rec of Object.values(s.systems || {})) for (const p of rec.petitions || []) if (p.state === "open") { back(p, ["filedAt", "reviewEndsAt"], 73 * H); moved += 1; } });
    const granted = c.reviewConcessions(now);
    c.dataStore.rewrite(() => {}); // reviewConcessions changes the store; concessionTick is what saves it
    return done({ moved, granted });
  }
  if (step === "notice") {
    const c = await import("../server/concessions.js");
    const t = await import("../server/tariffService.js");
    let moved = 0;
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (Number.isFinite(o.effectiveAt) && o.effectiveAt > now) { o.effectiveAt = now - 60_000; moved += 1; }
      for (const v of Object.values(o)) walk(v);
    };
    c.dataStore.rewrite(walk);
    t.dataStore.rewrite(walk);
    t.tariffTick(now);
    c.dataStore.rewrite(() => {});
    t.dataStore.rewrite(() => {});
    return done({ moved });
  }
  if (step === "travel") {
    let moved = 0;
    for (const account of Object.values(accountsStore.accounts)) {
      const travel = account.state?.corp?.travel;
      if (travel?.arrivesAt > now - 1000) { travel.arrivesAt = now - 1000; moved += 1; }
    }
    await store.saveAccountsNow();
    return done({ moved });
  }
  if (step === "research") {
    const queue = brightAccount().state.queues?.corporateRnD || [];
    for (const item of queue) back(item, ["startedAt", "endsAt", "completesAt", "scheduledEndAt"], (Number(item.durationHours) || 24) * H + 60_000);
    await store.saveAccountsNow();
    return done({ moved: queue.length });
  }
  if (step === "dump" || step === "levy") {
    const itc = await import("../server/itcService.js");
    let moved = 0;
    itc.dataStore.rewrite((s) => {
      s.watchedDay = null;
      if (step === "dump") for (const sale of s.sales || []) if (!sale.findingId && sale.corp === brightPublicId) { back(sale, ["at"], DAY); moved += 1; }
      if (step === "levy") for (const f of s.findings || []) if (!f.leviedAt) { back(f, ["openedAt"], 25 * H); moved += 1; }
    });
    const r = itc.itcTick(now);
    itc.dataStore.rewrite(() => {});
    await store.saveAccountsNow();
    return done({ moved, ...r });
  }
  if (step === "pledges") {
    const l = await import("../server/lobbyingService.js");
    let moved = 0;
    l.dataStore.rewrite((s) => { for (const c of s.campaigns || []) if (!c.result) { back(c, ["opensAt"], 73 * H); c.closesAt = now - 60_000; moved += 1; } });
    l.lobbyingTick(now);
    l.dataStore.rewrite(() => {});
    await store.saveAccountsNow();
    return done({ moved });
  }
  if (step === "standin") {
    const account = brightAccount();
    const real = (account.state.corp.tradeHistory || []).find((r) => r.tariffAmount > 0 && r.tariffRecord?.to?.length);
    if (!real) throw new Error("Bright has no tariff-paying sale to copy: sell in Tau Ceti first");
    const rec = { ...real.tariffRecord, pct: 5, postedPct: 5, amount: Math.round(real.tariffRecord.base * 0.05), at: real.tariffRecord.at + 1000 };
    const copy = { ...real, id: `${real.id}-standin-overcharge`, tariffPct: 5, tariffAmount: rec.amount, tariffRecord: rec, note: "QA stand-in (AB#940): an overcharge the game should never make" };
    account.state.corp.tradeHistory.unshift(copy);
    await store.saveAccountsNow();
    return done({ copied: real.id, chargedPct: 5, realPct: real.tariffPct });
  }
  if (step === "rule") {
    const a = await import("../server/arbitration.js");
    let moved = 0;
    a.dataStore.rewrite((s) => { for (const c of s.cases || []) if (c.state === "answering") { back(c, ["filedAt", "windowEndsAt"], 4 * DAY); moved += 1; } });
    a.arbitrationTick(now);
    a.arbitrationTick(now); // enforcement runs on the tick after a ruling
    a.dataStore.rewrite(() => {});
    await store.saveAccountsNow();
    return done({ moved, states: (a.dataStore.read().cases || []).map((c) => `${c.ref}:${c.state}`) });
  }
  throw new Error(`unknown step ${step}`);
}

for (const step of String(steps).split(",")) await run(step);
process.exit(0);
