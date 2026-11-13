// The view logic of Strata and areas (project/StrataAreas.tsx, docs/plans/2026-11-11-strata-areas.md): the areas typed,
// the setting they make, and the areas a plot design knows.
import type { AreaSettings, AreasAnswer, DesignFacts, DesignPlan } from "./api";

/** A stratum's key: its values. */
export const stratumKey = (values: readonly string[]) => values.join("\u0000");

/** The decimal mark of a language: "." or ",". */
function decimalMarkOf(language: string): string {
  try {
    return new Intl.NumberFormat(language).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
  } catch {
    return ".";
  }
}

/**
 * An area as typed; null when empty, NaN when not a number. With both a dot and a comma, the last one is the decimal
 * mark; one mark used twice separates thousands; one mark once is the decimals, but before exactly three digits
 * ("1,000", "1.000") it is what the person's language makes it.
 */
export function typedArea(text: string, language: string): number | null {
  const t = text.replace(/\s/g, "");
  if (t === "") return null;
  const marks = t.replace(/[^.,]/g, "");
  const decimal =
    marks === "" ? null
    : marks.includes(".") && marks.includes(",") ? marks[marks.length - 1]
    : marks.length > 1 ? null
    : !/[.,]\d{3}$/.test(t) || decimalMarkOf(language) === marks ? marks
    : null;
  const plain = decimal === null ? t.replace(/[.,]/g, "") : t.replace(decimal === "." ? /,/g : /\./g, "").replace(decimal, ".");
  const n = /^\d*\.?\d*$/.test(plain) ? Number(plain) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

/** An area to show in a field: in the person's language, read back the same by typedArea. */
export function shownArea(area: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 6 }).format(area);
  } catch {
    return String(area);
  }
}

/** Each stratum's area: the one typed (by key), else the saved one. */
export function areasOf(strata: AreasAnswer["strata"], typed: Readonly<Record<string, string>>, language: string): (number | null)[] {
  return strata.map((s) => {
    const text = typed[stratumKey(s.values)];
    return text === undefined ? s.area : typedArea(text, language);
  });
}

/** The strata setting of the columns and the areas: the strata with an area (a stratum left empty stands for none). */
export function strataSettings(columns: readonly string[], strata: AreasAnswer["strata"], areas: readonly (number | null)[]): Extract<AreaSettings, { mode: "strata" }> {
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
