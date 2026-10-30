/**
 * The export dialog's logic: which records a format can filter, what a request still needs, and the file name that
 * follows the choices (ExportService on the server does the same checks and makes the name).
 */

export type ExportFormat = "CSV" | "XML" | "BACKUP" | "KML";
export type ExportRecords = "ALL" | "SINCE_LAST_EXPORT" | "FROM_DATE" | "BY_ATTRIBUTE";

export const FORMATS: ExportFormat[] = ["CSV", "XML", "BACKUP", "KML"];

/** What the page sends (ExportRequest.java) */
export interface ExportRequest {
  format: ExportFormat;
  records: ExportRecords;
  fromDate: string;
  attribute: string;
  value: string;
  includeLabels: boolean;
  path: string;
}

export const EXTENSIONS: Record<ExportFormat, string> = { CSV: "csv", XML: "zip", BACKUP: "collect-data", KML: "kml" };

/** The choices of records the Swing menu offered per format. */
export function recordsFor(format: ExportFormat): ExportRecords[] {
  if (format === "XML") return ["ALL", "SINCE_LAST_EXPORT", "FROM_DATE", "BY_ATTRIBUTE"];
  if (format === "BACKUP") return ["ALL", "FROM_DATE"];
  return ["ALL"];
}

export const emptyRequest = (): ExportRequest =>
  ({ format: "XML", records: "ALL", fromDate: "", attribute: "", value: "", includeLabels: false, path: "" });

/** The request with a choice of records its format offers: a format change may drop one. */
export function withFormat(request: ExportRequest, format: ExportFormat): ExportRequest {
  const records = recordsFor(format).includes(request.records) ? request.records : "ALL";
  return { ...request, format, records };
}

/** What is still missing before the export can start, as keys of the server texts; empty when nothing. */
export function missing(request: ExportRequest, attributes: { id: string }[]): string[] {
  const problems: string[] = [];
  if (request.records === "FROM_DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(request.fromDate.trim())) problems.push("DataPage.export.noDate");
  if (request.records === "BY_ATTRIBUTE") {
    if (attributes.length === 0) problems.push("ExportActionListener.7");
    else if (!attributes.some((a) => a.id === request.attribute)) problems.push("DataPage.export.noAttribute");
    if (!request.value.trim()) problems.push("ExportActionListener.8");
  }
  if (!request.path.trim()) problems.push("DataPage.export.noPath");
  return problems;
}

/** The part of the request the suggested file name depends on, as one string, to know when to ask for it again. */
export function nameKey(request: ExportRequest): string {
  return [request.format, request.records, request.fromDate.trim(), request.attribute, request.value.trim()].join("|");
}

/** The path with its file name replaced, keeping the folder, whichever separator the path uses. */
export function replaceFileName(path: string, name: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? name : path.slice(0, cut + 1) + name;
}

/** The date of the last export for the dialog, in the page's locale, or null. */
export function lastExportText(millis: number | null, locale?: string): string | null {
  return millis == null ? null : new Date(millis).toLocaleString(locale);
}
