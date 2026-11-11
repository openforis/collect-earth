import { strToU8, zipSync } from "fflate";
import { IPCC_CATEGORIES, type AnalysisListItem, type IpccCategory, type UncertaintyData, type UncertaintyEstimate, type UncertaintyQuestion, type UncertaintySettings } from "./api";
import { ipccCategory } from "./analysisSuggest";
import { csvText } from "./csv";
import type { MessageKey, Translate } from "./i18n";

// The uncertainty page (pages/UncertaintyPage.tsx): the setup's guesses, and the tables as sheets, shown on the page
// and downloaded as .xlsx (minimal SpreadsheetML, values only) or CSV. Pure, and tested.

const BY_LETTER: Record<string, IpccCategory> = { F: "forest", C: "cropland", G: "grassland", W: "wetland", S: "settlement", O: "other" };

/** The IPCC category a code most likely is: by its code's first letter, else its label's words, else its label's first letter. */
export function guessCategory(code: string, label: string): IpccCategory | null {
  const first = (s: string) => BY_LETTER[s.trim().charAt(0).toUpperCase()];
  return first(code) ?? BY_LETTER[ipccCategory("", label) ?? ""] ?? first(label) ?? null;
}

/** How deep a question is in its list: 0, or 1 + the depth of the question it refines (`parent`). */
function depthOf(questions: readonly UncertaintyQuestion[], name: string, seen = new Set<string>()): number {
  const q = questions.find((x) => x.name === name);
  if (!q?.parent || seen.has(name)) return 0;
  seen.add(name);
  return 1 + depthOf(questions, q.parent, seen);
}

/** A code to map: "" when not mapped (it is then listed as unmapped), null when left out. */
export type CodeChoice = IpccCategory | null | "";
export interface CodeRow {
  list: string;
  code: string;
  label: string;
  choice: CodeChoice;
}

/**
 * The codes the chosen questions are answered with (the items of their lists at the questions' level), each with the
 * category saved, else the guess from it or the item above it.
 */
export function codeRows(
  questions: readonly UncertaintyQuestion[],
  lists: Readonly<Record<string, readonly AnalysisListItem[]>>,
  chosen: readonly string[],
  saved: UncertaintySettings["codes"],
  labelOf: (item: AnalysisListItem) => string,
): CodeRow[] {
  const levels = new Map<string, Set<number>>();
  for (const name of chosen) {
    const q = questions.find((x) => x.name === name);
    if (!q) continue;
    if (!levels.has(q.list)) levels.set(q.list, new Set());
    levels.get(q.list)!.add(depthOf(questions, name));
  }
  const rows: CodeRow[] = [];
  for (const [list, wanted] of levels) {
    const items = lists[list] ?? [];
    const guess = (item: AnalysisListItem | undefined, depth = 0): IpccCategory | null =>
      !item || depth > 10 ? null : (guessCategory(item.code, labelOf(item)) ?? guess(items.find((i) => i.code === item.parent), depth + 1));
    for (const item of items) {
      if (!wanted.has(item.level)) continue;
      const kept = saved[list]?.[item.code];
      rows.push({ list, code: item.code, label: labelOf(item), choice: kept !== undefined ? kept : (guess(item) ?? "") });
    }
  }
  return rows;
}

/** The codes as the settings keep them: the unmapped ones left out. */
export function codesOf(rows: readonly CodeRow[]): UncertaintySettings["codes"] {
  const out: UncertaintySettings["codes"] = {};
  for (const r of rows) if (r.choice !== "") (out[r.list] ??= {})[r.code] = r.choice;
  return out;
}

/** What a column holds, for how it is shown. */
export type ColumnFormat = "text" | "count" | "share" | "ha" | "percent";
export interface Sheet {
  id: "categories" | "forest" | "transitions" | "matrixHa" | "matrixPercent";
  title: string;
  formats: ColumnFormat[];
  header: string[];
  rows: (string | number | null)[][];
}

