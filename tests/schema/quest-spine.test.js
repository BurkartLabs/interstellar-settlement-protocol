import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";

// AB#584: the quest spine is a design, but its worked example is written against the build. This keeps it honest:
// the example must fit its schema, and every route, id, tab, metric and timer it names must exist in the build, so a
// beat cannot quietly depend on something that is not there (the failure #424 was, in the milestone ladder).
const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const json = (p) => JSON.parse(read(p));

const schema = json("docs/quest-spine/quest.schema.json");
const act = json("docs/quest-spine/act-1.example.json");
const server = read("server/index.js");
// AB#737: the game state is split by system into server/game/*.js behind server/gameState.js; read all of it.
const gameState = [read("server/gameState.js"), ...readdirSync(new URL("server/game/", root)).sort().map((f) => read(`server/game/${f}`))].join("\n");
const indexHtml = read("public/index.html");
// Where a highlighted element can come from: static markup, any client script, or building data the cards are drawn from.
const client = readdirSync(new URL("public/scripts/", root)).filter((f) => f.endsWith(".js")).map((f) => read(`public/scripts/${f}`)).join("\n") +
  (existsSync(new URL("data/buildings.json", root)) ? read("data/buildings.json") : "");
const research = json("data/research.json");
const stations = json("data/stations.json").stations;
const systems = json("data/systems.json");
const milestones = json("data/milestones.json");

