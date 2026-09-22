// Bug #1274: run applyAsteroidExpeditions over one expedition in a process of its own, so the durations are the ones the
// server uses for NODE_ENV (the test process runs with test durations). Prints one JSON line:
// { duration, ms, stepped: { total, yields, depositStationId }, oneStep: { ... } }.
//   node tests/fixtures/expedition-sweep.mjs <duration: short|standard|extended> <stepMs> [beltKey]
const [duration = "short", stepArg = "10000", beltKey = "sol:belt"] = process.argv.slice(2);
const systemId = beltKey.split(":")[0];
const { applyAsteroidExpeditions, EXPEDITION_DURATIONS } = await import("../../server/gameState.js");

const T0 = 1_700_000_000_000;
const ms = EXPEDITION_DURATIONS[duration].ms;

function corpWithExpedition() {
  return {
    currentStationId: "earth-station-prime",
    inventory: {},
    stats: {},
    asteroidMining: {
      probeCount: 0,
      scoutedBelts: [],
      completedExpeditions: [],
      activeExpeditions: [{ id: "exp-1274", beltKey, systemId, duration, deployedAt: T0, completesAt: T0 + ms, lastTickAt: T0, yields: {}, status: "active" }]
    }
  };
}

function run(stepMs) {
  const corp = corpWithExpedition();
  for (let t = T0 + stepMs; t < T0 + ms; t += stepMs) applyAsteroidExpeditions(corp, t);
  applyAsteroidExpeditions(corp, T0 + ms);
  const done = corp.asteroidMining.completedExpeditions[0];
  const yields = done?.yields || {};
  return {
    total: Object.values(yields).reduce((a, b) => a + b, 0),
    yields,
    completed: Boolean(done),
    depositStationId: done?.depositStationId ?? null,
    stationTotal: Object.values(corp.inventory[done?.depositStationId] || {}).reduce((a, b) => a + b, 0)
  };
}

console.log(JSON.stringify({ duration, ms, stepped: run(Number(stepArg)), oneStep: run(ms) }));
