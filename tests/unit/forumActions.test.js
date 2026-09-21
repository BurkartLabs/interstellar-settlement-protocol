import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { forumPostBodyHtml } from "../../public/scripts/html.js";
import { bindOnce, likeRequest, postFor, replyDraft, quoteDraft, REPLY_MAX_LENGTH } from "../../public/scripts/forumActions.js";

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

// Bug #1132: Reply and Quote had no handler. They now fill the reply box; these are the pure parts.
describe("forum Reply and Quote (Bug #1132)", () => {
  const thread = { author: "Halcyon Ore", body: "Is anyone else seeing 22 a ton?\nOn the standing order.", replies: [{ id: "rep-1", author: "Kestrel Freight", content: "Yes, 22 here too." }] };

  it("finds the post a button belongs to: the thread, or the reply its id names", () => {
    expect(postFor(button({}), thread)).toEqual({ author: "Halcyon Ore", text: thread.body, isReply: false });
    expect(postFor(button({ "data-reply-id": "rep-1" }), thread)).toEqual({ author: "Kestrel Freight", text: "Yes, 22 here too.", isReply: true });
    expect(postFor(button({ "data-reply-id": "gone" }), thread)).toBeNull();
    expect(postFor(button({}), null)).toBeNull();
  });

  it("Reply to a reply starts the box with @Author, and never overwrites what is written", () => {
    const reply = postFor(button({ "data-reply-id": "rep-1" }), thread);
    expect(replyDraft("", reply)).toBe("@Kestrel Freight ");
    expect(replyDraft("Half a thought", reply)).toBe("Half a thought");
    expect(replyDraft("", postFor(button({}), thread))).toBe("");
  });

  it("Quote adds the author and the lines, each prefixed, below what is written", () => {
    const op = postFor(button({}), thread);
    expect(quoteDraft("", op)).toBe("> Halcyon Ore wrote:\n> Is anyone else seeing 22 a ton?\n> On the standing order.\n\n");
    expect(quoteDraft("I agree.", op).startsWith("I agree.\n\n> Halcyon Ore wrote:")).toBe(true);
  });

  it("Quote keeps a long post short and the box within the reply limit", () => {
    const long = { author: "A", text: "x".repeat(2000), isReply: false };
    expect(quoteDraft("", long).length).toBeLessThan(330);
    const many = { author: "A", text: "1\n2\n3\n4\n5\n6", isReply: false };
    expect(quoteDraft("", many)).toBe("> A wrote:\n> 1\n> 2\n> 3\n> 4 …\n\n");
    expect(quoteDraft("y".repeat(REPLY_MAX_LENGTH), long)).toHaveLength(REPLY_MAX_LENGTH);
  });

  it("app.js binds Reply and Quote once and gives the buttons on each reply its id (a source check)", () => {
    const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
    expect(app).toMatch(/bindOnce\(detailBody, "composeBound", "click"/);
    expect(app).toMatch(/data-action="reply" data-reply-id=/);
    expect(app).toMatch(/data-action="quote" data-reply-id=/);
  });
});

// Bug #1132: a quote only reads as a quote if the thread shows it as one; reply bodies were a single paragraph.
describe("forum post bodies show quotes and line breaks (Bug #1132)", () => {
  it("renders a run of '> ' lines as one blockquote and keeps the other lines' breaks", () => {
    expect(forumPostBodyHtml("> Halcyon Ore wrote:\n> 22 here too.\n\nSame here.\nSince Monday."))
      .toBe('<blockquote class="forum-quote">Halcyon Ore wrote:<br>22 here too.</blockquote><p>Same here.<br>Since Monday.</p>');
  });

  it("separates paragraphs on blank lines and escapes every line", () => {
    expect(forumPostBodyHtml("One\n\nTwo")).toBe("<p>One</p><p>Two</p>");
    expect(forumPostBodyHtml("> <img src=x onerror=alert(1)>\n<b>hi</b>"))
      .toBe('<blockquote class="forum-quote">&lt;img src=x onerror=alert(1)&gt;</blockquote><p>&lt;b&gt;hi&lt;/b&gt;</p>');
    expect(forumPostBodyHtml("")).toBe("");
    expect(forumPostBodyHtml(undefined)).toBe("");
  });

  it("a quote written by quoteDraft renders back as that quote", () => {
    const draft = quoteDraft("", { author: "Kestrel", text: "Line A\nLine B", isReply: true }) + "My answer.";
    expect(forumPostBodyHtml(draft)).toBe('<blockquote class="forum-quote">Kestrel wrote:<br>Line A<br>Line B</blockquote><p>My answer.</p>');
  });
});

// Bug #1222: a forum update re-rendered the thread and emptied a half-written reply. A source check: app.js keeps the
// box's value across the render, and after posting clears the box on the page rather than a possibly detached one.
describe("a half-written reply survives forum updates (Bug #1222)", () => {
  const app = readFileSync(new URL("../../public/scripts/app.js", import.meta.url), "utf8");
  it("keeps the draft for the same thread and puts it back after the render", () => {
    expect(app).toMatch(/const keptDraft = oldBox && oldBox\.closest\("form"\)\?\.dataset\.threadId === selected\.id/);
    expect(app).toMatch(/newBox\.value = keptDraft\.value/);
  });
  it("clears the live box after a reply is posted", () => {
    expect(app).toMatch(/const liveBox = document\.getElementById\("forum-reply-content"\);\s+if \(liveBox\) liveBox\.value = "";/);
  });
});
