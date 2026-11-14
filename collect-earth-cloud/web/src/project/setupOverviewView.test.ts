import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { setupLines, type SetupFacts } from "./setupOverviewView";

const t = translator("en");
const facts: SetupFacts = {
  cepUpdatedAt: Date.UTC(2026, 10, 2, 12),
  plotFiles: 2,
  plots: 100,
  areasSet: false,
  imagery: ["Earth Engine app"],
  checksOn: true,
  deadline: "2026-12-31",
  shareLinks: 3,
  status: "active",
};
const text = (f: SetupFacts) => Object.fromEntries(setupLines(f, t, "en").map((l) => [l.view, l.text]));

describe("setup overview once every step is done", () => {
  it("has one line for each section but the overview, in Setup's order", () => {
    expect(setupLines(facts, t, "en").map((l) => l.view)).toEqual(["survey", "plots", "areas", "layout", "quality", "schedule", "sharing", "next", "project"]);
  });

  it("says where each section stands", () => {
    const lines = text(facts);
    expect(lines.plots).toBe("Plot files: 2. Plots: 100.");
    expect(lines.areas).toBe("None yet");
    expect(lines.quality).toBe("Automatic checks on");
    expect(lines.schedule).toBe("Deadline: Dec 31, 2026");
    expect(lines.sharing).toBe("Progress links: 3");
    expect(lines.layout).toBe("Earth Engine app");
    expect(lines.project).toBe("Project status: Active");
  });

  it("says no deadline, checks off, areas set and no imagery window", () => {
    const lines = text({ ...facts, deadline: "", checksOn: false, areasSet: true, imagery: [] });
    expect(lines.schedule).toBe("No deadline");
    expect(lines.quality).toBe("Automatic checks off");
    expect(lines.areas).toBe("Set");
    expect(lines.layout).toBe("No window besides Google Earth");
  });

  it("says nothing more of what is still loading", () => {
    const lines = text({ ...facts, areasSet: null, imagery: null, checksOn: null, deadline: null, shareLinks: null });
    expect([lines.areas, lines.layout, lines.quality, lines.schedule, lines.sharing]).toEqual([null, null, null, null, null]);
  });
});