/** The tables of the page, as sheets of values. */
export function uncertaintySheets(d: UncertaintyData, t: Translate): Sheet[] {
  const cat = (c: IpccCategory) => t(`uncertainty.cat.${c}` as MessageKey);
  const y0 = d.settings.initialYear;
  const y1 = d.settings.finalYear;
  const estimateHeader = [t("uncertainty.col.plots"), t("uncertainty.col.share"), t("uncertainty.col.area"), t("uncertainty.col.se"), t("uncertainty.col.ci"), t("uncertainty.col.uncertainty")];
  const estimateFormats: ColumnFormat[] = ["count", "share", "ha", "ha", "ha", "percent"];
  const values = (e: UncertaintyEstimate) => [e.plots, e.proportion, e.area, e.se, e.ci, e.uncertainty];
  const matrixHeader = [t("uncertainty.col.initialFinal", { initial: y0, final: y1 }), ...IPCC_CATEGORIES.map(cat), t("uncertainty.total")];
  const matrixFormats = (f: ColumnFormat): ColumnFormat[] => ["text", ...IPCC_CATEGORIES.map(() => f), f];
  const m = d.matrix;
  return [
    {
      id: "categories",
      title: t("uncertainty.table.categories"),
      formats: ["text", "text", ...estimateFormats],
      header: [t("uncertainty.col.category"), t("uncertainty.col.year"), ...estimateHeader],
      rows: [
        ...[y0, y1].flatMap((year, i) => [
          ...d.categories.map((c) => [cat(c.category), year, ...values(i === 0 ? c.initial : c.final)]),
          // the plots of a code left out keep their share: a line of their own when there are any
          ...((i === 0 ? d.noData.initial : d.noData.final).plots > 0 ? [[t("uncertainty.noData"), year, ...values(i === 0 ? d.noData.initial : d.noData.final)]] : []),
          [t("uncertainty.total"), year, ...values(d.total)],
        ]),
      ],
    },
    {
      id: "forest",
      title: t("uncertainty.table.forest"),
      formats: ["text", ...estimateFormats],
      header: [t("uncertainty.col.change"), ...estimateHeader],
      rows: d.forest.map((f) => [t(`uncertainty.forest.${f.row}` as MessageKey), ...values(f.estimate)]),
    },
    {
      id: "transitions",
      title: t("uncertainty.table.transitions"),
      formats: ["text", "text", ...estimateFormats],
      header: [t("uncertainty.col.from", { year: y0 }), t("uncertainty.col.to", { year: y1 }), ...estimateHeader],
      rows: d.transitions.map((x) => [cat(x.from), cat(x.to), ...values(x.estimate)]),
    },
    {
      id: "matrixHa",
      title: t("uncertainty.table.matrixHa"),
      formats: matrixFormats("ha"),
      header: matrixHeader,
      rows: [...IPCC_CATEGORIES.map((c, i) => [cat(c), ...m.cells[i], m.rowTotals[i]]), [t("uncertainty.total"), ...m.columnTotals, m.total]],
    },
    {
      id: "matrixPercent",
      title: t("uncertainty.table.matrixPercent"),
      formats: matrixFormats("percent"),
      header: matrixHeader,
      rows: IPCC_CATEGORIES.map((c, i) => [cat(c), ...m.rowPercent[i], m.rowTotals[i] > 0 ? 100 : null]),
    },
  ];
}

const xmlText = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const columnName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** An .xlsx of the sheets: values only (numbers as numbers, text inline), one worksheet each. */
export function xlsxOf(sheets: readonly Pick<Sheet, "title" | "header" | "rows">[]): Uint8Array {
  const names: string[] = [];
  for (const s of sheets) {
    // at most 31 characters, none of []:*?/\, each name once
    const base = s.title.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Sheet";
    let name = base;
    for (let i = 2; names.includes(name); i++) name = `${base} ${i}`;
    names.push(name);
  }
  const sheetXml = (s: Pick<Sheet, "header" | "rows">) => {
    const rows = [s.header, ...s.rows].map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${columnName(c)}${r + 1}`;
        if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : "";
        if (v === null || v === "") return "";
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    });
    return `${XML}<worksheet xmlns="${MAIN}"><sheetData>${rows.join("")}</sheetData></worksheet>`;
  };
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(`${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${XML}<Relationships xmlns="${PKG_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files);
}

/** The sheets one after the other in one CSV, in the person's language: each one's title, its header and rows, then a blank line. */
export function csvOf(sheets: readonly Pick<Sheet, "title" | "header" | "rows">[], language: string): string {
  return sheets.map((s) => csvText([s.title], [s.header, ...s.rows], language)).join("\r\n");
}
