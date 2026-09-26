// AB#987 (ISP-280), slice 1: one mail module with one interface, and a test transport that captures to an in-memory
// outbox and refuses to load under NODE_ENV=production. The real provider is AB#989's.

import { afterEach, describe, expect, it, vi } from "vitest";

const savedEnv = { NODE_ENV: process.env.NODE_ENV, ISP_PUBLIC_URL: process.env.ISP_PUBLIC_URL };
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

describe("the test transport (AB#987)", () => {
  it("captures what is sent to an in-memory outbox", async () => {
    const { sendMail, testOutbox, clearTestOutbox } = await import("../../server/mail.js");
    clearTestOutbox();
    await sendMail({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(testOutbox()).toEqual([expect.objectContaining({ to: "a@example.com", subject: "Hello", text: "Body" })]);
  });

  it("refuses to load under NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    await expect(import("../../server/mailTestTransport.js")).rejects.toThrow(/production/);
  });

  it("in production with no real transport, mail is unavailable and sending fails closed", async () => {
    process.env.NODE_ENV = "production";
    process.env.ISP_PUBLIC_URL = "https://isp.example";
    const { mailAvailable, sendMail, testOutbox } = await import("../../server/mail.js");
    expect(await mailAvailable()).toBe(false);
    await expect(sendMail({ to: "a@example.com", subject: "s", text: "t" })).rejects.toThrow(/not available/);
    expect(() => testOutbox()).toThrow(/production/);
  });
});

describe("links are built from a configured base URL, never a request's Host (AB#987)", () => {
  it("uses ISP_PUBLIC_URL, without a trailing slash", async () => {
    process.env.ISP_PUBLIC_URL = "https://isp.example/";
    const { publicBaseUrl } = await import("../../server/mail.js");
    expect(publicBaseUrl()).toBe("https://isp.example");
  });

  it("refuses a base URL that is not http(s), and in production has no default", async () => {
    process.env.ISP_PUBLIC_URL = "javascript:alert(1)";
    let { publicBaseUrl } = await import("../../server/mail.js");
    expect(publicBaseUrl()).toBeNull();
    vi.resetModules();
    delete process.env.ISP_PUBLIC_URL;
    process.env.NODE_ENV = "production";
    ({ publicBaseUrl } = await import("../../server/mail.js"));
    expect(publicBaseUrl()).toBeNull();
  });

  it("outside production, with none configured, it is the local server", async () => {
    delete process.env.ISP_PUBLIC_URL;
    process.env.NODE_ENV = "test";
    const { publicBaseUrl } = await import("../../server/mail.js");
    expect(publicBaseUrl()).toMatch(/^http:\/\/localhost:\d+$/);
  });
});
