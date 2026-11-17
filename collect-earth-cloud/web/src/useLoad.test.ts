import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { samePlace } from "./queryClient";

describe("when an answer was last loaded (useLoad's dataUpdatedAt)", () => {
  it("moves on when the server answers the same again, though the data stays the same object", async () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const client = new QueryClient();
      const load = () => Promise.resolve({ done: 3 });
      const first = await client.fetchQuery({ queryKey: ["k"], queryFn: load });
      vi.setSystemTime(61_000);
      await client.refetchQueries({ queryKey: ["k"] });
      // The same object: an effect on [data] would not run again, the "Updated N min ago" would stay at the first load.
      expect(client.getQueryData(["k"])).toBe(first);
      expect(client.getQueryState(["k"])?.dataUpdatedAt).toBe(61_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what a screen keeps showing while its next answer loads", () => {
  it("the last answer of the same project, or of the same kind outside any project", () => {
    expect(samePlace(["project", "p1", "getPerson", "u1"], ["project", "p1", "getPerson", "u2"])).toBe(true);
    expect(samePlace(["project", "p1", "getOverview"], ["project", "p2", "getOverview"])).toBe(false);
    expect(samePlace(["app", "listUsers", { page: 1 }], ["app", "listUsers", { page: 2 }])).toBe(true);
    expect(samePlace(["app", "listUsers"], ["project", "p1", "listUsers"])).toBe(false);
  });
});
