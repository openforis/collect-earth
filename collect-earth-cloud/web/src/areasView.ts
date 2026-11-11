// The view logic of Strata and areas (project/StrataAreas.tsx, docs/plans/2026-11-11-strata-areas.md): the areas typed,
// the setting they make, and the areas a plot design knows.
import type { AreaSettings, AreasData, DesignFacts, DesignPlan } from "./api";

/** A stratum's key: its values. */
export const stratumKey = (values: readonly string[]) => values.join("\u0000");

/** An area as typed: a comma or a dot for the decimals, spaces for thousands; null when empty, NaN when not a number. */
export function typedArea(text: string): number | null {
  const t = text.replace(/[\s  ]/g, "");
  if (t === "") return null;
  const n = Number(t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

/** Each stratum's area: the one typed (by key), else the saved one. */
export function areasOf(strata: AreasData["strata"], typed: Readonly<Record<string, string>>): (number | null)[] {
  return strata.map((s) => {
    const text = typed[stratumKey(s.values)];
    return text === undefined ? s.area : typedArea(text);
  });
}

/** The strata setting of the columns and the areas: the strata with an area (a stratum left empty stands for none). */
export function strataSettings(columns: readonly string[], strata: AreasData["strata"], areas: readonly (number | null)[]): AreaSettings {
  return {
    mode: "strata",
    columns: [...columns],
    strata: strata.flatMap((s, i) => (areas[i] !== null && Number.isFinite(areas[i]) ? [{ values: s.values, area: areas[i]! }] : [])),
  };
}

/** Hectares, at most two decimals. */
const ha = (km2: number) => Math.round(km2 * 100 * 100) / 100;

/**
 * The areas a plot design knows: a design within strata, each stratum's (in the plot file's `stratum` column); any
 * other, the area of interest's total.
 */
export function designAreas(plan: Pick<DesignPlan, "strata">, facts: Pick<DesignFacts, "areaKm2">): AreaSettings {
  return plan.strata
    ? { mode: "strata", columns: ["stratum"], strata: plan.strata.map((s) => ({ values: [s.value], area: ha(s.areaKm2) })) }
    : { mode: "total", area: ha(facts.areaKm2) };
}
