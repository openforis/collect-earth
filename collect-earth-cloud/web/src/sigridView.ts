import type { SigridFacts } from "./api";

/** The plot file's name: SIGRID_Benin_8km.csv. */
export const sigridFileName = (file: string, spacingKm: number) => `SIGRID_${file}_${spacingKm}km.csv`;

/** Every district of the country, for picking: its province, its name, and the value the picker compares. */
export function districtOptions(facts: SigridFacts): { province: string; district: string; key: string }[] {
  return facts.provinces.flatMap((p) => p.districts.filter((d) => d.name !== "").map((d) => ({ province: p.name, district: d.name, key: `${p.name}\u0000${d.name}` })));
}

/** The spacing to start with: the finest whose plots are within the limit (else the coarsest). */
export function firstSpacing(facts: SigridFacts): number | null {
  const at = facts.selected.findIndex((n) => n <= facts.max);
  return facts.spacings[at < 0 ? facts.spacings.length - 1 : at] ?? null;
}
