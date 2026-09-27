import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, getAllAccountIds, mutateAccountState } from "../../server/gameState.js";
import { SHARE_TERMS, migrateShareRegistries, newShareRegistry, publicCapTable, registryProblems } from "../../server/shareRegistry.js";

// ISP-157 (AB#851): every corporation's share registry (docs/design/v0.9-equity.md, section 1): a fixed 100,000 shares,
// the founder's 10,000 from creation, the rest unissued; a one-off migration for existing accounts; and the public cap
// table. Nothing in this story sells a share.
const ROOT = path.resolve(import.meta.dirname, "../..");
let app;
beforeAll(async () => { ({ app } = await getApp()); });

/** The invariant, over every corporation in the store: run after every mutation in this suite. */
function everyRegistryHolds() {
  const bad = [];
  for (const id of getAllAccountIds()) {
    const corp = getAccountById(id)?.state?.corp;
    if (!corp) continue;
    const problems = registryProblems(corp.shareRegistry);
    if (problems.length) bad.push(`${corp.corporationName}: ${problems.join("; ")}`);
  }
  return bad;
}
afterEach(() => { expect(everyRegistryHolds()).toEqual([]); });

describe("ISP-157 the terms", () => {
  it("are the design's (P-TWO-SOURCES)", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs/design/v0.9-equity.md"), "utf8").replace(/\r\n/g, "\n");
    const row = (field) => doc.match(new RegExp(`^\\| \`${field}\` \\| [^|]+ \\| (.+) \\|$`, "m"))[1];
    expect(row("authorized")).toContain(`**${SHARE_TERMS.authorized.toLocaleString("en-US")}**, fixed for every corporation`);
    expect(row("founderShares")).toMatch(new RegExp(`^${SHARE_TERMS.founderShares.toLocaleString("en-US")}, issued to the founder at creation`));
    expect(row("unissued")).toContain(`starts at ${(SHARE_TERMS.authorized - SHARE_TERMS.founderShares).toLocaleString("en-US")}`);
    const p = SHARE_TERMS.payoutRatioPct;
    expect(row("payoutRatioPct")).toContain(`${p.min} to ${p.max}, step ${p.step}; default ${p.default}`);
    expect(doc).toContain("`founderShares + sum(holders[].shares) + unissued = 100,000`");
  });
});

describe("ISP-157 a new corporation", () => {
  it("is created with its registry: the founder's 10,000 of 100,000, the rest unissued, private", async () => {
    const { account } = await registerAccount(app);
    const r = getAccountById(account.id).state.corp.shareRegistry;
    expect(r).toEqual(newShareRegistry());
    expect(r).toMatchObject({ authorized: 100_000, founderShares: 10_000, unissued: 90_000, holders: [], state: "private", payoutRatioPct: 25 });
    expect(registryProblems(r)).toEqual([]);
  });
});

describe("ISP-157 the migration", () => {
  it("adds a registry to every corporation without one, and run twice changes nothing more", async () => {
    const a = await registerAccount(app), b = await registerAccount(app);
    for (const x of [a, b]) mutateAccountState(x.account.id, (s) => { delete s.corp.shareRegistry; }, { sanitize: false, settleMining: false });
    const accounts = Object.fromEntries(getAllAccountIds().map((id) => [id, getAccountById(id)]));
    expect(migrateShareRegistries(accounts)).toBeGreaterThanOrEqual(2);
    const once = JSON.stringify(accounts[a.account.id].state.corp.shareRegistry);
    expect(migrateShareRegistries(accounts)).toBe(0); // idempotent
    expect(JSON.stringify(accounts[a.account.id].state.corp.shareRegistry)).toBe(once);
    expect(accounts[b.account.id].state.corp.shareRegistry).toEqual(newShareRegistry());
    // the store hands out copies: write the migrated registries back, as the loader's migration does in place
    for (const x of [a, b]) mutateAccountState(x.account.id, (st) => { st.corp.shareRegistry = accounts[x.account.id].state.corp.shareRegistry; }, { sanitize: false, settleMining: false });
  });

  it("runs when the store loads a save, as the other one-off backfills do", () => {
    const store = fs.readFileSync(path.join(ROOT, "server/game/store.js"), "utf8");
    expect(store).toMatch(/\nif \(migrateShareRegistries\(accountsStore\.accounts\)\) scheduleAccountsSave\(\);/);
  });

  it("leaves a registry that exists exactly as it is", () => {
    const kept = { ...newShareRegistry(), unissued: 89_000, holders: [{ holder: { kind: "corp", corpId: "corp-x" }, shares: 1_000, costBasis: 5_000, dividendsReceived: 0, acquiredAt: 1 }] };
    const accounts = { x: { state: { corp: { shareRegistry: kept } } }, y: { state: {} } };
    expect(migrateShareRegistries(accounts)).toBe(0);
    expect(accounts.x.state.corp.shareRegistry).toBe(kept);
  });
});

describe("ISP-157 the invariant", () => {
  it("names each way a registry can be wrong", () => {
    const ok = newShareRegistry();
    expect(registryProblems(ok)).toEqual([]);
    expect(registryProblems({ ...ok, unissued: 89_999 }).join()).toMatch(/is not 100000/);
    expect(registryProblems({ ...ok, authorized: 200_000 }).join()).toMatch(/authorized is 200000/);
    expect(registryProblems({ ...ok, holders: [{ holder: { kind: "corp", corpId: "c" }, shares: 0 }] }).join()).toMatch(/a holding has 0 shares/);
    expect(registryProblems({ ...ok, payoutRatioPct: 27 }).join()).toMatch(/payoutRatioPct is 27/);
    expect(registryProblems(undefined)).toEqual(["there is no share registry"]);
  });
});

