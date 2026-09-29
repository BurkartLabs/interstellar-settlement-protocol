import { describe, it, expect, afterEach } from "vitest";
import { directoryHtml, invitationsHtml, memberHtml } from "../../public/scripts/conglomerateBureau.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";

// ISP-254 (AB#4811, slice C1a): the Conglomerate Bureau's records carry the protocol line (public/scripts/protocol.js)
// after their plain words: an invitation or application filed and awaiting an answer is "Filed, awaiting review", a
// join cooldown is "Suspended", a register that did not load is "Unsuccessful". The code is the screen's, CGL-ADM-1.
const T = Date.UTC(2026, 8, 27, 12, 0);
const summary = (over = {}) => ({ id: "cgl-1", name: "Halcyon Accord", emblem: 6, colour: 5, level: 1, memberCount: 2, maxMembers: 5, ...over });
const outsider = (over = {}) => ({ conglomerate: null, invitations: [], application: null, joinCooldownUntil: null, charter: { fee: 1, deposit: 1, minFounderAgeDays: 7, refusal: null }, ...over });
const LINE = (phrase) => `<span class="protocol-line">${phrase}<span class="protocol-line__code" aria-hidden="true"> // CGL-ADM-1</span></span>`;

afterEach(() => setSectionCodes(null));

describe("the Bureau's records carry their protocol line (AB#4811)", () => {
  it("an invitation received and an open application: Filed, awaiting review, after the plain words", () => {
    setSectionCodes({ screens: [{ id: "conglomerate", code: "CGL-ADM-1" }] });
    const html = invitationsHtml(outsider({
      invitations: [{ id: "inv-1", at: T, conglomerate: summary() }],
      application: { id: "app-1", at: T, conglomerate: summary({ id: "cgl-2", name: "Kestrel League" }) }
    }));
    expect(html.match(/protocol-line"/g)).toHaveLength(2);
    expect(html).toContain(`invited 2147-09-27 12:00 UTC ${LINE("Filed, awaiting review")}`); // the in-fiction year (+121, ISP-249)
    expect(html).toContain(`it expires unanswered after 7 days. ${LINE("Filed, awaiting review")}`);
  });

  it("a join cooldown: Suspended, after the date it ends", () => {
    setSectionCodes({ screens: [{ id: "conglomerate", code: "CGL-ADM-1" }] });
    const html = invitationsHtml(outsider({ joinCooldownUntil: T }));
    expect(html).toMatch(/It can accept an invitation or apply from .+?\. <span class="protocol-line">Suspended/);
  });

  it("a member's applications waiting and invitations sent: Filed, awaiting review", () => {
    const view = {
      ...outsider(), me: "corp-f", atBureau: true,
      conglomerate: {
        ...summary({ memberCount: 1 }), role: "founder", permissions: ["view", "invite", "answer-application"], maxDirectors: 5, founderAbsentDays: 30,
        members: [{ corp: "corp-f", corpName: "Founder Co", role: "founder", joinedAt: T }], treasury: { credits: 0 },
        applications: [{ id: "capp-1", corp: "corp-x", corpName: "Applicant Co", at: T, state: "applied" }],
        invitations: [{ id: "cinv-1", corp: "corp-y", corpName: "Invitee Co", at: T, state: "open" }]
      }
    };
    const html = memberHtml(view);
    expect(html).toMatch(/Applied [^<]+ <span class="protocol-line">Filed, awaiting review<\/span>/);
    expect(html).toMatch(/Invited [^<]+ <span class="protocol-line">Filed, awaiting review<\/span>/);
  });

  it("a register that did not load: Unsuccessful, after the plain reason; an empty list has no line", () => {
    expect(directoryHtml(null, null, { error: "The Bureau did not answer." })).toContain('Nothing has changed. <span class="protocol-line">Unsuccessful</span>');
    expect(invitationsHtml(outsider())).not.toContain("protocol-line");
  });
});

describe("a refusal's meaning reads the server's own code (AB#4811)", () => {
  it("is Unfunded for code insufficient-credits whatever the words, and falls back to the words without a code", () => {
    const charter = Object.assign(new Error("The charter costs 110,000 credits (a 100,000 fee and a 10,000 deposit into the new treasury). Your corporation holds 5,000."), { code: "insufficient-credits", status: 409 });
    expect(refusalMeaning(charter)).toBe("unfunded");
    expect(refusalMeaning(Object.assign(new Error("Only the founder can dissolve the conglomerate."), { code: "not-permitted" }))).toBe("refused");
    expect(refusalMeaning(new Error("X queueing requires 45,000 credits. Current reserves: 3,120 credits."))).toBe("unfunded");
    expect(refusalMeaning(null)).toBe("refused");
  });
});
