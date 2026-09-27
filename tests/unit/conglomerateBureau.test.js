import { describe, it, expect } from "vitest";
import { COLOURS, EMBLEMS, applyRefusal, charterHtml, directoryHtml, emblemSvg, heirOf, invitationsHtml, memberHtml } from "../../public/scripts/conglomerateBureau.js";

// ISP-200 (AB#894): the Bureau's HTML. A requirement the server refuses is a disabled control with its reason, every
// empty state names a next action, the controls follow the role's permissions from the server, and nothing a player
// typed reaches the page unescaped.
const T = Date.UTC(2026, 8, 27, 12, 0);
const charter = (refusal = null) => ({ fee: 100_000, deposit: 10_000, minFounderAgeDays: 7, refusal });
const outsider = (over = {}) => ({ conglomerate: null, invitations: [], application: null, joinCooldownUntil: null, charter: charter(), ...over });
const summary = (over = {}) => ({ id: "cgl-1", name: "Halcyon Accord", emblem: 6, colour: 5, level: 1, memberCount: 2, maxMembers: 5, ...over });
const ALL = ["view", "contribute", "leave", "invite", "answer-application", "remove-member", "remove-director", "set-director", "buy-level", "set-identity", "transfer-founder", "dissolve"];
const PERMS = {
  founder: ALL.filter((p) => p !== "leave"),
  director: ["view", "contribute", "leave", "invite", "answer-application", "remove-member"],
  member: ["view", "contribute", "leave"]
};
function member(role, over = {}) {
  const members = [
    { corp: "corp-f", corpName: "Founder Co", role: "founder", joinedAt: T - 3000 },
    { corp: "corp-d", corpName: "Director Co", role: "director", joinedAt: T - 2000 },
    { corp: "corp-m", corpName: "Member Co", role: "member", joinedAt: T - 1000 }
  ];
  const me = { founder: "corp-f", director: "corp-d", member: "corp-m" }[role];
  return {
    ...outsider(),
    me,
    atBureau: true,
    conglomerate: { ...summary({ memberCount: 3 }), role, permissions: PERMS[role], maxDirectors: 5, founderAbsentDays: 30, members, treasury: { credits: 10_000 }, invitations: [], applications: [{ id: "capp-1", corp: "corp-x", corpName: "Applicant Co", at: T, state: "applied" }] },
    ...over
  };
}
const roles = (html) => [...html.matchAll(/data-role="(cong-[a-z-]+)"/g)].map((m) => m[1]);

describe("the charter form (AB#894)", () => {
  it("shows the fee, the deposit and the requirements before anything is filed", () => {
    const html = charterHtml(outsider());
    expect(html).toContain("100,000 credits, paid to the ISA");
    expect(html).toContain("10,000 credits, into the new treasury");
    expect(html).toContain("110,000 credits");
    expect(html).toMatch(/Registered at least 7 days, docked at Earth Station Prime, in no conglomerate/);
    expect(html).not.toMatch(/data-role="cong-charter-submit" disabled/);
  });

  it.each([
    ["founder-too-young", "A corporation can found a conglomerate 7 days after it was registered. Yours can from 2026-10-04 06:57 UTC."],
    ["insufficient-credits", "The charter costs 110,000 credits (a 100,000 fee and a 10,000 deposit into the new treasury). Your corporation holds 5,000."],
    ["already-in-conglomerate", "Your corporation is already in a conglomerate. Leave it before you found another."]
  ])("draws a refusal (%s) as a disabled action with the server's reason and what to do", (code, error) => {
    const html = charterHtml(outsider({ charter: charter({ code, error }) }));
    expect(html).toMatch(/<button type="submit"[^>]*data-role="cong-charter-submit" disabled aria-describedby="cong-charter-why">/);
    expect(html).toContain(`id="cong-charter-why" data-code="${code}">${error}</p>`);
  });

  it("is not drawn for a corporation already in one", () => {
    expect(charterHtml(member("member"))).toBe("");
  });
});

