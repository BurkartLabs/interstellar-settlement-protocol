import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { EMPLOYEES_PER_LEASE, employeesForNextLease } from "../../public/scripts/leaseStaffing.js";

// AB#1202: Level 2's "Purchase a Mining Lease on Mars" sent a Level 1 corporation holding an Earth lease and five
// staff to Mars Orbital Dock, where a second lease needs ten on payroll. AB#1753 made Level 2 any lease, so no card
// sends that player anywhere now; this keeps it that way for every lease milestone, including ones not written yet.
const read = (file) => JSON.parse(readFileSync(new URL(`../../data/${file}`, import.meta.url), "utf8"));
const MILESTONES = read("milestones.json");
const RESEARCH = new Map(read("research.json").nodes.map((n) => [n.id, n]));
/** The corporation level a research node needs, through its prerequisites (a node can need no less than they do). */
const levelFor = (id) => { const n = RESEARCH.get(id); return n ? Math.max(n.requiresCorpLevel || 0, ...(n.prereqs || []).map(levelFor)) : 0; };
// Every leasable body, and the corporation level at which its system can be reached (AB#832: Kestrel and BL Ceti I, like
// AB#830's Rime, sit behind Deep-Star Navigation, a Level 10 research).
const LEASABLE = read("systems.json").flatMap((s) => (s.bodies || []).filter((b) => b.leaseCost > 0)
  .map((b) => ({ name: b.name, reachLevel: s.accessResearch ? levelFor(s.accessResearch) : 0 })));

describe("staff per lease (AB#1202)", () => {
  it("is five on payroll for each lease held, counting the one being filed", () => {
    expect(EMPLOYEES_PER_LEASE).toBe(5);
    expect([0, 1, 2, 3].map(employeesForNextLease)).toEqual([5, 10, 15, 20]);
  });

  it("reads a missing or unreadable lease count as none held", () => {
    expect(employeesForNextLease(undefined)).toBe(5);
    expect(employeesForNextLease(Number.NaN)).toBe(5);
  });
});

describe("a lease milestone never asks for more staff than the levels before it guarantee (AB#1202)", () => {
  // Hiring is the only thing that changes employeeCount, and it only adds, and levels are granted strictly in order
  // (AB#690). So a corporation working on level N has at least the largest employeeCount target of levels 1 to N-1,
  // and that is all it is sure to have.
  const staffGuaranteedBefore = (level) => Math.max(0, ...MILESTONES.levels
    .filter((l) => l.level < level)
    .flatMap((l) => l.requirements)
    .filter((r) => r.metric === "employeeCount")
    .map((r) => r.target));

  // The most leases a corporation can hold while the requirement is still open. One lease per body at most (the
  // server refuses a second on the same body), so a milestone for a lease on one body can find every other one held
  // that a corporation working on that level can reach (it is below the level, so it has below the level's research).
  const leasesHeldWhileOpen = (req) => {
    if (req.metric === "stat:miningLeasesCount") return req.target - 1;
    const body = req.metric.split(":")[1];
    if (body === "any") return 0;
    return LEASABLE.filter((b) => b.name.toLowerCase() !== body.toLowerCase() && b.reachLevel < req.level).length;
  };

  const leaseMilestones = MILESTONES.levels.flatMap((l) => l.requirements
    .filter((r) => /^miningLease:/.test(r.metric) || r.metric === "stat:miningLeasesCount")
    .map((r) => ({ level: l.level, ...r })));

  it("finds every lease milestone in the catalogue", () => {
    expect(LEASABLE.length).toBeGreaterThanOrEqual(3);
    expect(leaseMilestones.map((r) => r.id)).toEqual(expect.arrayContaining(["marsLease", "secondLease", "lunaLease"]));
  });

  it.each(leaseMilestones.map((r) => [r.id, r]))("%s can be filed with the staff its level guarantees", (_id, req) => {
    const needed = employeesForNextLease(leasesHeldWhileOpen(req));
    expect(staffGuaranteedBefore(req.level), `level ${req.level} "${req.title}" needs ${needed} on payroll`).toBeGreaterThanOrEqual(needed);
  });
});
