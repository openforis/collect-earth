import { describe, expect, it } from "vitest";
import { collectImportQuery } from "./collectImportView";

describe("collectImportQuery", () => {
  it("sends only the accounts typed, trimmed", () => {
    expect(collectImportQuery({})).toBe("");
    expect(collectImportQuery({ anna: "  ", "Bob Smith": " bob " })).toBe(`?operators=${encodeURIComponent('{"Bob Smith":"bob"}')}`);
    expect(decodeURIComponent(collectImportQuery({ "José & co": "jose" }).slice("?operators=".length))).toBe('{"José & co":"jose"}');
  });
});
