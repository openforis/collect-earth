/**
 * The logic of the Tools and Utilities dialogs: the LULUCF form (IpccForm on the server), the requests of the
 * utilities, and what their results say. The checks the server makes are not repeated here beyond what enables a
 * button.
 */

export interface AnalysisFlags { ipccGenerated: boolean; survey: boolean }

export interface IpccOption { value: string; label: string }

export interface IpccSubdivision { guid: string; code: string; name: string; managementType: string | null; type: string | null }

export interface IpccCategory {
  code: string;
  label: string;
  managementTypes: IpccOption[];
  extra: { name: string; label: string; options: IpccOption[] } | null;
  subdivisions: IpccSubdivision[];
}

export interface IpccForm { countries: { code: string; name: string }[]; attributes: string[]; defaultAttribute: string | null; categories: IpccCategory[] }

/** What the page holds for the form, keyed by the subdivision's guid */
export interface IpccAnswer { managementType: string; type: string }

export interface IpccState { country: string; regionAttribute: string; answers: Record<string, IpccAnswer>; path: string }

/** The form's state as the wizard started it: the first country, the attribute it preselected, the values the data holds. */
export function initialIpccState(form: IpccForm): IpccState {
  const answers: Record<string, IpccAnswer> = {};
  for (const category of form.categories) {
    for (const s of category.subdivisions) {
      answers[s.guid] = { managementType: s.managementType ?? "", type: s.type ?? (category.extra?.options[0]?.value ?? "") };
    }
  }
  return { country: form.countries[0]?.code ?? "", regionAttribute: form.defaultAttribute ?? form.attributes[0] ?? "", answers, path: "" };
}

/** The subdivisions still without a management type, which the wizard did not let the user finish without. */
export function ipccMissing(form: IpccForm, state: IpccState): string[] {
  const missing: string[] = [];
  for (const category of form.categories) {
    for (const s of category.subdivisions) {
      if (!state.answers[s.guid]?.managementType) missing.push(category.code + " / " + s.code);
    }
  }
  return missing;
}

export const ipccComplete = (form: IpccForm, state: IpccState): boolean =>
  ipccMissing(form, state).length === 0 && !!state.country && !!state.regionAttribute && !!state.path.trim();

/** What POST /api/jobs/ipccOutputs takes (IpccAnswers.java) */
export function ipccAnswers(form: IpccForm, state: IpccState) {
  const subdivisions: { guid: string; managementType: string; type: string | null }[] = [];
  for (const category of form.categories) {
    for (const s of category.subdivisions) {
      const answer = state.answers[s.guid];
      subdivisions.push({ guid: s.guid, managementType: answer?.managementType ?? "", type: category.extra ? answer?.type || null : null });
    }
  }
  return { country: state.country, regionAttribute: state.regionAttribute, subdivisions, path: state.path.trim() };
}

/** Divide large CSV files (DivideCsvRequest.java) */
export interface DivideCsvRequest { source: string; folder: string; files: number; randomize: boolean; column: number | null }

export const MAX_FILES_TO_DIVIDE_INTO = 500;

export function divideReady(request: DivideCsvRequest, sourceBlocked: boolean): boolean {
  return !!request.source.trim() && !sourceBlocked && !!request.folder.trim()
    && Number.isInteger(request.files) && request.files >= 1 && request.files <= MAX_FILES_TO_DIVIDE_INTO;
}

/** What the check of a CSV of plots to delete answers */
export interface DeleteCheck { ok: boolean; expected: string[]; found: string[]; message: string | null }

/** The result of the missingPlots job */
export interface MissingPlotsResult { text: string; totalPlots: number; totalMissing: number; files: { name: string; path: string; missing: string[][] }[]; csv: string | null }

export const missingResultOf = (result: unknown): MissingPlotsResult | null =>
  result && typeof result === "object" && "totalMissing" in result ? (result as MissingPlotsResult) : null;

/** The name the KML's plots file is suggested with (KmlImportService: importedFromKml_<name>.csv) */
export function kmlCsvName(kmlPath: string): string {
  const name = kmlPath.split(/[\\/]/).pop() ?? "points.kml";
  return "importedFromKml_" + name + ".csv";
}
