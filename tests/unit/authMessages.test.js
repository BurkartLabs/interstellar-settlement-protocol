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

  it("names the missing field before sending, including an empty corporation name (Bug #1187)", () => {
    const ok = { email: "ceo@example.com", password: "password123", corpName: "Helios Mining" };
    expect(registerFormProblem(ok)).toBeNull();
    expect(registerFormProblem({ ...ok, email: "" })).toMatch(/email/);
    expect(registerFormProblem({ ...ok, email: "no-at-sign" })).toMatch(/email/);
    expect(registerFormProblem({ ...ok, password: "short" })).toMatch(/at least 8 characters/);
    expect(registerFormProblem({ ...ok, corpName: "" })).toMatch(/^Name your corporation/);
  });

  it("the page sends the corporation name as typed, with no stand-in (Bug #1187)", () => {
    expect(code("public/scripts/register-page.js")).not.toMatch(/Frontier Protocol Ventures/);
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
