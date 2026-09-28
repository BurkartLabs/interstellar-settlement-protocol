import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { WALKTHROUGH_STEPS } from "../../public/scripts/walkthrough.js";
import { CODE_RULES } from "../../scripts/economy-model.mjs";
import { EMPLOYEES_PER_LEASE } from "../../public/scripts/leaseStaffing.js";

// AB#748 (ISP-62): the playtest briefing at /how-to-start. It is static text in public/how-to-start.html, so every
// figure it states is a copy (T-003); this is the test that keeps each copy equal to where the game reads it from, and
// keeps the steps in the walkthrough's order. When one fails, change the page, not the test.
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const json = (file) => JSON.parse(read(file));
const PAGE_HTML = read("public/how-to-start.html");
const PAGE = PAGE_HTML.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rarr;/g, "→").replace(/\s+/g, " ")
  .replace(/ ([,.;:])/g, "$1"); // the text as read: no space left where a closing tag met punctuation
const money = (n) => `¤${Number(n).toLocaleString("en-US")}`;

const economy = json("data/economy.json");
const earth = json("data/systems.json").flatMap((s) => s.bodies || []).find((b) => b.name === "Earth");
const research = json("data/research.json");
const firstResearch = (Array.isArray(research) ? research : Object.values(research).flat()).find((t) => t?.id === "tt-basic-extraction");
const silicates = economy.npcBuyers.find((b) => b.item === "Silicates");
const levels = json("data/milestones.json").levels.length;

describe("/how-to-start (AB#748)", () => {
  it("is served without a login, as a page", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/how-to-start");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("How to Start");
  });

  it("is linked from the landing page and the login page", () => {
    expect(read("public/index.html")).toContain('href="/how-to-start"');
    expect(read("public/login.html")).toContain('href="/how-to-start"');
  });

  it("names eight steps, each a walkthrough step, in the walkthrough's order", () => {
    const named = [...PAGE_HTML.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    const order = WALKTHROUGH_STEPS.map((s) => s.id);
    expect(named).toHaveLength(8);
    for (const id of named) expect(order, id).toContain(id);
    const positions = named.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("states every figure as the build has it", () => {
    const shortestTerm = Math.min(...economy.office.termDays);
    const figures = {
      "starting credits": money(CODE_RULES.startingCredits.value),
      "office per day": `${money(economy.office.rentPerDay)} a day`,
      "shortest office term": `${shortestTerm} days, ${money(shortestTerm * economy.office.rentPerDay)}`,
      "hire cost": `costs ${money(economy.employees.hireCost)}`,
      "payroll": `${money(economy.employees.payrollPerDay)} a day to payroll`,
      "staff per lease": `${EMPLOYEES_PER_LEASE} employees on payroll for each mining lease`,
      "Earth lease": `Silicate Extraction, ${money(earth.leaseCost)}`,
      "extractor yard": `Basic Extractor Yard: ${money(economy.buildings.extractorYardCost)}`,
      "throughput range": `between ${CODE_RULES.minThroughput.value} and ${CODE_RULES.maxThroughput.value} tons per hour`,
      "longest cycle": `up to ${CODE_RULES.maxCycleHours.value} hours`,
      "standing buyer": silicates.buyer,
      "standing bid": `about ${money(silicates.unitPrice)} a ton`,
      "sales tax": `keeps ${economy.exchange.salesTaxPct}% of every sale`,
      "first research": `${firstResearch.name}: ${firstResearch.durationHours} hours, ${money(firstResearch.costCredits)}`,
      "first research effect": `${firstResearch.effect.match(/^\+\d+%/)[0]} to extraction throughput`,
      "defined levels": `levels above ${levels}. Thirty are defined; ${levels + 1} to 40` // AB#800, AB#801
    };
    for (const [name, text] of Object.entries(figures)) expect(PAGE, name).toContain(text);
    expect(levels, "the page says thirty levels are defined").toBe(30); // AB#801
  });

  it("points bug reports at a forum category that exists, and asks for no personal data", async () => {
    const { FORUM_CATEGORIES } = await import("../../server/game/world.js");
    expect(FORUM_CATEGORIES).toContain("Help & Guides");
    expect(PAGE).toContain("Forums → Help & Guides");
    expect(PAGE).toContain("Never post your password or your email address");
  });
});
