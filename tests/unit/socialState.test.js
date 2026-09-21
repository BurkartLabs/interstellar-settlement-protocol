import { describe, it, expect } from "vitest";
import {
  getState, mutateState, appendChatMessage, getAccountById, ensureGlobalSocialState, FORUM_CATEGORIES, CHAT_CHANNELS
} from "../../server/gameState.js";

// Bug #749: on any install without a data/state.json, chatLog and forums were never created, so every chat message
// threw inside appendChatMessage and was dropped, and the forum's category list was empty. The test environment has
// no state file (tests/setup.js gives each test file an empty data directory), so getState() here IS a fresh install.
describe("global social state on a fresh install (Bug #749)", () => {
  it("seeds every chat channel as an empty array, and no private channel", () => {
    const { chatLog } = getState();
    for (const channel of CHAT_CHANNELS) expect(Array.isArray(chatLog[channel])).toBe(true);
    expect(CHAT_CHANNELS).toEqual(["global", "local", "trade"]);
    expect(chatLog.private).toBeUndefined();
  });

  it("seeds the forum categories from the one server list, and an empty thread list", () => {
    const { forums } = getState();
    expect(FORUM_CATEGORIES.length).toBeGreaterThan(0);
    expect(forums.categories).toEqual(FORUM_CATEGORIES);
    expect(Array.isArray(forums.threads)).toBe(true);
  });

  it("stores a chat message sent on a fresh install", () => {
    const message = { id: "m-749", author: "Tester", body: "hello", createdAt: Date.now() };
    appendChatMessage("global", message);
    expect(getState().chatLog.global.at(-1)).toEqual(message);
  });

  it("still stores a message if some later migration drops the chat log (the backstop)", () => {
    mutateState((draft) => { delete draft.chatLog; });
    appendChatMessage("local", { id: "m-749b", body: "after a bad migration" });
    expect(getState().chatLog.local.at(-1).id).toBe("m-749b");
  });

  it("does not put chat or forums into a player's own account state", () => {
    const dummy = getAccountById("dummy");
    expect(dummy).toBeTruthy();
    expect(dummy.state.chatLog).toBeUndefined();
    expect(dummy.state.forums).toBeUndefined();
  });
});

describe("ensureGlobalSocialState on an existing state.json (Bug #749)", () => {
  it("keeps what is there, adds what is missing, and does not recreate private", () => {
    const legacy = {
      chatLog: { global: [{ id: "old" }], private: [{ id: "p" }] },
      forums: { categories: ["Old Category"], threads: [{ id: "t1", category: "Old Category" }] }
    };
    const out = ensureGlobalSocialState(legacy);
    expect(out.chatLog.global).toEqual([{ id: "old" }]);
    expect(out.chatLog.local).toEqual([]);
    expect(out.chatLog.trade).toEqual([]);
    expect(out.chatLog.private).toEqual([{ id: "p" }]); // existing data is left alone, never created
    expect(out.forums.threads).toEqual([{ id: "t1", category: "Old Category" }]);
    expect(out.forums.categories).toEqual(FORUM_CATEGORIES); // the server list wins (one source)
  });

  it("repairs shapes that are wrong rather than missing", () => {
    const out = ensureGlobalSocialState({ chatLog: "broken", forums: { categories: null, threads: "x" } });
    for (const channel of CHAT_CHANNELS) expect(out.chatLog[channel]).toEqual([]);
    expect(out.forums.threads).toEqual([]);
  });
});
