import { describe, expect, it } from "vitest";
import { Bool, Field, makeData, Schema, Table, tableFromIPC, Utf8, vectorFromArray, Vector } from "apache-arrow";
import { toIpc } from "./arrowIpc";

/** A Bool column of nulls as DuckDB gives it: the values buffer is there, all the rows are null. */
function nullBools(length: number): Vector<Bool> {
  return new Vector([makeData({ type: new Bool(), length, nullCount: length, nullBitmap: new Uint8Array(1), data: new Uint8Array(1) })]);
}

describe("toIpc", () => {
  it("keeps a yes/no column that has no answer at all readable (Arrow JS wrote it without its values, Perspective refused the table)", () => {
    const table = new Table({ submitted: vectorFromArray([true, false, true, null, true, false], new Bool()), unanswered: nullBools(6) });
    const back = tableFromIPC(new Uint8Array(toIpc(table)));
    expect(back.numRows).toBe(6);
    const unanswered = back.getChild("unanswered")!;
    expect(unanswered.toArray()).toEqual(new Array(6).fill(null));
    expect(unanswered.type).toBeInstanceOf(Utf8);
    // a column with answers stays a yes/no column, its values written
    const submitted = back.getChild("submitted")!;
    expect(submitted.type).toBeInstanceOf(Bool);
    expect(submitted.data[0].values.byteLength).toBeGreaterThan(0);
    expect([...submitted]).toEqual([true, false, true, null, true, false]);
  });

  it("gives an ArrayBuffer of its own, not a view on a larger one", () => {
    const table = new Table(new Schema([Field.new("n", new Utf8(), true)]));
    const bytes = toIpc(table);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
  });
});
