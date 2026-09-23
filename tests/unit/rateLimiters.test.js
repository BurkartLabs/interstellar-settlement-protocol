import { describe, it, expect, vi, afterEach } from "vitest";
import { failOpenStore } from "../../server/rateLimiters.js";

describe("failOpenStore (ISP-64)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs and reports a non-limiting result when increment fails, instead of throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenStore = {
      localKeys: true,
      init: () => {},
      increment: vi.fn().mockRejectedValue(new Error("store is down")),
      decrement: vi.fn(),
      resetKey: vi.fn()
    };
    const store = failOpenStore(brokenStore, "test-limiter");

    const result = await store.increment("some-key");

    expect(result).toEqual({ totalHits: 0, resetTime: undefined });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/test-limiter/);
  });

  it("passes increment through unchanged when the underlying store is healthy", async () => {
    const healthyStore = {
      localKeys: true,
      init: () => {},
      increment: vi.fn().mockResolvedValue({ totalHits: 4, resetTime: new Date() }),
      decrement: vi.fn(),
      resetKey: vi.fn()
    };
    const store = failOpenStore(healthyStore, "test-limiter");

    const result = await store.increment("some-key");

    expect(result.totalHits).toBe(4);
  });

  it("logs but does not throw when decrement or resetKey fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenStore = {
      localKeys: true,
      init: () => {},
      increment: vi.fn(),
      decrement: vi.fn().mockRejectedValue(new Error("nope")),
      resetKey: vi.fn().mockRejectedValue(new Error("nope"))
    };
    const store = failOpenStore(brokenStore, "test-limiter");

    await expect(store.decrement("k")).resolves.toBeUndefined();
    await expect(store.resetKey("k")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
