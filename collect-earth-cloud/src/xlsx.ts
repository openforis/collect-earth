// An .xlsx of sheets of values, as the dashboard writes the Uncertainty page's (web/src/uncertaintyView.ts, xlsxOf):
// minimal SpreadsheetML, numbers as numbers, text inline, no styles.
import { strToU8, zipSync } from 'fflate';

export type XlsxCell = string | number | null;
export interface XlsxSheet {
  title: string;
  rows: readonly (readonly XlsxCell[])[];
}

const xmlText = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const columnName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** The workbook of the sheets, one worksheet each (at least one sheet: a workbook without any does not open). */
export function xlsxOf(sheets: readonly XlsxSheet[]): Uint8Array {
  const names: string[] = [];
  for (const s of sheets) {
    // at most 31 characters, none of []:*?/\, each name once
    const base = s.title.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Sheet';
    let name = base;
    for (let i = 2; names.includes(name); i++) name = `${base} ${i}`;
    names.push(name);
  }
  const sheetXml = (s: XlsxSheet) => {
    const rows = s.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${columnName(c)}${r + 1}`;
        if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '';
        if (v === null || v === '') return '';
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join('')}</row>`;
    });
    return `${XML}<worksheet xmlns="${MAIN}"><sheetData>${rows.join('')}</sheetData></worksheet>`;
  };
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(`${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML}<Relationships xmlns="${PKG_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files);
}
