import type { PlotDesign } from "./api";

/** What the plot design form holds, as typed. */
export interface DesignForm {
  method: PlotDesign["method"];
  count: string;
  spacing: string;
  randomOffset: boolean;
  field: string;
  allocation: "equal" | "proportional";
}

/** The design the form asks for, or null while it is not complete (a count or spacing missing or out of range). */
export function designOf(form: DesignForm, max: number): PlotDesign | null {
  const count = Number(form.count);
  const countOk = Number.isInteger(count) && count >= 1 && count <= max;
  if (form.method === "random") return countOk ? { method: "random", count } : null;
  if (form.method === "grid") {
    const spacing = Number(form.spacing);
    return form.spacing.trim() !== "" && spacing >= 1 && spacing <= 1_000_000 ? { method: "grid", spacingMeters: spacing, randomOffset: form.randomOffset } : null;
  }
  return countOk && form.field ? { method: "stratified", field: form.field, allocation: form.allocation, count } : null;
}

/** A file's bytes in base64 (in pieces: one String.fromCharCode of megabytes overflows the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The plot file's name from the area file's: "zones.geojson" gives "zones-plots.csv". */
export function plotFileName(areaFile: string): string {
  return `${areaFile.replace(/\.[^.]*$/, "") || "area"}-plots.csv`;
}
