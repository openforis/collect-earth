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
    expect(result.current.error?.message).toBe("boom");
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous data while a retry is loading", async () => {
    const second = deferred<{ v: number }>();
    const fn = vi.fn().mockResolvedValueOnce({ v: 1 }).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useApi(fn, ["k"]));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ v: 1 });

    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toEqual({ v: 1 });

    await act(async () => second.resolve({ v: 2 }));
    expect(result.current.status).toBe("done");
    expect(result.current.data).toEqual({ v: 2 });
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

  it("does nothing while enabled is false and runs once enabled becomes true", async () => {
    const fn = vi.fn().mockResolvedValue({ v: 1 });
    const { result, rerender } = renderHook(({ enabled }) => useApi(fn, ["k"], { enabled }), {
      initialProps: { enabled: false },
    });
    expect(result.current.status).toBe("idle");
    expect(fn).not.toHaveBeenCalled();
    // Retrying while disabled is a no-op too.
    act(() => result.current.retry());
    expect(result.current.status).toBe("idle");
    expect(fn).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current.status).toBe("loading");
    expect(fn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ v: 1 });
  });

  it("disabling aborts an in-flight request, returns to idle and keeps the last data", async () => {
    const slow = deferred<{ v: number }>();
    const signals: AbortSignal[] = [];
    const fn = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return fn.mock.calls.length === 1 ? Promise.resolve({ v: 1 }) : slow.promise;
    });
    const { result, rerender } = renderHook(({ enabled }) => useApi(fn, ["k"], { enabled }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.status).toBe("done"));

    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    rerender({ enabled: false });
    expect(signals[1].aborted).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toEqual({ v: 1 });

    // The aborted request resolving later does not revive it.
    await act(async () => slow.resolve({ v: 2 }));
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toEqual({ v: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
