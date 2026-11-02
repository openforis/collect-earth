import { describe, expect, it } from "vitest";
import { addMapPage, MAP_STATUSES, OSM_TILES, type MapPlots } from "./api";
import { attributionHtml, boundsOf, CLUSTER_FROM, filesOffMap, plotPopup, shownIndexes, STATUS_STYLE, statusLabelKey, statusDrawnKey, symbolSvg } from "./mapView";

function map(): MapPlots {
  return addMapPage(null, {
    version: "v",
    offset: 0,
    total: 4,
    points: [
      [10, 20, 0, 0],
      [-5, 30, 2, 1],
      [12, -40, 5, -1],
      [0, 0, 2, 0],
    ],
    plots: ["1", "2", "3", "4"],
    counts: [1, 0, 2, 0, 0, 1],
    notOnMap: 2,
    files: [
      { id: "a", filename: "a.csv", plots: 4, onMap: 4 },
      { id: "b", filename: "b.csv", plots: 2, onMap: 0 },
    ],
    people: ["ana", "ben"],
    holders: [["ana"], ["ana", "ben"]],
  });
}

describe("map of progress", () => {
  it("clusters from about 5,000 plots", () => {
    expect(CLUSTER_FROM).toBe(5000);
  });

  it("draws each status its own way, not by colour alone, and names it", () => {
    const styles = MAP_STATUSES.map((s) => STATUS_STYLE[s]);
    // Every status differs from every other in something besides its colour (fill, outline width or dashes).
    for (let i = 0; i < styles.length; i++) {
      for (let j = i + 1; j < styles.length; j++) {
        const a = styles[i];
        const b = styles[j];
        expect([a.fillOpacity, a.weight, a.dashArray ?? "", a.radius].join() === [b.fillOpacity, b.weight, b.dashArray ?? "", b.radius].join(), `${MAP_STATUSES[i]} / ${MAP_STATUSES[j]}`).toBe(false);
      }
    }
    expect(new Set(styles.map((s) => s.color)).size).toBe(MAP_STATUSES.length);
    expect(statusLabelKey("differs")).toBe("map.status.differs");
    expect(statusDrawnKey("notStarted")).toBe("map.drawn.notStarted");
    const svg = symbolSvg("started");
    expect(svg).toContain("<svg");
    expect(svg).toContain(`stroke="${STATUS_STYLE.started.color}"`);
    expect(svg).toContain("stroke-dasharray");
  });

  it("shows the statuses asked for, and the area they cover", () => {
    const m = map();
    expect([...shownIndexes(m, new Set(MAP_STATUSES))]).toEqual([0, 1, 2, 3]);
    expect([...shownIndexes(m, new Set(["submitted"]))]).toEqual([1, 3]);
    expect([...shownIndexes(m, new Set())]).toEqual([]);
    expect(boundsOf(m, shownIndexes(m, new Set(MAP_STATUSES)))).toEqual([
      [-5, -40],
      [12, 30],
    ]);
    expect(boundsOf(m, new Uint32Array(0))).toBeNull();
  });

  it("a plot's popup: its id, status, its people for coordinators, and its page", () => {
    const m = map();
    expect(plotPopup(m, 1, "p 1")).toEqual({ plot: "2", label: "2", status: "submitted", people: ["ana", "ben"], path: "/projects/p%201/quality/plot/2" });
    // The id the collector sees, as plot search lists it.
    expect(plotPopup({ ...m, plots: ["1,2025"], names: ["1"] }, 0, "p")).toMatchObject({ plot: "1,2025", label: "1,2025 (1)", path: "/projects/p/quality/plot/1%2C2025" });
    expect(plotPopup(m, 2, "p")).toMatchObject({ plot: "3", status: "differs", people: [] });
    const reviewer = { ...m, people: null, holders: null };
    expect(plotPopup(reviewer, 0, "p").people).toBeNull();
  });

  it("lists the files with plots off the map", () => {
    expect(filesOffMap(map())).toEqual([{ id: "b", filename: "b.csv", plots: 2, onMap: 0 }]);
  });

  it("writes the attribution as the tile source asks, escaped", () => {
    expect(attributionHtml(OSM_TILES)).toBe('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>');
    expect(attributionHtml({ ...OSM_TILES, attribution: '<b>"Mine" & co</b>', attributionUrl: null })).toBe("&lt;b&gt;&quot;Mine&quot; &amp; co&lt;/b&gt;");
  });
});
