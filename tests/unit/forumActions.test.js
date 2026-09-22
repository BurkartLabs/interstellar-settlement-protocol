import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bindOnce, likeRequest } from "../../public/scripts/forumActions.js";

// Bug #1131: one Like click sent one request per render of the thread, because each render added another listener
// to a container that survives it. A stand-in element that dispatches clicks to every listener it holds, as the DOM does.
function element() {
  const listeners = [];
  return {
    dataset: {},
    listeners,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    click(event = {}) { for (const l of listeners) if (l.type === "click") l.fn(event); }
  };
}
const button = (attrs) => ({ getAttribute: (name) => attrs[name] ?? null });

describe("forum Like sends one request per click (Bug #1131)", () => {
  it("rendering the thread five times and clicking once runs the handler once", () => {
    const detailBody = element();
    let requests = 0;
    for (let render = 0; render < 5; render += 1) bindOnce(detailBody, "likeBound", "click", () => { requests += 1; });
    detailBody.click();
    expect(detailBody.listeners).toHaveLength(1);
    expect(requests).toBe(1);
  });

  it("the old way, adding a listener per render, sent five (the bug, reproduced on the stand-in)", () => {
    const detailBody = element();
    let requests = 0;
    for (let render = 0; render < 5; render += 1) detailBody.addEventListener("click", () => { requests += 1; });
    detailBody.click();
    expect(requests).toBe(5);
  });

  it("builds the request for the thread open when clicked, with the reply id and no account id", () => {
    expect(likeRequest(button({ "data-target": "thread" }), "thr-2")).toEqual({ path: "/api/forums/threads/thr-2/like", body: {} });
    expect(likeRequest(button({ "data-target": "reply", "data-reply-id": "rep-9" }), "thr-2"))
      .toEqual({ path: "/api/forums/threads/thr-2/like", body: { replyId: "rep-9" } });
    expect(likeRequest(button({ "data-target": "thread" }), "a b/c").path).toBe("/api/forums/threads/a%20b%2Fc/like");
    expect(likeRequest(button({}), null)).toBeNull();
  });

  // A source check, weaker than rendering: renderForums lives in app.js, which the tests cannot run without a DOM.
  it("app.js binds the thread view's click listener through bindOnce and reads the open thread at click time", () => {
    const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
    expect(app).toMatch(/bindOnce\(detailBody, "likeBound", "click"/);
    expect(app).not.toMatch(/detailBody\.addEventListener\("click"/);
    expect(app).toMatch(/likeRequest\(likeBtn, appState\.selectedForumThreadId\)/);
  });
});
