import { describe, expect, it } from "vitest";
import type { CsvFile, Member } from "./api";
import { fromPairs, pairKey } from "./assignmentGrid";

describe("the plot file / person grid", () => {
  const file: CsvFile = { id: "f1", filename: "north.csv", checksum: "x", plotCount: 3 };
  const me: Member = { userId: "me", username: "zoe", role: "admin" };

  it("a coordinator can give a file to themselves, alone in the project or not", () => {
    const ticked = new Set([pairKey("f1", "me")]);
    expect(fromPairs(ticked, [file], [me])).toEqual([{ userId: "me", csvFileId: "f1" }]);
    expect(fromPairs(ticked, [file], [{ userId: "u1", username: "ana", role: "operator" }, me])).toEqual([{ userId: "me", csvFileId: "f1" }]);
  });
});
