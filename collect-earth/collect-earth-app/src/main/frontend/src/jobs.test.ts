import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiClient";
import { followJob, isOver, progressOf, resultPath, type JobInfo } from "./jobs";

const job = (state: JobInfo["state"], progress = 50): JobInfo =>
  ({ id: "j1", kind: "export", state, progress, step: "Exported records : 5/10", messages: [], result: null, error: null });

describe("jobs", () => {
  it("knows when a job is over and what to draw", () => {
    expect(isOver(null)).toBe(false);
    expect(isOver(job("RUNNING"))).toBe(false);
    expect(isOver(job("DONE"))).toBe(true);
    expect(isOver(job("FAILED"))).toBe(true);
    expect(progressOf(job("RUNNING", 42))).toBe(42);
    expect(progressOf(job("RUNNING", -1))).toBeNull();
    expect(progressOf(job("DONE", 130))).toBe(100);
    expect(progressOf(null)).toBeNull();
  });

  it("finds the file of a result", () => {
    expect(resultPath({ path: "/tmp/x.zip", records: 3 })).toBe("/tmp/x.zip");
    expect(resultPath({ imported: 3 })).toBeNull();
    expect(resultPath(null)).toBeNull();
    expect(resultPath("x")).toBeNull();
  });
});

describe("followJob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads the job until it is over, then stops", async () => {
    const answers = [job("RUNNING", 10), job("RUNNING", 60), job("DONE", 100)];
    let reads = 0;
    const seen: number[] = [];
    followJob("j1", () => Promise.resolve(answers[Math.min(reads++, 2)]), (j) => seen.push(j.progress), () => {}, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([10]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([10, 60]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([10, 60, 100]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toBe(3);
  });

  it("goes on after a failed read, but not after a job that is gone", async () => {
    let reads = 0;
    const errors: unknown[] = [];
    const seen: string[] = [];
    followJob("j1", () => {
      reads++;
      if (reads === 1) return Promise.reject(new ApiError("network", "Failed to fetch", 0));
      if (reads === 2) return Promise.resolve(job("RUNNING"));
      return Promise.reject(new ApiError("not-found", "gone", 404));
    }, (j) => seen.push(j.state), (e) => errors.push(e), 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["RUNNING"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(errors).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reads).toBe(3);
  });

  it("drops the answer of a read after it was stopped", async () => {
    const seen: JobInfo[] = [];
    const stop = followJob("j1", () => new Promise((resolve) => setTimeout(() => resolve(job("RUNNING")), 50)), (j) => seen.push(j), () => {}, 100);
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([]);
  });
});
