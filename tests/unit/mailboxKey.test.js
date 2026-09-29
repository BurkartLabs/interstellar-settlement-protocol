import { describe, it, expect } from "vitest";
import { mailboxKey } from "../../server/mailboxKey.js";

// Bug #4798: the mailbox an address delivers to, which registration keeps to one account.
describe("mailboxKey (Bug #4798)", () => {
  it("drops a +tag on any domain, and case", () => {
    expect(mailboxKey(" Me+1@Example.com ")).toBe("me@example.com");
    expect(mailboxKey("me+a+b@example.com")).toBe("me@example.com");
  });
  it("drops dots only for Gmail, and folds googlemail into gmail", () => {
    expect(mailboxKey("m.e@gmail.com")).toBe("me@gmail.com");
    expect(mailboxKey("m.e+x@googlemail.com")).toBe("me@gmail.com");
    expect(mailboxKey("m.e@example.com")).toBe("m.e@example.com");
  });
  it("leaves a leading + and anything that is not an address alone", () => {
    expect(mailboxKey("+me@example.com")).toBe("+me@example.com");
    expect(mailboxKey("not-an-address")).toBe("not-an-address");
    expect(mailboxKey(undefined)).toBe("");
  });
});
