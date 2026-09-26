import { describe, it, expect } from "vitest";
import { refusedRegistrationError } from "../../e2e/verification.mjs";

// Bug AB#2326: an e2e spec whose registration the page refused waited 150 seconds for "Check your email" and failed
// naming nothing. e2e/verification.mjs now fails at once with what the page said, and for the register limit, with
// how to start the server so the limit is lifted.
describe("a refused registration in an e2e spec (AB#2326)", () => {
  it("names the register limit's fix when the page says too many attempts", () => {
    const e = refusedRegistrationError("Too many attempts. Try again in 59 minutes.");
    expect(e.message).toContain('"Too many attempts. Try again in 59 minutes."');
    expect(e.message).toContain("ISP_DEV=1 NODE_ENV=test npm run dev");
  });

  it("says what any other refusal said, and no fix it cannot know", () => {
    const e = refusedRegistrationError("That email is already registered.");
    expect(e.message).toContain('"That email is already registered."');
    expect(e.message).not.toContain("NODE_ENV");
  });
});
