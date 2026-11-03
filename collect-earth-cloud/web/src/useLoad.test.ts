import { describe, expect, it } from "vitest";
import { landed, LocalChanges } from "./useLoad";

describe("what a finished load shows", () => {
  it("shows what was loaded when nothing was changed here meanwhile", () => {
    expect(landed({ n: 2 }, { n: 1 }, false)).toEqual({ n: 2 });
    expect(landed({ n: 2 }, null, true)).toEqual({ n: 2 });
  });

  it("keeps what was changed here after the load started: as it is, or merged into the loaded data", () => {
    expect(landed({ n: 2, mine: "old" }, { n: 1, mine: "new" }, true)).toEqual({ n: 1, mine: "new" });
    expect(landed({ n: 2, mine: "old" }, { n: 1, mine: "new" }, true, (fresh, prev) => ({ ...fresh, mine: prev.mine }))).toEqual({ n: 2, mine: "new" });
  });
});

describe("local changes counted for a load", () => {
  it("counts the changes since a load started, and starts again from nothing when the deps change (not on a reload)", () => {
    const changes = new LocalChanges();
    const first = changes.start(["p1"]);
    changes.change();
    expect(changes.since(first)).toBe(true);
    // A reload of the same thing: the changes so far still count against older loads.
    const reload = changes.start(["p1"]);
    expect(changes.count).toBe(1);
    expect(changes.since(reload)).toBe(false);
    // Another project: its data is another, the count starts again.
    const other = changes.start(["p2"]);
    expect(changes.count).toBe(0);
    expect(other).toBe(0);
    expect(changes.since(other)).toBe(false);
    changes.change();
    expect(changes.since(other)).toBe(true);
  });
});
