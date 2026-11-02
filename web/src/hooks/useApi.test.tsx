import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useApi } from "./useApi";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useApi", () => {
  it("goes loading -> done and retries on error", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: 1 });
    const { result } = renderHook(() => useApi(fn, ["k"]));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale result when deps change while a request is in flight", async () => {
    const slow = deferred<{ v: string }>();
    const fast = deferred<{ v: string }>();
    const signals: AbortSignal[] = [];
    const fn = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return fn.mock.calls.length === 1 ? slow.promise : fast.promise;
    });
    const { result, rerender } = renderHook(({ key }) => useApi(fn, [key]), {
      initialProps: { key: "a" },
    });
    expect(result.current.status).toBe("loading");

    rerender({ key: "b" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    await act(async () => fast.resolve({ v: "second" }));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ v: "second" });

    await act(async () => slow.resolve({ v: "first" }));
    expect(result.current.status).toBe("done");
    expect(result.current.data).toEqual({ v: "second" });
  });
});
