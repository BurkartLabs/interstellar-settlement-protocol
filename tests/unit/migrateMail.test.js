import { describe, it, expect, beforeEach } from "vitest";
import { accountsStore } from "../../server/game/store.js";
import { migrateLegacyMail, listConversations, listConversationMessages, conversationIdFor, resetConversationCache } from "../../server/game/conversations.js";

// AB#910: the old player mail (two copies of every message, inside the accounts snapshot) becomes one message in the
// conversation between the two corporations, with sender, recipient, subject and time kept. Run on a fixture store.
const corp = (id, name) => ({ id, state: { corp: { publicId: `corp-${id}`, corporationName: name } }, messages: [] });
const mail = (from, to, sentAt, { subject = "Ore prices", body = "Selling silicates", folder, readAt = null, trashedAt = null }) => ({
  id: `msg-${Math.random().toString(36).slice(2)}`, fromType: "player", fromId: from.id, fromName: from.state.corp.corporationName,
  toAccountId: to.id, toName: to.state.corp.corporationName, subject, body, sentAt, readAt, folder, trashedAt
});

let fixture, alpha, beta, gamma;
beforeEach(() => {
  resetConversationCache();
  const tag = Math.random().toString(36).slice(2, 8); // each test its own accounts, so their files never meet
  alpha = corp(`alpha-${tag}`, "Alpha Mining"); beta = corp(`beta-${tag}`, "Beta Freight"); gamma = corp(`gamma-${tag}`, "Gamma Labs");
  const t = Date.UTC(2026, 8, 20, 12);
  // alpha -> beta, read by beta; beta -> alpha, unread; alpha -> gamma, gamma trashed it; a draft; a system letter
  const m1 = mail(alpha, beta, t, { folder: "inbox", readAt: t + 60_000 });
  const m2 = mail(beta, alpha, t + 3_600_000, { subject: "Re: Ore prices", body: "How many tonnes?", folder: "inbox" });
  const m3 = mail(alpha, gamma, t + 7_200_000, { subject: "(no subject)", body: "Lab time?", folder: "trash", trashedAt: t + 8_000_000 });
  beta.messages.push(m1);
  alpha.messages.push({ ...m1, id: "sent-1", folder: "sent", readAt: t });
  alpha.messages.push(m2);
  beta.messages.push({ ...m2, id: "sent-2", folder: "sent", readAt: t + 3_600_000 });
  gamma.messages.push(m3);
  alpha.messages.push({ ...m3, id: "sent-3", folder: "sent", readAt: t + 7_200_000 });
  alpha.messages.push({ id: "d1", fromType: "player", fromId: alpha.id, folder: "draft", subject: "draft", body: "not sent", sentAt: t });
  alpha.messages.push({ id: "s1", fromType: "system", fromName: "Liaison", folder: "inbox", subject: "Welcome", body: "Hello", sentAt: t });
  fixture = { accounts: { [alpha.id]: alpha, [beta.id]: beta, [gamma.id]: gamma } };
  Object.assign(accountsStore.accounts, fixture.accounts); // the views name corporations from the live store
});

describe("migrating the old mail (AB#910)", () => {
  it("makes one message per sent message, keeping sender, recipient, subject and time, and counts it", () => {
    const report = migrateLegacyMail(fixture);
    expect(report).toMatchObject({ copies: 6, messages: 3, written: 3, alreadyPresent: 0, skippedMissingAccount: 0 });
    const ab = listConversationMessages(alpha.id, conversationIdFor(alpha.id, beta.id));
    expect(ab.messages.map((m) => [m.fromCorpId, m.subject, m.body, m.sentAt])).toEqual([
      [beta.state.corp.publicId, "Re: Ore prices", "How many tonnes?", Date.UTC(2026, 8, 20, 13)],
      [alpha.state.corp.publicId, "Ore prices", "Selling silicates", Date.UTC(2026, 8, 20, 12)]
    ]);
    const ag = listConversationMessages(gamma.id, conversationIdFor(alpha.id, gamma.id)).messages;
    expect(ag).toHaveLength(1);
    expect(ag[0].subject).toBeUndefined(); // "(no subject)" was the old placeholder, not a subject
  });

  it("keeps who has read what: beta read alpha's letter, alpha has not read beta's reply", () => {
    migrateLegacyMail(fixture);
    const forBeta = listConversations(beta.id).conversations.find((c) => c.with.publicId === alpha.state.corp.publicId);
    const forAlpha = listConversations(alpha.id).conversations.find((c) => c.with.publicId === beta.state.corp.publicId);
    expect(forBeta.unread).toBe(0);
    expect(forAlpha.unread).toBe(1);
  });

  it("is idempotent, and leaves drafts, system letters and the old mail itself where they are", () => {
    migrateLegacyMail(fixture);
    resetConversationCache(); // the second run reads the files the first wrote
    expect(migrateLegacyMail(fixture)).toMatchObject({ written: 0, alreadyPresent: 3 });
    expect(listConversationMessages(alpha.id, conversationIdFor(alpha.id, beta.id)).messages).toHaveLength(2);
    expect(alpha.messages).toHaveLength(5); // two sent copies, beta's reply, the draft, the letter: not removed: the Inbox still reads it until it moves to conversations
  });
});
