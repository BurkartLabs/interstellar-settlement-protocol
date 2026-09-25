import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loginErrorMessage, registerErrorMessage, registerFormProblem, loginFormProblem, LOGIN_LINK, REGISTER_LINK
} from "../../public/scripts/authMessages.js";

// Bug #1059: register and login errors say what to do next, and nothing sends a player to the demo account, which
// exists only on a developer's machine (ISP_DEV=1, never in production). Bug #1187: no stand-in corporation name.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");
/** A script's code without its comment lines. */
const code = (f) => read(f).split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");

describe("login errors (Bug #1059)", () => {
  it("a wrong email or password says so, and offers registering", () => {
    expect(loginErrorMessage(401)).toEqual({ text: "That email and password do not match. Check them and try again, or", link: REGISTER_LINK });
    expect(REGISTER_LINK).toEqual({ href: "/register.html", text: "register a new corporation." });
    expect(LOGIN_LINK).toEqual({ href: "/login.html", text: "Log in instead." });
  });

  it("a refused request shows the server's reason; a server or network failure says to try again in a minute", () => {
    expect(loginErrorMessage(400, { error: "Email is too long." }).text).toBe("Email is too long.");
    expect(loginErrorMessage(500).text).toMatch(/on our side\. Try again in a minute\.$/);
    expect(loginErrorMessage(0).text).toMatch(/could not be reached.*Try again in a minute\.$/);
    expect(loginErrorMessage(429).text).toMatch(/Too many attempts/);
  });

  it("asks for both fields before sending", () => {
    expect(loginFormProblem({ email: "", password: "x" })).toBe("Enter your email and password.");
    expect(loginFormProblem({ email: "a@b.c", password: "whatever" })).toBeNull();
  });
});

describe("register errors (Bug #1059)", () => {
  it("an email already registered offers the login", () => {
    expect(registerErrorMessage(400, { error: "An account with this email already exists.", code: "email-taken" }))
      .toEqual({ text: "An account with this email already exists.", link: LOGIN_LINK });
  });

  it("any other refusal shows the server's reason, which names what to fix", () => {
    expect(registerErrorMessage(400, { error: "A corporation with this name already exists." }))
      .toEqual({ text: "A corporation with this name already exists." });
    expect(registerErrorMessage(500).text).toMatch(/on our side\. Try again in a minute\.$/);
    expect(registerErrorMessage(0).text).toMatch(/could not be reached/);
  });

  it("names the missing field before sending, including an empty corporation or CEO name (Bug #1187, ISP-66)", () => {
    const ok = { email: "ceo@example.com", password: "password123", ceoName: "Alex Rivera", corpName: "Helios Mining" };
    expect(registerFormProblem(ok)).toBeNull();
    expect(registerFormProblem({ ...ok, email: "" })).toMatchObject({ field: "email" });
    expect(registerFormProblem({ ...ok, email: "no-at-sign" })).toMatchObject({ field: "email" });
    expect(registerFormProblem({ ...ok, password: "short" })).toMatchObject({ field: "password", text: expect.stringMatching(/at least 10 characters/) });
    expect(registerFormProblem({ ...ok, ceoName: "" })).toMatchObject({ field: "ceoName", text: expect.stringMatching(/^Enter the CEO's name/) });
    expect(registerFormProblem({ ...ok, corpName: "" })).toMatchObject({ field: "corpName", text: expect.stringMatching(/^Name your corporation/) });
  });

  it("the page sends the CEO and corporation names as typed, with no stand-in (Bug #1187, ISP-66)", () => {
    const page = code("public/scripts/register-page.js");
    expect(page).not.toMatch(/Frontier Protocol Ventures/);
    expect(page).not.toMatch(/["']New CEO["']/);
  });
});

describe("too many attempts says how long the wait really is (AB#2043)", () => {
  // The server's Retry-After, in seconds: one minute for logins per address, 15 for failed logins per account and 60
  // for registrations per address. Each is the time left, so it can be anything below its window too.
  it.each([
    [60, "Try again in a minute."],
    [45, "Try again in a minute."],
    [900, "Try again in 15 minutes."],
    [3600, "Try again in 60 minutes."],
    [2990, "Try again in 50 minutes."]
  ])("Retry-After %i seconds: %s", (seconds, wait) => {
    expect(loginErrorMessage(429, {}, seconds).text).toBe(`Too many attempts. ${wait}`);
    expect(registerErrorMessage(429, {}, seconds).text).toBe(`Too many attempts. ${wait}`);
  });

  it("with no usable header, the server's own sentence; with neither, a minute", () => {
    const payload = { error: "This request could not be processed. Too many attempts — try again in 60 minutes." };
    for (const header of [undefined, NaN, 0, -5]) {
      expect(registerErrorMessage(429, payload, header).text, String(header)).toBe(payload.error);
      expect(loginErrorMessage(429, payload, header).text, String(header)).toBe(payload.error);
    }
    expect(registerErrorMessage(429).text).toBe("Too many attempts. Try again in a minute.");
  });

  it("both pages hand the header to the message", () => {
    for (const page of ["public/scripts/login-page.js", "public/scripts/register-page.js"]) {
      expect(code(page), page).toMatch(/headers\.get\("Retry-After"\)/);
    }
  });
});

describe("no player-facing copy mentions the demo account (Bug #1059)", () => {
  it("only the developer button, hidden off a developer's machine, names it", () => {
    const html = read("public/login.html").replace(/<button id="dummy-login-btn"[^>]*>[^<]*<\/button>/, "");
    expect(html).not.toMatch(/dummy|prototype|sandbox|demo/i);
    expect(code("public/scripts/authMessages.js")).not.toMatch(/dummy|prototype|sandbox|demo/i);
    const page = code("public/scripts/login-page.js");
    expect(page.slice(page.indexOf("if (loginForm)"))).not.toMatch(/dummy account|demo account|sandbox/i);
  });
});
