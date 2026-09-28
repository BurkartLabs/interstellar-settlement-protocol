// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url"; // jsdom replaces the global URL, and readFileSync wants Node's

// AB#2483 (Board review 2026-09-26, items 17 and 18): the Overview shows the cash on hand right under its title at every
// level (AB#1056's milestones-first order for a new corporation now comes after it, not above the whole screen), and
// what was Command Feedback is the Command Log, the last thing on the page. Measured against the fold at 1280x800 and
// 375x812 in docs/ab-2483.
vi.mock("../../public/scripts/views/shared.js", () => ({ salvageRemainingMs: () => 0 }));
const { appState } = await import("../../public/scripts/state.js");
const { updateOverview, renderLevel2Progress } = await import("../../public/scripts/views/overview.js");

const HTML = readFileSync(new NodeURL("../../public/index.html", import.meta.url), "utf8");
const ARTICLE = HTML.slice(HTML.indexOf('<article id="overview"'), HTML.indexOf("</article>", HTML.indexOf('<article id="overview"')) + "</article>".length);

const corp = (level) => ({ corp: { level, finances: { credits: 250_000, dailyRevenue: 1_200, dailyExpenses: 800 }, military: {}, milestones: {} } });
const order = () => [...document.getElementById("overview").children].map((el) => el.id || el.className.split(" ")[0]);

beforeEach(() => {
  document.body.innerHTML = `<main>${ARTICLE}</main>`;
  appState.conglomerate = undefined;
});

describe("the Overview's order (AB#2483)", () => {
  for (const [level, early] of [[0, true], [2, true], [5, false]]) {
    it(`at level ${level}: the title, then the cash, ${early ? "then the milestones" : "the milestones after the cards"}, and the Command Log last`, () => {
      const data = corp(level);
      updateOverview(data);
      renderLevel2Progress(data);
      const parts = order();
      expect(parts.slice(0, 2)).toEqual(["ui-screen__header", "overview-figures"]);
      expect(parts.at(-1)).toBe("command-log");
      const milestones = parts.indexOf("overview-milestones");
      const cards = parts.indexOf("overview-cards");
      expect(milestones < cards, `milestones before the cards at level ${level}`).toBe(early);
      // drawn again (every update redraws), nothing moves
      renderLevel2Progress(data);
      expect(order()).toEqual(parts);
    });
  }

  it("fills the cash figure and the day's net flow, and leaves them out of the cards", () => {
    updateOverview(corp(3));
    expect(document.getElementById("overview-cash").textContent).toContain("250,000");
    expect(document.getElementById("overview-net-flow").textContent).toContain("400");
    expect(document.getElementById("overview-net-flow").dataset.tone).toBe("positive");
    expect(document.getElementById("overview-cards").textContent).not.toMatch(/Cash Reserves|Net Daily Flow/);
  });

  it("calls the log the Command Log, keeps its document code, and keeps the list every action writes to", () => {
    const title = document.getElementById("command-log-title");
    expect(title.textContent.trim()).toBe("Command Log");
    expect(title.querySelector('[data-code-for="command-log"]')).not.toBeNull();
    expect(document.querySelector("#command-log #feedback-log")).not.toBeNull();
    expect(HTML).not.toContain("Command Feedback");
  });
});
