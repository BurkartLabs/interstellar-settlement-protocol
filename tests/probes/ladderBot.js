// The ladder bot (ISP-107, AB#799): a corporation that climbs the level ladder the cheapest way it can find, through
// the game's own HTTP routes and exported tick functions only. It never writes corp.level, corp.stats or corp.unlocks;
// every change it makes is a request a player could send. DEPTH.md epic 1 asked for exactly this: a bot that
// satisfies every requirement of every level reaches the documented maximum (T-019: schema tests passed while the
// ladder stopped at Level 5).
//
// It is a measuring instrument, and its numbers are BOT NUMBERS (P-PROXY): what one policy did against these rules,
// not how long a person takes. The clock is a parameter ({ now, advance }), and the ticks too, so a later probe (the
// year-pacing probe) can run it on a check-in profile against production timings; under vitest the server runs on
// its development timings (research is instant, an expedition takes ten seconds), and simulated time says so.
//
// climb() returns one record per level reached: the simulated hours it took, the actions taken, the credits spent
// on purchases and the research hours queued (from data/research.json, whatever the server's timings). When the
// ladder stops, it throws naming the level and each requirement still unmet.

const EARTH = "earth-station-prime";
const STATION_OF = { Earth: EARTH, Mars: "mars-orbital-dock", Luna: "luna-gateway" };
const SILICATE_ORDER = "npc-buy-silicates-daily";
const SOL_BELT = "sol:belt";
/** The one contract resource the yards produce in quantity. Any other contract is taken only when it can be handed in
 *  at once from what expeditions have delivered, and dropped otherwise: waiting on the belt holds a slot for weeks. */
const YARD_RESOURCE = "Silicates";
/** Credits the bot keeps for running costs: no building, research, probe or lease is bought below it. */
const RESERVE = 40_000;
/** ISP-108 (AB#800): the catalogue ids a building-tier:<id>:<n> requirement names, by the name corp.buildings records. */
const CATALOGUE_NAME = { "basic-extractor-yard": "Basic Extractor Yard", refinery: "Refinery", "assembly-facility": "Assembly Facility" };
/** A yard's best throughput at each tier, docs/design/upgrades.md's "best T" column: the rate a cycle is started at. */
const BEST_RATE = { 1: 146, 2: 182, 3: 232, 4: 288, 5: 361, 6: 457, 7: 564, 8: 707 };
/** And its running cost an hour at that rate ("cost/h at best"): the float the yards need is a day of it. */
/** The model's expected uptime (ECONOMY.md): the design's float is one expected day, cost x 24 x this. */
const UPTIME = 0.816;
/** Unsold Silicates at Earth past which a remote yard only adds cost: the standing buy order takes 7,000 a day for
 *  the whole world (data/economy.json npcBid.quotaPerDay), so ore beyond about a day and a half of it does not sell. */
const GLUT = 10_000;
const COST_AT_BEST = { 1: 2618, 2: 3262, 3: 4176, 4: 5176, 5: 6492, 6: 8241, 7: 10142, 8: 12721 };
const SALVAGE = "ms-salvage-001"; // server/game/corporation.js SALVAGE_ASSIGNMENT_ID: the way back from broke

