import { afterEach, describe, expect, it } from "vitest";
import { newBuildAvailable, newBuildFound, onNewBuild, resetBuildWatch, watchBuild } from "./newVersion";

describe("a page left open across an upgrade", () => {
  afterEach(resetBuildWatch);

  it("offers to reload only when the server serves another build", () => {
    expect(newBuildAvailable("aaa", "bbb")).toBe(true);
    expect(newBuildAvailable("aaa", "aaa")).toBe(false);
    // The development server serves no build; a page whose build is not known waits for one it knows.
    expect(newBuildAvailable(null, "bbb")).toBe(false);
    expect(newBuildAvailable("aaa", null)).toBe(false);
  });

  it("asks after each wait until the build changes, retries a failed ask, and tells the listeners once", async () => {
    const answers: (string | Error)[] = ["aaa", new Error("offline"), "bbb"];
    const waits: (() => void)[] = [];
    let told = 0;
    onNewBuild(() => told++);
    watchBuild("aaa", async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }, (action) => waits.push(action));
    // Watching again (another screen) changes nothing
    watchBuild("zzz", async () => "zzz", (action) => waits.push(action));
    expect(waits).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      waits.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(newBuildFound()).toBe(true);
    expect(told).toBe(1);
    // Found: no more asking
    expect(waits).toHaveLength(0);
  });

  it("does not ask when the page's build is not known", () => {
    const waits: (() => void)[] = [];
    watchBuild(null, async () => "bbb", (action) => waits.push(action));
    expect(waits).toHaveLength(0);
    expect(newBuildFound()).toBe(false);
  });
});
