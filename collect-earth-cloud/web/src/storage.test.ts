import { afterEach, describe, expect, it, vi } from "vitest";
import { getToken, onOtherTabToken, setToken } from "./storage";

afterEach(() => vi.unstubAllGlobals());

describe("the session token across tabs", () => {
  it("follows another tab logging out and in", () => {
    const stored = new Map<string, string>();
    let handler: ((e: { key: string | null }) => void) | null = null;
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) },
      addEventListener: (_: string, h: typeof handler) => (handler = h),
      removeEventListener: () => (handler = null),
    });
    setToken("mine");
    const told: (string | null)[] = [];
    const off = onOtherTabToken((t) => told.push(t));
    // the other tab logs out: this tab's own copy goes too
    stored.delete("collectEarthCloud.session");
    handler!({ key: "collectEarthCloud.session" });
    expect(getToken()).toBeNull();
    stored.set("collectEarthCloud.session", "theirs");
    handler!({ key: "collectEarthCloud.session" });
    handler!({ key: "collectEarthCloud.language" });
    expect(told).toEqual([null, "theirs"]);
    expect(getToken()).toBe("theirs");
    off();
    expect(handler).toBeNull();
  });
});