// The subset of JSON Schema the quest schema uses.
function validate(value, node, path = "$") {
  if (node.$ref) return validate(value, node.$ref.split("/").slice(1).reduce((n, k) => n[k], schema), path);
  const errors = [];
  if (node.enum && !node.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in ${node.enum.join(", ")}`);
  if (node.type) {
    const ok = { object: value && typeof value === "object" && !Array.isArray(value), array: Array.isArray(value), string: typeof value === "string",
      integer: Number.isInteger(value), number: typeof value === "number", boolean: typeof value === "boolean" }[node.type];
    if (!ok) return [`${path}: expected ${node.type}`];
  }
  if (typeof value === "string") {
    if (node.minLength && value.length < node.minLength) errors.push(`${path}: too short`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) errors.push(`${path}: does not match ${node.pattern}`);
  }
  if (typeof value === "number" && node.minimum !== undefined && value < node.minimum) errors.push(`${path}: below ${node.minimum}`);
  if (Array.isArray(value)) {
    if (node.minItems && value.length < node.minItems) errors.push(`${path}: fewer than ${node.minItems} items`);
    if (node.items) value.forEach((v, i) => errors.push(...validate(v, node.items, `${path}[${i}]`)));
  }
  if (node.type === "object") {
    for (const k of node.required || []) if (!(k in value)) errors.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (node.properties?.[k]) errors.push(...validate(v, node.properties[k], `${path}.${k}`));
      else if (node.additionalProperties === false) errors.push(`${path}: unexpected ${k}`);
    }
    if (node.oneOf && node.oneOf.filter((alt) => (alt.required || []).every((k) => k in value)).length !== 1) errors.push(`${path}: must match exactly one of oneOf`);
  }
  return errors;
}

// Every condition, hint and progress metric in the act.
const steps = act.steps;
const metrics = [
  ...act.opensWhen.map((c) => c.metric),
  ...steps.flatMap((s) => [...(s.objective.all || []), ...(s.objective.any || [])].map((c) => c.metric)),
  ...steps.flatMap((s) => (s.hints || []).map((h) => h.when.metric)),
  ...steps.filter((s) => s.progress).map((s) => s.progress.metric)
];

// The kinds the milestone resolver understands today, and the ones this design proposes adding to it. Each proposed kind
// names the state it reads; the field must exist in the server today.
const EXISTING = ["stat:", "employeeCount", "miningLease:", "building:", "building-count:", "totalMined:", "unlockedTech:"];
const PROPOSED = {
  level: "corp.level",
  walkthroughCompleted: "walkthroughCompleted",
  "missionActive:": "activeMissions",
  "missionCompleted:": "completedMissions",
  "dockedAt:": "currentStationId",
  "techQueued:": "corporateRnD",
  extractorsRunning: "silicateExtractors",
  "stationStock:": "inventory"
};
const kindOf = (m) => [...EXISTING, ...Object.keys(PROPOSED)].find((k) => (k.endsWith(":") ? m.startsWith(k) : m === k));

const PENDING_FIELDS = {
  "extractor.endsAt": ["silicateExtractors", "endsAt"],
  "rnd.completion": ["corporateRnD", "durationHours", "startedAt"],
  "travel.arrivesAt": ["corp.travel", "arrivesAt"],
  "contracts.nextRefreshAt": ["contractOfferings", "nextRefreshAt"],
  "office.rentedUntil": ["offices", "rentedUntil"]
};

describe("quest spine worked example (AB#584)", () => {
  it("fits its schema", () => {
    expect(validate(act, schema)).toEqual([]);
  });

  it("has unique step ids and ends where its ladder span says", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    const maxLevel = Math.max(...milestones.levels.map((l) => l.level));
    expect(act.ladder.to).toBeLessThanOrEqual(maxLevel);
    const last = steps[steps.length - 1].objective.all || [];
    expect(last).toContainEqual({ metric: "level", atLeast: act.ladder.to });
  });

  it("uses only metric kinds the resolver has, or proposed kinds that read state the server has today", () => {
    for (const k of EXISTING) expect(gameState, `resolveMetric handles ${k}`).toContain(k.endsWith(":") ? `"${k}` : `"${k}"`);
    for (const m of metrics) expect(kindOf(m), m).toBeTruthy();
    for (const field of Object.values(PROPOSED)) expect(server + gameState, field).toContain(field);
  });

  it("names only ids that exist: research, stations, lease bodies, buildings, contracts, stats", () => {
    const techIds = research.nodes.map((n) => n.id);
    const stationIds = stations.map((s) => s.id);
    const leasable = systems.flatMap((s) => s.bodies).filter((b) => b.leaseCost > 0).map((b) => b.name);
    for (const m of metrics) {
      const [kind, ...rest] = m.split(":");
      const arg = rest.join(":");
      if (kind === "unlockedTech" || kind === "techQueued") expect(techIds, m).toContain(arg);
      if (kind === "dockedAt") expect(stationIds, m).toContain(arg);
      if (kind === "stationStock") expect(stationIds, m).toContain(arg.split(":")[0]);
      if (kind === "miningLease") expect(leasable, m).toContain(arg);
      if (kind === "building" || kind === "building-count") expect(server + gameState, m).toContain(`"${arg}"`);
      if (kind === "missionActive" || kind === "missionCompleted") expect(gameState, m).toContain(`id: "${arg}"`);
      if (kind === "stat") expect(server + gameState, m).toMatch(new RegExp(`stats\\.${arg}\\b|"${arg}"`));
    }
  });

  it("relies only on routes and data files the build has", () => {
    for (const s of steps) {
      for (const r of s.uses.routes) {
        const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(server, `${s.id}: ${r}`).toMatch(new RegExp(`"/api/(accounts/:accountId/)?${escaped}"`));
      }
      for (const d of s.uses.data) {
        const [file, ...tokens] = d.split(" ");
        expect(existsSync(new URL(file, root)), `${s.id}: ${file}`).toBe(true);
        const text = read(file);
        for (const t of tokens.filter((t) => /^[a-z]+-[a-z0-9-]+$/.test(t))) expect(text, `${s.id}: ${t} in ${file}`).toContain(t);
      }
    }
  });

  it("guides only to tabs and elements that exist", () => {
    for (const s of steps.filter((x) => x.guide)) {
      expect(indexHtml, s.id).toContain(`data-tab="${s.guide.tab}"`);
      const attr = s.guide.selector.match(/\[(data-[a-z-]+)="([^"]+)"\]/);
      if (attr) expect(indexHtml + client, `${s.id}: ${s.guide.selector}`).toContain(attr[2]);
    }
  });

  it("names every pending outcome from a timer the server keeps", () => {
    const sources = [...steps.flatMap((s) => (s.pending || []).map((p) => p.source)), ...act.closes.handoff.shows.filter((x) => x.source).map((x) => x.source)];
    for (const src of sources) for (const field of PENDING_FIELDS[src]) expect(server + gameState, `${src}: ${field}`).toContain(field);
  });

  // Depth Critique #426, epic 5: once something is running, something is always running, and the act never ends on a
  // bare "what now?".
  it("keeps a pending outcome in view from the first one to the end of the act, and hands over at least one", () => {
    const first = steps.findIndex((s) => (s.pending || []).length);
    expect(first).toBeGreaterThan(-1);
    for (const s of steps.slice(first)) expect((s.pending || []).length, s.id).toBeGreaterThan(0);
    expect(act.closes.handoff.shows.some((x) => x.kind === "pending")).toBe(true);
    expect(act.closes.handoff.shows.some((x) => x.kind === "objective")).toBe(true);
  });

  it("never names the narrator: the speaker is a role, and text uses only the known placeholders", () => {
    const texts = JSON.stringify(act);
    expect(texts).not.toMatch(/Voss|Elara|Aria/);
    for (const p of texts.match(/\{\{[^}]+\}\}/g) || []) expect(["{{corpName}}", "{{ceoName}}", "{{speaker.name}}", "{{speaker.title}}"]).toContain(p);
  });
});