describe("empty states each offer a next action (AB#894)", () => {
  it("no invitations: browse the directory", () => {
    const html = invitationsHtml(outsider());
    expect(html).toContain("No invitations");
    expect(roles(html)).toContain("cong-goto-directory");
  });

  it("an empty directory: file a charter, or see what one needs when this corporation cannot yet", () => {
    expect(directoryHtml([], outsider())).toMatch(/data-role="cong-goto-charter">File a charter</);
    const refused = outsider({ charter: charter({ code: "founder-too-young", error: "Not yet." }) });
    expect(directoryHtml([], refused)).toMatch(/data-role="cong-goto-charter">See what a charter needs</);
  });

  it("a directory that could not be read says so and offers to try again", () => {
    const html = directoryHtml(null, outsider(), { error: "The Bureau did not answer." });
    expect(html).toContain('role="alert"');
    expect(roles(html)).toContain("cong-reload");
  });
});

describe("the directory's apply control (AB#894)", () => {
  it("is enabled for a corporation free to apply, and disabled with the reason otherwise", () => {
    const list = [summary(), summary({ id: "cgl-2", name: "Other Group" })];
    expect(directoryHtml(list, outsider())).not.toContain("disabled");
    const applied = outsider({ application: { id: "capp-1", at: T, conglomerate: summary() } });
    expect(applyRefusal(applied, list[0])).toMatch(/You have applied/);
    expect(applyRefusal(applied, list[1])).toMatch(/open application to Halcyon Accord. Withdraw it/);
    expect(applyRefusal(outsider({ joinCooldownUntil: T }), list[0])).toBe("You can apply from 2147-09-27 12:00 UTC.");
    expect(applyRefusal(member("member"), list[1])).toMatch(/already in a conglomerate/);
    const html = directoryHtml(list, applied);
    expect(html).toMatch(/data-role="cong-apply" data-conglomerate="cgl-2" disabled aria-describedby="cong-why-1"/);
  });

  it("marks the caller's own conglomerate and offers no apply on it", () => {
    const html = directoryHtml([summary()], member("member"));
    expect(html).toContain('<span class="ui-badge ui-badge--accent">Yours</span>');
    expect(roles(html)).not.toContain("cong-apply");
  });
});

