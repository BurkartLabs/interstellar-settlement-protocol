// AB#2477 (Board review item 24): the research prerequisites as a connected tree, on Corporate R&D and CEO Insight.
// Pure, so a test reads it without a page; views/prereqGraph.js draws it.
//
// The tree is laid out in rows by depth: a node sits one row below its deepest prerequisite, so every link points down.
// Within a row, nodes are ordered by where the nodes they link to sit (a few barycentre sweeps), so links cross less.

/** { rows: id[][], depth: Map<id, row> } for nodes of { id, prereqs }. A prerequisite not among the nodes is ignored. */
export function layoutPrereqs(nodes = []) {
  const byId = new Map(nodes.filter((n) => n?.id).map((n) => [n.id, n]));
  const prereqsOf = (id) => (byId.get(id)?.prereqs || []).filter((p) => byId.has(p) && p !== id);
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // a cycle in the data: break it rather than recurse forever
    visiting.add(id);
    const d = prereqsOf(id).reduce((max, p) => Math.max(max, depthOf(p) + 1), 0);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of byId.keys()) depthOf(id);

  const rows = [];
  for (const id of byId.keys()) (rows[depth.get(id)] ||= []).push(id);
  for (let r = 0; r < rows.length; r += 1) rows[r] ||= [];

  const dependents = new Map([...byId.keys()].map((id) => [id, []]));
  for (const id of byId.keys()) for (const p of prereqsOf(id)) dependents.get(p).push(id);
  const xOf = () => {
    const x = new Map();
    for (const row of rows) row.forEach((id, i) => x.set(id, (i + 0.5) / row.length));
    return x;
  };
  const sortBy = (row, links, x) => {
    const at = new Map(row.map((id, i) => [id, i]));
    const centre = (id) => {
      const xs = links(id).map((l) => x.get(l));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : (at.get(id) + 0.5) / row.length;
    };
    row.sort((a, b) => centre(a) - centre(b) || at.get(a) - at.get(b));
  };
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let r = 1; r < rows.length; r += 1) sortBy(rows[r], prereqsOf, xOf());
    for (let r = rows.length - 2; r >= 0; r -= 1) sortBy(rows[r], (id) => dependents.get(id), xOf());
  }
  for (let r = 1; r < rows.length; r += 1) sortBy(rows[r], prereqsOf, xOf());
  return { rows, depth };
}

/** Every prerequisite `id` needs, directly or through another, as a Set. */
export function prereqChain(id, nodes = []) {
  const byId = new Map(nodes.filter((n) => n?.id).map((n) => [n.id, n]));
  const chain = new Set();
  const walk = (at) => {
    for (const p of byId.get(at)?.prereqs || []) {
      if (!byId.has(p) || chain.has(p) || p === id) continue;
      chain.add(p);
      walk(p);
    }
  };
  walk(id);
  return chain;
}

/**
 * What `id` is still waiting on: `waiting`, every prerequisite in its chain not yet met, shallowest first; and `next`,
 * those of them that can start now (their own prerequisites all met). A node is met when `node.met` is true.
 */
export function waitingOn(id, nodes = []) {
  const byId = new Map(nodes.filter((n) => n?.id).map((n) => [n.id, n]));
  const { depth } = layoutPrereqs(nodes);
  const met = (p) => Boolean(byId.get(p)?.met);
  const waiting = [...prereqChain(id, nodes)].filter((p) => !met(p)).sort((a, b) => depth.get(a) - depth.get(b));
  const next = waiting.filter((p) => (byId.get(p).prereqs || []).every((q) => !byId.has(q) || met(q)));
  return { waiting, next };
}