export async function climb({ request, account, clock, tick, levels, research, maxLevel, maxDays = 400, stepHours = 12, log = () => {} }) {
  const id = account.id;
  // An access token lasts 30 minutes of the clock the bot moves, so every step starts by signing in, as a player
  // returning to the game does. Signing in is not counted as an action.
  const auth = { Authorization: "" };
  async function signIn() {
    const res = await request.post("/api/auth/login").send({ email: account.email, password: account.password });
    if (res.status !== 200) throw new Error(`signing in: ${res.status} ${JSON.stringify(res.body)}`);
    auth.Authorization = `Bearer ${res.body.accessToken}`;
  }
  const post = (path, body = {}) => request.post(path).set(auth).send(body);
  const play = (path, body) => post(`/api/accounts/${id}/gameplay/${path}`, body);
  const corpNow = async () => { const r = await request.get(`/api/accounts/${id}`).set(auth); if (!r.body?.state) throw new Error(`reading the corporation: ${r.status} ${JSON.stringify(r.body)}`); known = r.body.state.corp; return known; };

  const start = clock.now();
  const records = [];
  let actions = 0;
  let spent = 0;
  let researchHours = 0;
  const researchQueued = new Set();
  let lastLevelAt = start;
  /** The last refusal of each kind of action, for the message when the ladder stops. */
  const refusals = new Map();

  /** A request that changes state: counted, and its cost measured from the credits it moved. */
  let needs = {}; // what the next level asks for this step, set in the loop below (AB#800)
  let known = null; // the corporation as last read, so an action's cost is measured without an extra read
  async function act(label, send) {
    const before = Number((known || (await corpNow())).finances?.credits || 0);
    const res = await send();
    if (res.status < 400) {
      actions += 1;
      known = res.body?.state?.corp || (await corpNow());
      const after = Number(known.finances?.credits || 0);
      if (after < before) spent += before - after;
      log(`${hours()}h ${label}`);
    } else {
      refusals.set(label, String(res.body?.error || res.status));
    }
    return res;
  }
  const hours = () => Math.round((clock.now() - start) / 3_600_000);

  const techById = Object.fromEntries(research.map((t) => [t.id, t]));
  /** The next research to queue for `techId`: the first of it and its prerequisites not yet unlocked. */
  function nextTech(techId, unlocked) {
    const t = techById[techId];
    if (!t || unlocked.includes(techId)) return null;
    for (const p of t.prereqs || []) {
      const n = nextTech(p, unlocked);
      if (n) return n;
    }
    return techId;
  }

  /** AB#800: a day of running cost for the yards that run (Earth's, and every yard while the next level asks for
   *  Silicates mined). Ore pays only when it is sold, a check-in or two later, so the reserve is RESERVE plus this;
   *  with a fixed 40,000 the bot ran six yards on nothing and went broke (docs/design/upgrades.md, "float"). */
  function floatFor(corp, everyYard) {
    const running = (corp.mining?.silicateExtractors || []).filter((e) => everyYard || e.body === "Earth");
    return running.reduce((sum, e) => sum + (COST_AT_BEST[Number(e.tier) || 1] || COST_AT_BEST[1]) * 24 * UPTIME, 0);
  }

  /** The actions a requirement asks for, against the corporation as it is now. */
  async function pursue(req, corp) {
    // Purchases wait while credits are under the reserve: running out stops the yards, and with them the ladder.
    if (Number(corp.finances?.credits || 0) < RESERVE + floatFor(corp, needs.mine) && !/^stat:(silicateSoldOnExchange|missionsCompleted)$|^totalMined:/.test(req.metric)) return null;
    const [kind, ...rest] = req.metric.split(":");
    const arg = rest.join(":");
    const here = corp.currentStationId || EARTH;
    const unlocked = corp.unlockedTech || [];
    const leases = corp.miningLeases || [];
    if (kind === "employeeCount") {
      if (here !== EARTH) return null; // hiring needs an office where you are: Earth's
      return act(`hire to ${req.target}`, () => play("hire", { count: Math.max(1, req.target - Number(corp.employeeCount || 0)) }));
    }
    if (kind === "unlockedTech") {
      const next = nextTech(arg, unlocked);
      if (next && !researchQueued.has(next)) {
        const res = await act(`research ${next}`, () => play("queue-rnd", { techId: next }));
        if (res.status < 400) { researchQueued.add(next); researchHours += Number(techById[next]?.durationHours || 0); }
      }
      return null;
    }
    if (kind === "miningLease" || (kind === "stat" && arg === "miningLeasesCount")) {
      const body = kind === "miningLease" && arg !== "any" ? arg : nextUnleased(corp);
      return body ? leaseOn(body, corp) : null;
    }
    // ISP-97 (AB#787): the Refinery Complex is a Refinery's tier 2, bought through the upgrade route.
    if (kind === "building" && arg === "Refinery Complex") return upgradeTo("refinery", 2, 1, corp);
    if (kind === "building" || kind === "building-count") return build(arg, corp);
    if (kind === "building-tier") { const [id, n] = arg.split(":"); return upgradeTo(id, Number(n), Number(req.target), corp); }
    if (kind === "stat" && arg === "asteroidExpeditionsCompleted") return expedition(corp);
    if (kind === "stat" && arg === "refinedUnitsProduced") {
      if (!(corp.buildings || []).some((b) => b.name === "Refinery")) return build("Refinery", corp);
      return refine(corp);
    }
    if (kind === "stat" && arg === "missionsCompleted") return contracts(corp);
    // Mined and sold Silicates come from the standing work every step does (below).
    return null;
  }

  /** The first of Earth, Mars and Luna the corporation holds no lease on: one lease per body. */
  function nextUnleased(corp) {
    const held = new Set((corp.miningLeases || []).map((l) => l.body));
    return ["Earth", "Mars", "Luna"].find((b) => !held.has(b)) || null;
  }
  /** A lease on `body`: staff for it are hired at Earth (hiring needs an office where you are), then the trip. */
  async function leaseOn(body, c) {
    const here = c.currentStationId || EARTH;
    const staffed = Number(c.employeeCount || 0) >= 5 * ((c.miningLeases || []).length + 1);
    if (!staffed) return here === EARTH ? act("hire for a lease", () => play("hire", { count: 5 })) : travel(EARTH, c);
    const station = STATION_OF[body];
    if (here !== station) return travel(station, c);
    // A claim is filed through an office at that station: the shortest term there, then the lease.
    const officeHere = (c.offices || []).some((o) => o.stationId === station && Number(o.rentedUntil || 0) > clock.now());
    if (!officeHere) return act(`rent an office at ${station}`, () => play("rent-office", { stationId: station, durationDays: 7 }));
    return act(`lease ${body}`, () => play("purchase-lease", { body }));
  }

  async function travel(stationId, corp) {
    if (Number(corp.travel?.arrivesAt || 0) > clock.now()) return null;
    return act(`travel to ${stationId}`, () => play("travel", { toStationId: stationId }));
  }

  async function build(name, corp) {
    const unlocked = corp.unlockedTech || [];
    const entry = { "Basic Extractor Yard": "basic-extractor-yard", "Assembly Facility": "assembly-facility", Refinery: "refinery" }[name];
    const gates = { "assembly-facility": ["tt-assembly-fabrication"], refinery: ["tt-material-compression", "tt-nano-lattice"] }[entry] || [];
    for (const g of gates) {
      const next = nextTech(g, unlocked);
      if (next) return pursueTech(next);
    }
    if (entry === "basic-extractor-yard") {
      const lease = (corp.miningLeases || []).find((l) => (l.extractorIds || []).length < (l.buildingSlots || 0));
      if (!lease) { const body = nextUnleased(corp); return body ? leaseOn(body, corp) : null; }
      return act("build a yard", () => play("build", { buildingId: entry, leaseId: lease.id }));
    }
    return act(`build ${name}`, () => play("build", { buildingId: entry }));
  }
  async function pursueTech(techId) {
    if (researchQueued.has(techId)) return null;
    const res = await act(`research ${techId}`, () => play("queue-rnd", { techId }));
    if (res.status < 400) { researchQueued.add(techId); researchHours += Number(techById[techId]?.durationHours || 0); }
    return res;
  }

  async function expedition(corp) {
    const unlocked = corp.unlockedTech || [];
    for (const g of ["tt-assembly-fabrication", "tt-asteroid-prospecting"]) {
      const next = nextTech(g, unlocked);
      if (next) return pursueTech(next);
    }
    if (!(corp.buildings || []).some((b) => b.name === "Assembly Facility")) return build("Assembly Facility", corp);
    const am = corp.asteroidMining || {};
    if (!(am.scoutedBelts || []).includes(SOL_BELT)) return act("scout the Sol belt", () => play("scout-belt", { beltKey: SOL_BELT }));
    if ((am.activeExpeditions || []).length) return null;
    if (Number(am.probeCount || 0) < 1) {
      if ((am.fabricationQueue || []).length) return null;
      return act("fabricate a probe", () => play("build-mining-probe", {}));
    }
    return act("launch an expedition", () => play("launch-expedition", { beltKey: SOL_BELT, duration: "standard" }));
  }

  async function refine(corp) {
    // Every idle refinery, while Silicates last (AB#800: two refineries from Level 16).
    let last = null;
    for (const idle of (corp.refineries || []).filter((r) => !r.active)) {
      const held = Number(known.inventory?.[known.currentStationId || EARTH]?.Silicates || 0);
      if (held < 100) break;
      const inputQuantity = Math.min(held - (held % 100), 600);
      last = await act("refine Silicates", () => play("start-refinery", { refineryId: idle.id, chainId: "silicates-chain", inputQuantity }));
    }
    return last;
  }

  /** ISP-108 (AB#800): `count` of a catalogue building at `tier` or above, one upgrade a step. The yard or refinery must
   *  be idle, so a mining yard is upgraded at the check-in its cycle has ended, before standing work restarts it. */
  async function upgradeTo(id, tier, count, corp) {
    const name = CATALOGUE_NAME[id];
    const own = (corp.buildings || []).filter((b) => b.name === name);
    if (own.filter((b) => (Number(b.tier) || 1) >= tier).length >= count) return null;
    if (own.length < count) return build(name, corp);
    const extractorOf = (b) => (corp.mining?.silicateExtractors || []).find((e) => e.buildingId === b.id);
    const refineryOf = (b) => (corp.refineries || [])[own.indexOf(b)];
    const free = (b) => {
      const record = id === "basic-extractor-yard" ? extractorOf(b) : id === "refinery" ? refineryOf(b) : b;
      return record && !record.active && !(Number(record.upgradingUntil || b.upgradingUntil || 0) > clock.now());
    };
    // Closest to the tier first, and a yard that mines (Earth's) before one that only stands.
    const earth = (b) => (extractorOf(b)?.body === "Earth" ? 0 : 1);
    const next = own.filter((b) => (Number(b.tier) || 1) < tier && free(b))
      .sort((a, b) => (Number(b.tier) || 1) - (Number(a.tier) || 1) || earth(a) - earth(b))[0];
    if (!next) return null;
    return act(`upgrade ${name} to tier ${(Number(next.tier) || 1) + 1}`, () => play(`buildings/${encodeURIComponent(next.id)}/upgrade`, {}));
  }

  /** Every contract move open this step: hand in what is held, drop what cannot be filled soon, take what can. */
  async function contracts(corp) {
    const here = corp.currentStationId || EARTH;
    let last = null;
    const fillable = (m) => Number(known.inventory?.[here]?.[m.quota.resource] || 0) >= Number(m.quota.amount || 0);
    for (const m of corp.activeMissions || []) {
      if (!m.quota) continue;
      if (fillable(m)) last = await act(`complete ${m.id}`, () => play("complete-mission", { missionId: m.id }));
      else if (m.quota.resource !== YARD_RESOURCE) last = await act(`abandon ${m.id}`, () => play("abandon-mission", { missionId: m.id }));
    }
    for (const offer of (known.contractOfferings?.missions || []).filter((m) => m.quota && (m.quota.resource === YARD_RESOURCE || fillable(m)))) {
      if ((known.activeMissions || []).filter((m) => m.quota).length >= 2) break;
      last = await act(`accept ${offer.id}`, () => play("accept-mission", { missionId: offer.id }));
    }
    // Contracts for metals and ice are fed by expeditions.
    return (await expedition(known)) || last;
  }

  /** What every step does whatever the level: keep the office, keep the yards mining, sell what is not needed. */
  async function standingWork(corp, needs) {
    const credits = Number(corp.finances?.credits || 0);
    const office = (corp.offices || []).find((o) => o.stationId === EARTH && Number(o.rentedUntil || 0) > clock.now());
    // The shortest term: a week at a time keeps the most credits working.
    if (!office && (corp.currentStationId || EARTH) === EARTH) await act("rent the office", () => play("rent-office", { stationId: EARTH, durationDays: 7 }));
    // Broke and idle: the Salvage Assignment the game offers for exactly this (ECONOMY.md, "The way back from broke").
    const salvage = (corp.activeMissions || []).find((m) => m.id === SALVAGE);
    if (salvage) {
      if (clock.now() - Number(salvage.acceptedAt || 0) >= Number(salvage.hoursRequired || 4) * 3_600_000) await act("complete salvage", () => play("complete-mission", { missionId: SALVAGE }));
    } else if (credits < 3000 && !(corp.mining?.silicateExtractors || []).some((e) => e.active)) {
      await act("accept salvage", () => play("accept-mission", { missionId: SALVAGE }));
    }
    // Cycles start where the office is (Earth), on any lease. Earth's yards always run. Ore mined elsewhere lands at
    // that body's station, so a Mars or Luna yard runs only while the next level asks for Silicates mined (Levels 11
    // to 15, AB#800), and its ore is shipped home below to be sold; otherwise it would pay its running cost for ore
    // that earns nothing.
    // Earth's first, then each other yard while the credits cover a day of running every yard started so far.
    let committed = RESERVE + floatFor(corp, false);
    const leases = (corp.currentStationId || EARTH) === EARTH ? [...(corp.miningLeases || [])].sort((x, y) => (x.body === "Earth" ? 0 : 1) - (y.body === "Earth" ? 0 : 1)) : [];
    for (const lease of leases) {
      // Past the glut a yard only adds running cost, Earth's too, unless the next level counts Silicates mined.
      const glut = Number(known.inventory?.[EARTH]?.Silicates || 0) > GLUT;
      if (lease.body !== "Earth" && (!needs.mine || glut)) continue;
      if (lease.body === "Earth" && glut && !needs.mine) continue;
      for (const extractorId of lease.extractorIds || []) {
        const ex = (corp.mining?.silicateExtractors || []).find((e) => e.id === extractorId);
        if (!ex) continue;
        if (lease.body !== "Earth") {
          committed += (COST_AT_BEST[Number(ex.tier) || 1] || COST_AT_BEST[1]) * 24 * UPTIME;
          if (!ex.active && Number(known.finances?.credits || 0) < committed) continue;
        }
        const upgrading = Number(ex.upgradingUntil || 0) > clock.now();
        if (!ex.active && !upgrading) await act("mine", () => play(`lease/${lease.id}/start-mining`, { amount: BEST_RATE[Number(ex.tier) || 1] || 146, hours: 24, extractorId }));
      }
    }
    const here = corp.currentStationId || EARTH;
    // AB#800: what the Mars and Luna yards mined comes home to be sold, 2 credits a unit and 30 minutes within Sol.
    if (here === EARTH) {
      for (const station of Object.values(STATION_OF).filter((s) => s !== EARTH)) {
        const away = Math.floor(Number(known.inventory?.[station]?.Silicates || 0));
        if (away >= 100) await act(`ship Silicates from ${station}`, () => play("transfer-resources", { fromStationId: station, lines: [{ item: "Silicates", quantity: away }] }));
      }
    }
    const held = Number(known.inventory?.[here]?.Silicates || 0);
    // Keep enough for refining and contracts when the next level asks for them; sell the rest.
    const keep = (needs.refine ? 1200 : 0) + (needs.contracts ? 800 : 0);
    if (needs.refine && here === EARTH) await refine(known); // AB#800: refineries kept busy, before the sale
    if (here === EARTH && held - keep >= 100) {
      const order = ((await request.get("/api/bootstrap").set(auth)).body.market?.npcBuyOrders || []).find((o) => o.id === SILICATE_ORDER);
      const quantity = Math.min(held - keep, Number(order?.remainingQty || 0));
      if (quantity >= 1) await act("sell Silicates", () => post(`/api/market/npc-orders/${SILICATE_ORDER}/sell`, { quantity }));
    }
  }

  const done = (corp, level) => (levels.find((l) => l.level === level)?.requirements || [])
    .map((r) => ({ ...r, progress: corp.levelProgress?.[`level${level}`]?.requirements?.find((x) => x.id === r.id)?.progress ?? 0 }));

  let loggedDay = -1;
  for (;;) {
    await signIn();
    let corp = await corpNow();
    const level = Number(corp.level || 0);
    if (records.length < level) {
      for (let l = records.length + 1; l <= level; l++) {
        records.push({ level: l, hours: Math.round((clock.now() - lastLevelAt) / 3_600_000), totalHours: hours(), actions, spent: Math.round(spent), researchHours, credits: Math.round(Number(corp.finances?.credits || 0)) });
        lastLevelAt = clock.now();
      }
    }
    if (level >= maxLevel) return records;
    if (clock.now() - start > maxDays * 86_400_000) {
      const unmet = done(corp, level + 1).filter((r) => Number(r.progress) < Number(r.target));
      const why = [...refusals].map(([what, error]) => `${what}: ${error}`).join(" | ");
      const reached = records.map((r) => `L${r.level} at ${r.totalHours} h (${r.credits} cr)`).join(", ");
      // The levels reached ride on the error, so a caller can still report them (the year-pacing probe, AB#990).
      throw Object.assign(new Error(`The ladder bot stopped at Level ${level} after ${maxDays} simulated days: Level ${level + 1} still needs ${unmet.map((r) => `${r.title} (${r.metric}: ${r.progress} of ${r.target})`).join("; ")}. Reached: ${reached}. Last refusals: ${why || "none"}.`), { records });
    }
    const next = done(corp, level + 1);
    const unmet = next.filter((r) => Number(r.progress) < Number(r.target));
    // Once a simulated day, the next level's every requirement against its target: which one binds (AB#2312).
    const day = Math.floor((clock.now() - start) / 86_400_000);
    if (day !== loggedDay) {
      loggedDay = day;
      log(`day ${day} L${level} -> L${level + 1}: ${next.map((r) => `${r.metric} ${Math.round(Number(r.progress) || 0)}/${r.target}`).join(", ")}`);
    }
    // ISP-108 (AB#800): refined units are cumulative and a refinery makes a few hundred a day, so once one exists the
    // bot keeps it running while any later level asks for more than it has made (docs/design/ladder-11-40.md draws its
    // refined curve from a refinery kept busy from day 30). Levels 11 to 15 ask for none, and Level 16 asks for 25,800.
    const refinedMade = Number(corp.stats?.refinedUnitsProduced || 0);
    const refineAhead = (corp.refineries || []).length > 0 && levels.some((l) => l.level > level && l.requirements.some((r) => r.metric === "stat:refinedUnitsProduced" && Number(r.target) > refinedMade));
    needs = { refine: refineAhead || unmet.some((r) => r.metric === "stat:refinedUnitsProduced"), contracts: unmet.some((r) => r.metric === "stat:missionsCompleted"), mine: unmet.some((r) => r.metric === "totalMined:silicate") };
    // A trip away is finished before anything else: the yards' ore and the standing bid are at Earth.
    const away = (corp.currentStationId || EARTH) !== EARTH;
    const leaseStillWanted = unmet.some((r) => /^(miningLease:|stat:miningLeasesCount|building-count:Basic Extractor Yard)/.test(r.metric));
    if (away && !leaseStillWanted) {
      await travel(EARTH, corp);
    } else {
      for (const req of unmet) {
        await pursue(req, corp);
        corp = await corpNow();
      }
    }
    await standingWork(await corpNow(), needs);
    // The Bureau posts new contracts every 2 hours; while contracts are the open requirement, the bot looks that often.
    clock.advance((needs.contracts ? Math.min(2, stepHours) : stepHours) * 3_600_000);
    await tick();
  }
}
