import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAppInfo, type AppInfo } from "./appInfo";

const INFO: AppInfo = { project: "p", operator: "Jane Doe", language: "en", viewer: "plots_map", plotsMap: true, version: null };

describe("readAppInfo", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("tries again after a failed read, until one succeeds", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(INFO);
    const onInfo = vi.fn();
    readAppInfo(get, onInfo, 3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(onInfo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(onInfo).toHaveBeenCalledWith(INFO);
    await vi.advanceTimersByTimeAsync(10000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops trying once stopped, and drops an answer that comes after", async () => {
    const get = vi.fn().mockRejectedValue(new Error("down"));
    const stop = readAppInfo(get, vi.fn(), 3000);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(get).toHaveBeenCalledTimes(1);

    let answer: (info: AppInfo) => void = () => {};
    const onInfo = vi.fn();
    const stopLate = readAppInfo(() => new Promise<AppInfo>((r) => { answer = r; }), onInfo);
    stopLate();
    answer(INFO);
    await vi.advanceTimersByTimeAsync(0);
    expect(onInfo).not.toHaveBeenCalled();
  });
});
