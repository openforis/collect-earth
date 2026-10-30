import { describe, expect, it } from "vitest";
import { landed } from "./useLoad";

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
