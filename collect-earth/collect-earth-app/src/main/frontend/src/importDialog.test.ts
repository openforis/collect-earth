import { describe, expect, it } from "vitest";
import { canImport, csvFilesOf, overwritePaths, totals, type ImportFileSummary } from "./importDialog";

const conflict = { keys: ["p1"], modified: 1, completion: 50, existingModified: 2, existingCompletion: 80 };
const files: ImportFileSummary[] = [
  { path: "/a.zip", name: "a.zip", toImport: 3, conflicts: [conflict, conflict], errors: [] },
  { path: "/b.zip", name: "b.zip", toImport: 1, conflicts: [], errors: [] },
  { path: "/c.zip", name: "c.zip", toImport: 0, conflicts: [], errors: ["not a zip"] },
];

describe("import dialog", () => {
  it("sends the files whose conflicts are to be overwritten", () => {
    expect(overwritePaths(files, { "/a.zip": true, "/b.zip": true })).toEqual(["/a.zip"]);
    expect(overwritePaths(files, {})).toEqual([]);
    expect(overwritePaths(files, { "/a.zip": false })).toEqual([]);
  });

  it("counts what will be imported", () => {
    expect(totals(files, {})).toEqual({ toImport: 4, overwritten: 0, kept: 2, failed: 1, total: 4 });
    expect(totals(files, { "/a.zip": true })).toEqual({ toImport: 4, overwritten: 2, kept: 0, failed: 1, total: 6 });
  });

  it("imports only with a token and something to import", () => {
    expect(canImport({ token: "t", files }, {})).toBe(true);
    expect(canImport({ token: null, files }, {})).toBe(false);
    expect(canImport(null, {})).toBe(false);
    const onlyConflicts = [{ path: "/a.zip", name: "a.zip", toImport: 0, conflicts: [conflict], errors: [] }];
    expect(canImport({ token: "t", files: onlyConflicts }, {})).toBe(false);
    expect(canImport({ token: "t", files: onlyConflicts }, { "/a.zip": true })).toBe(true);
  });

  it("reads the files of a CSV update result", () => {
    expect(csvFilesOf({ files: [{ path: "/u.csv", name: "u.csv", updated: 2, errors: [] }] })).toHaveLength(1);
    expect(csvFilesOf(null)).toEqual([]);
    expect(csvFilesOf({})).toEqual([]);
  });
});
