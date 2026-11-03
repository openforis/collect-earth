import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounced, latestOnly } from "./settingsApi";

describe("latestOnly", () => {
  it("drops the answer of a call started before a later one", async () => {
    const pending: { resolve: (v: string) => void; signal: AbortSignal }[] = [];
    const fn = latestOnly((signal: AbortSignal, _value: string) => new Promise<string>((resolve) => pending.push({ resolve, signal })));
    const first = fn("a");
    const second = fn("b");
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
    pending[0].resolve("answer to a");
    pending[1].resolve("answer to b");
    expect(await first).toBeUndefined();
    expect(await second).toBe("answer to b");
  });

  it("answers a call that was not followed by another", async () => {
    const fn = latestOnly((_signal: AbortSignal, value: number) => Promise.resolve(value * 2));
    expect(await fn(21)).toBe(42);
  });

  it("throws the failure of the latest call only", async () => {
    let n = 0;
    const fn = latestOnly((_signal: AbortSignal) => Promise.reject(new Error("failed " + ++n)));
    const first = fn();
    const second = fn();
    expect(await first).toBeUndefined();
    await expect(second).rejects.toThrow("failed 2");
  });
});

describe("debounced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls once, after the last of a burst, with its arguments", () => {
    const calls: string[] = [];
    const fn = debounced((v: string) => calls.push(v), 300);
    fn("a");
    vi.advanceTimersByTime(200);
    fn("b");
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["b"]);
  });

  it("can be cancelled", () => {
    const calls: string[] = [];
    const fn = debounced((v: string) => calls.push(v), 300);
    fn("a");
    fn.cancel();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
  });
});
