import { describe, expect, it } from "vitest";
import { anchorLabel, droppedKind, formatPercent, looksLikeInvitation } from "./project";

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