describe("a member's view follows its role's permissions (AB#894)", () => {
  it("founder: promote, demote, hand over, remove, answer applications, invite, identity and dissolve; never leave", () => {
    const r = roles(memberHtml(member("founder")));
    for (const want of ["cong-promote", "cong-demote", "cong-transfer", "cong-remove", "cong-application-accept", "cong-dissolve", "cong-identity-form", "cong-invite-search"]) expect(r).toContain(want);
    expect(r).not.toContain("cong-leave");
  });

  it("director: removes members and answers applications; no promotion, no hand-over, no removing a director or the founder", () => {
    const html = memberHtml(member("director"));
    const r = roles(html);
    expect(r).toContain("cong-application-accept");
    expect(r).toContain("cong-invite-search");
    expect(r).toContain("cong-leave");
    for (const not of ["cong-promote", "cong-demote", "cong-transfer", "cong-dissolve", "cong-identity-form"]) expect(r).not.toContain(not);
    expect([...html.matchAll(/data-role="cong-remove" data-corp="([^"]+)"/g)].map((m) => m[1])).toEqual(["corp-m"]);
  });

  it("member: only leave", () => {
    const r = roles(memberHtml(member("member")));
    expect(r.filter((x) => !["cong-mine", "cong-roster", "cong-admissions", "cong-exit", "cong-succession", "cong-roster-status"].includes(x))).toEqual(["cong-leave"]);
  });

  it("names the heir in the succession line: the longest-serving director, else the longest-serving member", () => {
    expect(memberHtml(member("founder"))).toContain("the founder role passes to Director Co, the longest-serving director");
    expect(heirOf([{ corp: "a", role: "founder", joinedAt: 1 }, { corp: "b", role: "member", joinedAt: 3 }, { corp: "c", role: "member", joinedAt: 2 }]).corp).toBe("c");
  });

  it("disables promotion at the director cap, and dissolving away from the Bureau, each with the reason", () => {
    const full = member("founder");
    full.conglomerate.maxDirectors = 1;
    const html = memberHtml(full);
    expect(html).toMatch(/data-role="cong-promote" data-corp="corp-m" disabled/);
    expect(html).toContain("1 directors is the most a conglomerate may have");
    const away = memberHtml({ ...member("founder"), atBureau: false });
    expect(away).toMatch(/data-role="cong-dissolve" disabled aria-describedby="cong-dissolve-why"/);
    expect(away).toContain("Travel back to dissolve it");
  });
});

describe("what a player typed never reaches the page unescaped, and nothing is styled inline (AB#894)", () => {
  it("escapes names in every list", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const view = member("founder");
    view.conglomerate.name = hostile;
    view.conglomerate.members[2].corpName = hostile;
    view.conglomerate.applications[0].corpName = hostile;
    const html = memberHtml(view) + directoryHtml([summary({ name: hostile })], outsider()) + invitationsHtml(outsider({ invitations: [{ id: "i", at: T, conglomerate: summary({ name: hostile }) }] }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("uses no style attribute", () => {
    const html = memberHtml(member("founder")) + charterHtml(outsider()) + directoryHtml([summary()], outsider()) + invitationsHtml(outsider());
    expect(html).not.toMatch(/\sstyle=/);
  });

  it("labels every emblem with its colour and shape, from twelve shapes and ten colours", () => {
    expect(EMBLEMS).toHaveLength(12);
    expect(COLOURS).toHaveLength(10);
    expect(emblemSvg(6, 5)).toContain('aria-label="Amber star emblem"');
    expect(emblemSvg(99, 99)).toContain('aria-label="Cyan circle emblem"'); // out of range falls back, never breaks
  });
});

describe("the headquarters tab (ISP-201, AB#895)", () => {
  it("shows a member its conglomerate, and the way to the Bureau, disabled away from Earth Station Prime with the reason", async () => {
    const { hqHtml } = await import("../../public/scripts/conglomerateBureau.js");
    const here = hqHtml(member("founder"), [summary()]);
    expect(roles(here)).toEqual(expect.arrayContaining(["cong-mine", "cong-roster", "cong-open-bureau"]));
    expect(here).not.toContain("cong-directory"); // a member's tab is its conglomerate
    const away = hqHtml({ ...member("member"), atBureau: false }, []);
    expect(away).toMatch(/data-role="cong-open-bureau" disabled aria-describedby="cong-bureau-why"/);
    expect(away).toContain("The Bureau is on Earth Station Prime. Travel there to file a charter, buy a level or dissolve.");
  });

  it("shows an independent corporation the Bureau, its invitations and the directory, each with a next action", async () => {
    const { hqHtml } = await import("../../public/scripts/conglomerateBureau.js");
    const html = hqHtml({ ...outsider(), atBureau: true }, []);
    expect(html).toContain("Your corporation is independent");
    expect(html).toContain("it costs 110,000 credits");
    expect(roles(html)).toEqual(expect.arrayContaining(["cong-open-bureau", "cong-goto-directory", "cong-goto-charter"]));
    expect(html).not.toContain('data-role="cong-charter"'); // the charter is filed at the Bureau
    expect(hqHtml(null, null)).toContain("Reading your conglomerate");
    expect(hqHtml(null, null, { error: "The Bureau did not answer." })).toContain('role="alert"');
  });
});

describe("the Overview's Conglomerate card (ISP-201, AB#895)", () => {
  it("names a member's conglomerate with its members and cap, and opens the roster; an independent one opens the Bureau", async () => {
    const { conglomerateCard } = await import("../../public/scripts/conglomerateBureau.js");
    const card = conglomerateCard({ ...summary({ memberCount: 3 }), role: "director", treasury: { credits: 12_500 } });
    expect(card).toMatchObject({ value: "Halcyon Accord: 3 / 5 members", jump: "conglomerate" });
    expect(card.body).toBe("Director. Level 1; the treasury holds 12,500 credits. Open the roster.");
    expect(conglomerateCard(null)).toMatchObject({ value: "Independent", jump: "bureau" });
    expect(conglomerateCard(undefined).jump).toBeUndefined(); // not read yet: no promise it cannot keep
  });
});
