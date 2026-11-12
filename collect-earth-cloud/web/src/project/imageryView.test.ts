import { describe, expect, it } from "vitest";
import { extraMapWarning, imageryChanges, imageryErrors, isShown, planetMonths, shownImagery } from "./imageryView";

const demo = { open_earth_map: "true", open_gee_app: "TRUE", extra_map_url: "http://x/#PLOT_ID", planet_tfo_date_from: "Oldest" };
const today = new Date(2026, 10, 12);

describe("imagery windows card", () => {
  it("shows the stored values as Collect Earth's settings do", () => {
    expect(shownImagery(demo)).toEqual({
      open_gee_app: "true", open_earth_map: "true", open_esri_wayback: "false", planet_maps_use_tfo: "false",
      geeapp_date_from: "", geeapp_date_to: "", planet_tfo_date_from: "", planet_tfo_date_to: "", extra_map_url: "http://x/#PLOT_ID",
    });
  });

  it("shows the dates with the Earth Engine app and the months with the TFO mosaics", () => {
    const v = shownImagery(demo);
    expect(isShown("geeapp_date_from", v)).toBe(true);
    expect(isShown("planet_tfo_date_to", v)).toBe(false);
    expect(isShown("planet_tfo_date_to", { ...v, planet_maps_use_tfo: "true" })).toBe(true);
  });

  it("offers the Planet mosaics published by today", () => {
    const months = planetMonths(today);
    expect(months[0]).toEqual({ value: "2015-12_2016-05", label: "2015/12 - 2016/05" });
    expect(months.at(-1)).toEqual({ value: "2026-10", label: "2026/10" });
    expect(planetMonths(new Date(2026, 10, 9)).at(-1)?.value).toBe("2026-09");
    expect(months.map((m) => m.value)).toContain("2020-09");
  });

  it("checks the dates and the extra map as Collect Earth does", () => {
    const v = shownImagery(demo);
    expect(imageryErrors(v, today)).toEqual({});
    expect(imageryErrors({ ...v, geeapp_date_from: "1999-01-01", extra_map_url: "file:///x" }, today)).toEqual({ geeapp_date_from: "file.imagery.date", extra_map_url: "file.imagery.url" });
    expect(imageryErrors({ ...v, geeapp_date_from: "2020-01-01", geeapp_date_to: "2019-01-01" }, today)).toEqual({ geeapp_date_to: "file.imagery.dateOrder" });
    expect(imageryErrors({ ...v, geeapp_date_from: "2026-11-13" }, today)).toEqual({ geeapp_date_from: "file.imagery.date" });
    // Hidden with the app off: not checked
    expect(imageryErrors({ ...v, open_gee_app: "false", geeapp_date_from: "x" }, today)).toEqual({});
    expect(extraMapWarning("https://x/")).toBe("file.imagery.noPlaceholder");
    expect(extraMapWarning("https://x/?lat=LATITUDE")).toBe("file.imagery.latLong");
    expect(extraMapWarning("https://x/?lat=LATITUDE&lon=LONGITUDE")).toBeNull();
  });

  it("sends what changed of the fields shown", () => {
    const initial = shownImagery(demo);
    expect(imageryChanges(initial, initial)).toEqual({});
    expect(imageryChanges(initial, { ...initial, open_earth_map: "false", open_esri_wayback: "true" })).toEqual({ open_earth_map: "false", open_esri_wayback: "true" });
    expect(imageryChanges(initial, { ...initial, open_gee_app: "false", geeapp_date_from: "2020-01-01" })).toEqual({ open_gee_app: "false" });
  });
});
