import { describe, expect, it } from "vitest";
import { anchorLabel, cloudSendResultOf, droppedKind, droppedRefusal, formatPercent, looksLikeInvitation } from "./project";

describe("the result of sending the records to the cloud project", () => {
  it("is read from the job's result, and is all zeros when there is none", () => {
    const reasons = [{ reason: "malformed envelope", count: 2 }];
    expect(cloudSendResultOf({ total: 5, sent: 3, refused: 2, reasons })).toEqual({ total: 5, sent: 3, refused: 2, reasons });
    expect(cloudSendResultOf(null)).toEqual({ total: 0, sent: 0, refused: 0, reasons: [] });
    expect(cloudSendResultOf({ sent: "3", reasons: "x" })).toEqual({ total: 0, sent: 0, refused: 0, reasons: [] });
  });
});

describe("the dropped files", () => {
  it("are told apart by their extension", () => {
    expect(droppedKind("kenya.CEP")).toBe("cep");
    expect(droppedKind("plots.csv")).toBe("plots");
    expect(droppedKind("plots.ced")).toBe("plots");
    expect(droppedKind("points.kml")).toBe("kml");
    expect(droppedKind("points.kmz")).toBe("kml");
    expect(droppedKind("notes.txt")).toBeNull();
    expect(droppedKind("README")).toBeNull();
  });

  it("cannot replace the plots of a cloud project, which are the ones its coordinator assigned", () => {
    expect(droppedRefusal("plots", true)).toBe("SettingsPage.sampleFile.cloudAssigned");
    expect(droppedRefusal("kml", true)).toBe("ToolsPage.kml.cloudProject");
    expect(droppedRefusal("cep", true)).toBeNull();
    for (const kind of ["plots", "kml", "cep"] as const) expect(droppedRefusal(kind, false)).toBeNull();
    expect(droppedRefusal("plots", undefined)).toBeNull();
  });
});

describe("the invitation link", () => {
  it("has a token after /join/", () => {
    expect(looksLikeInvitation(" https://cloud.example.org/join/abc123 ")).toBe(true);
    expect(looksLikeInvitation("https://cloud.example.org/join/abc123/?x=1")).toBe(true);
    expect(looksLikeInvitation("https://cloud.example.org/join/")).toBe(false);
    expect(looksLikeInvitation("https://cloud.example.org/abc")).toBe(false);
    expect(looksLikeInvitation("")).toBe(false);
  });
});

describe("the texts", () => {
  it("fill the %s of the Swing texts in order", () => {
    expect(formatPercent("Join \"%s\" as %s", "Kenya", "interpreter")).toBe("Join \"Kenya\" as interpreter");
    expect(formatPercent("No placeholders")).toBe("No placeholders");
  });

  it("take the label out of an anchor", () => {
    expect(anchorLabel("<a href='https://www.openforis.org'>For more information visit our website OpenForis.org</a>")).toBe("For more information visit our website OpenForis.org");
    expect(anchorLabel("CHECK THE CHANGE LOG")).toBe("CHECK THE CHANGE LOG");
  });
});
