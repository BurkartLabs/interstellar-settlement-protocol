// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Bug #4809: renderFeedbackLog wrote each message into innerHTML unescaped. No message carries markup today (the names
// they quote are NAME_CHARS), but the sink must not depend on it: Bug #691 was an <img onerror> in a lease name.
let shared, state;
beforeAll(async () => {
  vi.stubGlobal("Image", class { set src(_) {} }); // a view module may preload images on import
  state = await import("../../public/scripts/state.js");
  shared = await import("../../public/scripts/views/shared.js");
});
beforeEach(() => {
  document.body.innerHTML = '<ul id="feedback-log"></ul>';
  state.appState.feedbackLog = [];
});

describe("the command log writes a message as text (Bug #4809)", () => {
  it("markup in a message is shown, never parsed", () => {
    const message = `Lease on <img src=x onerror="window.pwned=1"> & "Nova" <b>Corp</b>`;
    shared.pushFeedback(message, "ok");
    const item = document.querySelector("#feedback-log li");
    expect(item.querySelector("img, b")).toBeNull();
    expect(item.textContent).toContain(message);
    expect(window.pwned).toBeUndefined();
  });

  it("a tone cannot leave its class attribute", () => {
    shared.pushFeedback("Done.", 'ok" onmouseover="window.pwned=1');
    const item = document.querySelector("#feedback-log li");
    expect(item.getAttribute("onmouseover")).toBeNull();
    expect(item.className).toContain('ui-list__item--ok" onmouseover="window.pwned=1');
  });

  it("the protocol line still renders as markup after the escaped message", () => {
    shared.pushFeedback("Order lodged.", "ok", { meaning: "queued", screen: "market" });
    const item = document.querySelector("#feedback-log li");
    expect(item.querySelector(".protocol-line")).not.toBeNull();
    expect(item.textContent).toContain("Order lodged.");
  });
});
