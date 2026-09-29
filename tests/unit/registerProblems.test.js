import { describe, it, expect } from "vitest";
import { registerFormProblems, registerFormProblem } from "../../public/scripts/authMessages.js";
import { clearAreaBottom } from "../../public/scripts/walkthrough.js";
import { NAME_CHARS } from "../../server/corporationName.js";
import { CEO_NAME_MAX_LENGTH, CEO_NAME_MIN_LENGTH, EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../server/game/store.js";
import { CORPORATION_NAME_MAX_LENGTH, CORPORATION_NAME_MIN_LENGTH } from "../../server/corporationName.js";

// Bug #4861 (AB#955): the register form names every mistake at once, each saying what to fix, by the server's own rules.

const ok = { email: "ceo@example.com", password: "password123", ceoName: "Alex Rivera", corpName: "Helios Mining" };
const fields = (v) => registerFormProblems({ ...ok, ...v }).map((p) => p.field);
const text = (v, field) => registerFormProblems({ ...ok, ...v }).find((p) => p.field === field)?.text;

describe("Bug #4861 every mistake at once, each saying what to fix", () => {
  it("a form with four mistakes gets four messages, in the form's order, and a good form none", () => {
    expect(registerFormProblems(ok)).toEqual([]);
    expect(fields({ email: "ceo-at-corp", password: "short", ceoName: "A", corpName: "!!" })).toEqual(["email", "password", "ceoName", "corpName"]);
    expect(registerFormProblem({ ...ok, password: "short" })).toMatchObject({ field: "password" }); // the first, as before
  });

  it("says what is wrong with an email, not only that it is", () => {
    expect(text({ email: "" }, "email")).toBe("Enter the email address you will log in with.");
    expect(text({ email: "ceo-at-corp" }, "email")).toMatch(/has no @.*like name@example\.com/);
    expect(text({ email: "ceo@corp" }, "email")).toMatch(/not a complete email address/);
    expect(text({ email: `${"a".repeat(EMAIL_MAX_LENGTH)}@x.io` }, "email")).toMatch(/not a complete email address/);
  });

  it("gives the password's length against the server's bounds", () => {
    expect(text({ password: "short" }, "password")).toBe(`Use at least ${PASSWORD_MIN_LENGTH} characters; this has 5.`);
    expect(text({ password: "x".repeat(PASSWORD_MAX_LENGTH + 1) }, "password")).toBe(`Use at most ${PASSWORD_MAX_LENGTH} characters; this has ${PASSWORD_MAX_LENGTH + 1}.`);
    expect(fields({ password: "x".repeat(PASSWORD_MIN_LENGTH) })).toEqual([]);
  });

  it("checks both names' length and characters as the server does, spaces squashed first", () => {
    expect(text({ ceoName: "A" }, "ceoName")).toBe(`The CEO's name needs at least ${CEO_NAME_MIN_LENGTH} characters; this has 1.`);
    expect(text({ ceoName: "x".repeat(CEO_NAME_MAX_LENGTH + 1) }, "ceoName")).toMatch(/at most 40 characters/);
    expect(text({ corpName: "Ab" }, "corpName")).toBe(`The corporation's name needs at least ${CORPORATION_NAME_MIN_LENGTH} characters; this has 2.`);
    expect(text({ corpName: "x".repeat(CORPORATION_NAME_MAX_LENGTH + 1) }, "corpName")).toMatch(/at most 40 characters/);
    expect(text({ corpName: "Helios ☄ Mining" }, "corpName")).toMatch(/letters, digits, spaces and - ' \. & only/);
    expect(fields({ ceoName: "  Jo   Ng  ", corpName: "O'Neil & Sons-Mining." })).toEqual([]); // accepted by NAME_CHARS
    expect(NAME_CHARS.test("O'Neil & Sons-Mining.")).toBe(true); // the server's own rule agrees
  });
});

describe("Bug #4858 the clear area ends at the phone's fixed bottom nav", () => {
  it("takes the highest bottom bar, ignores bars in the upper half, and is the window's height with none", () => {
    expect(clearAreaBottom([706, 760], 812)).toBe(706);
    expect(clearAreaBottom([120], 812)).toBe(812); // a bar at the top is not a bottom bar
    expect(clearAreaBottom([], 812)).toBe(812);
    expect(clearAreaBottom([NaN, 900], 812)).toBe(812); // off screen or unmeasured
  });
});