describe("ISP-157 the cap table route", () => {
  it("needs a login; unknown and malformed ids are 404", async () => {
    const { account, accessToken } = await registerAccount(app);
    const corpId = getAccountById(account.id).state.corp.publicId;
    expect((await request(app).get(`/api/corporations/${corpId}/cap-table`)).status).toBe(401);
    const api = authed(app, accessToken);
    for (const bad of ["corp-does-not-exist", "x".repeat(300), "%00", account.id]) {
      expect((await api.get(`/api/corporations/${encodeURIComponent(bad)}/cap-table`)).status, bad).toBe(404);
    }
  });

  it("gives holder corporation names and percentages, never an account id or an e-mail", async () => {
    const issuer = await registerAccount(app), holder = await registerAccount(app), viewer = await registerAccount(app);
    const corp = () => getAccountById(issuer.account.id).state.corp;
    const holderCorp = getAccountById(holder.account.id).state.corp;
    const api = authed(app, viewer.accessToken);
    const r1 = await api.get(`/api/corporations/${corp().publicId}/cap-table`);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ corpId: corp().publicId, corporationName: corp().corporationName, authorized: 100_000, outstanding: 10_000, unissued: 90_000, state: "private", holders: [{ name: corp().corporationName, kind: "founder", shares: 10_000, pct: 100 }] });

    // a holder as ISP-158 will write one (by hand here, keeping the invariant), to see how the table names it
    mutateAccountState(issuer.account.id, (s) => {
      s.corp.shareRegistry.unissued -= 2_500;
      s.corp.shareRegistry.holders.push({ holder: { kind: "corp", corpId: holderCorp.publicId }, shares: 2_000, costBasis: 0, dividendsReceived: 0, acquiredAt: 1 });
      s.corp.shareRegistry.holders.push({ holder: { kind: "npc", id: "igsx-mm" }, shares: 500, costBasis: 0, dividendsReceived: 0, acquiredAt: 1 });
    }, { sanitize: false, settleMining: false });
    const r2 = await api.get(`/api/corporations/${corp().publicId}/cap-table`);
    expect(r2.body.outstanding).toBe(12_500);
    expect(r2.body.holders).toEqual([
      { name: corp().corporationName, kind: "founder", shares: 10_000, pct: 80 },
      { name: holderCorp.corporationName, kind: "corporation", shares: 2_000, pct: 16 },
      { name: "Intergalactic Stock Exchange", kind: "market-maker", shares: 500, pct: 4 }
    ]);
    const text = JSON.stringify(r2.body);
    for (const secret of [issuer.account.id, holder.account.id, holderCorp.publicId, getAccountById(issuer.account.id).email, getAccountById(holder.account.id).email]) {
      expect(text).not.toContain(secret);
    }
    // put it back, for the invariant and the next test
    mutateAccountState(issuer.account.id, (s) => { s.corp.shareRegistry = newShareRegistry(); }, { sanitize: false, settleMining: false });
  });

  it("publicCapTable is pure: it reads the registry and changes nothing", () => {
    const corp = { publicId: "corp-p", corporationName: "Pure Co", shareRegistry: newShareRegistry() };
    const before = JSON.stringify(corp);
    expect(publicCapTable(corp).holders).toHaveLength(1);
    expect(JSON.stringify(corp)).toBe(before);
  });
});

describe("ISP-157 shares move only where ISP-158 moves them", () => {
  it("the only routes that change shares are the offering's three; only the equity modules write a registry", () => {
    const routes = [];
    for (const layer of app._router.stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) routes.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
    const equity = routes.filter((r) => /share|cap-table|equity|stock/i.test(r));
    expect(equity).toContain("GET /api/corporations/:corpId/cap-table");
    // AB#852: listing, opening an offering and buying in one (server/shareOfferings.js); AB#854: the exit to the market
    // maker; nothing else
    expect(equity.filter((r) => !r.startsWith("GET ")).sort()).toEqual([
      "POST /api/accounts/:accountId/equity/holdings/:issuerCorpId/exit",
      "POST /api/accounts/:accountId/equity/list",
      "POST /api/accounts/:accountId/equity/offerings",
      "POST /api/accounts/:accountId/equity/offerings/:offeringId/buy"
    ]);

    // outside the equity modules, the registry is only created (the factory), migrated (the loader) and read
    const writers = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".js") && !p.endsWith(`${path.sep}shareRegistry.js`) && !p.endsWith(`${path.sep}shareOfferings.js`)) {
          for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            if (/shareRegistry\.(holders|founderShares|unissued|authorized|state)\s*(=|\+=|-=|\.push|\.splice)|shareRegistry\s*=(?!=)/.test(line)) writers.push(`${path.relative(ROOT, p).split(path.sep).join("/")}: ${line.trim()}`);
          }
        }
      }
    };
    walk(path.join(ROOT, "server"));
    expect(writers).toEqual(["server/game/corporation.js: next.corp.shareRegistry = newShareRegistry(); // ISP-157 (AB#851): the founder owns it all from the first day"]);
  });
});
