import { describe, expect, it } from "vitest";
import { emptyRequest, lastExportText, missing, nameKey, recordsFor, replaceFileName, withFormat } from "./exportDialog";

describe("export dialog", () => {
  it("offers the records the Swing menu offered per format", () => {
    expect(recordsFor("XML")).toEqual(["ALL", "SINCE_LAST_EXPORT", "FROM_DATE", "BY_ATTRIBUTE"]);
    expect(recordsFor("BACKUP")).toEqual(["ALL", "FROM_DATE"]);
    expect(recordsFor("CSV")).toEqual(["ALL"]);
    expect(recordsFor("KML")).toEqual(["ALL"]);
  });

  it("keeps the records on a format change when the format offers them, else all", () => {
    const byAttribute = { ...emptyRequest(), records: "BY_ATTRIBUTE" as const };
    expect(withFormat(byAttribute, "BACKUP").records).toBe("ALL");
    expect(withFormat({ ...emptyRequest(), records: "FROM_DATE" }, "BACKUP").records).toBe("FROM_DATE");
    expect(withFormat(byAttribute, "XML").records).toBe("BY_ATTRIBUTE");
    expect(withFormat(byAttribute, "CSV").format).toBe("CSV");
  });

  it("says what is missing before the export", () => {
    const attributes = [{ id: "KEY:0" }];
    expect(missing({ ...emptyRequest(), path: "/tmp/x.zip" }, attributes)).toEqual([]);
    expect(missing(emptyRequest(), attributes)).toEqual(["DataPage.export.noPath"]);
    expect(missing({ ...emptyRequest(), records: "FROM_DATE", path: "p" }, attributes)).toEqual(["DataPage.export.noDate"]);
    expect(missing({ ...emptyRequest(), records: "FROM_DATE", fromDate: "2026-10-01", path: "p" }, attributes)).toEqual([]);
    expect(missing({ ...emptyRequest(), records: "BY_ATTRIBUTE", path: "p" }, attributes)).toEqual(["DataPage.export.noAttribute", "ExportActionListener.8"]);
    expect(missing({ ...emptyRequest(), records: "BY_ATTRIBUTE", attribute: "KEY:0", value: " AB* ", path: "p" }, attributes)).toEqual([]);
    expect(missing({ ...emptyRequest(), records: "BY_ATTRIBUTE", path: "p" }, [])).toEqual(["ExportActionListener.7", "ExportActionListener.8"]);
  });

  it("knows what the suggested name depends on", () => {
    const a = emptyRequest();
    expect(nameKey(a)).toBe(nameKey({ ...a, path: "/x", includeLabels: true }));
    expect(nameKey(a)).not.toBe(nameKey({ ...a, format: "CSV" }));
    expect(nameKey({ ...a, value: "AB" })).toBe(nameKey({ ...a, value: " AB " }));
  });

  it("replaces the file name of a path, with either separator", () => {
    expect(replaceFileName("/home/me/old.zip", "new.csv")).toBe("/home/me/new.csv");
    expect(replaceFileName("C:\\data\\old.zip", "new.csv")).toBe("C:\\data\\new.csv");
    expect(replaceFileName("old.zip", "new.csv")).toBe("new.csv");
  });

  it("writes the last export in the locale, or nothing", () => {
    expect(lastExportText(null)).toBeNull();
    expect(lastExportText(Date.UTC(2026, 9, 30, 12, 0), "en-GB")).toContain("2026");
  });
});
