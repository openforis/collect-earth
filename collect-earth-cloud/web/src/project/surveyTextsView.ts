// The survey's texts as a spreadsheet (docs/plans/2026-11-18-survey-designer.md, stage 7, "labels as a spreadsheet"):
// every text people read, one row each, a column per language, for translators to fill in a spreadsheet and send back.
// The file read back changes the texts as typing them would (pending until saved). A row is named by a key of what the
// text belongs to, so rows can be sorted, removed or left empty: an empty cell changes nothing.

import type { DesignListItem, DesignQuestion, Localized, SurveyDesign, WordTarget } from "../api";
import { csvCell } from "../csv";
import { translator, type Translate } from "../i18n";
import type { PendingText, WordPart } from "./surveyEditView";

export interface TextRow {
  /** "node:1303:label", "item:land_uses:F:help"... */
  key: string;
  /** What it is, for the translator, in the dashboard's language: "Question short_text_demo", "Answer F of land_uses" */
  what: string;
  target: WordTarget;
  part: WordPart;
  texts: Localized;
}

/**
 * Every text people read in the form: the title, pages, questions, tables, rules' messages, answers of lists in use.
 * `t` writes the "what" column (read back by nothing: a row is found by its key).
 */
export function textRows(design: SurveyDesign, t: Translate = translator("en")): TextRow[] {
  const rows: TextRow[] = [];
  const add = (key: string, what: string, target: WordTarget, part: WordPart, texts: Localized) => rows.push({ key, what, target, part, texts });
  add("title:label", t("survey.texts.what.title"), { kind: "title" }, "label", design.title);
  const question = (q: DesignQuestion) => {
    if (q.hidden || q.formulas || q.fixed) return;
    add(`node:${q.id}:label`, t("survey.texts.what.question", { name: q.name }), { kind: "node", id: q.id }, "label", q.label);
    add(`node:${q.id}:help`, t("survey.texts.what.help", { name: q.name }), { kind: "node", id: q.id }, "help", q.help);
    q.rules.forEach((r, i) => add(`rule:${q.id}:${i}:message`, t("survey.texts.what.rule", { index: i + 1, name: q.name }), { kind: "rule", node: q.id, index: i }, "message", r.message));
  };
  const pages = [...design.pages, ...design.emptyPages.map((p) => ({ ...p, items: [] }))];
  const order = new Map(design.pageOrder.map((name, i) => [name, i]));
  pages.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  for (const page of pages) {
    add(`page:${page.name}:label`, t("survey.texts.what.page", { name: page.name }), { kind: "page", name: page.name }, "label", page.label);
    for (const item of page.items) {
      if (item.kind === "table") {
        add(`node:${item.id}:label`, t("survey.texts.what.table", { name: item.name }), { kind: "node", id: item.id }, "label", item.label);
        add(`node:${item.id}:help`, t("survey.texts.what.help", { name: item.name }), { kind: "node", id: item.id }, "help", item.help);
        item.columns.forEach(question);
      } else {
        question(item);
      }
    }
  }
  const used = new Set([...design.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === "table" ? [i.rowsList, ...i.columns.map((c) => c.list)] : [i.list])))].filter(Boolean));
  for (const list of design.lists) {
    if (!used.has(list.name) || list.external) continue;
    add(`list:${list.name}:label`, t("survey.texts.what.list", { name: list.name }), { kind: "list", name: list.name }, "label", list.label);
    const items = (all: readonly DesignListItem[]) => {
      for (const i of all) {
        add(`item:${list.name}:${i.code}:label`, t("survey.texts.what.answer", { code: i.code, list: list.name }), { kind: "item", list: list.name, code: i.code }, "label", i.label);
        add(`item:${list.name}:${i.code}:help`, t("survey.texts.what.answerHelp", { code: i.code, list: list.name }), { kind: "item", list: list.name, code: i.code }, "help", i.help);
        items(i.items);
      }
    };
    items(list.items);
  }
  // A help text that is empty in every language is left out: nobody would write one from the spreadsheet
  return rows.filter((r) => r.part !== "help" || Object.values(r.texts).some((v) => v.trim() !== ""));
}

/**
 * The texts as CSV for a spreadsheet: key, what, then a column per language (the survey's, and those asked for). Comma
 * separated, every cell quoted when it needs to be; a text a spreadsheet would run as a formula gets a ' before it
 * (taken away again on the way back).
 */
export function textsCsv(design: SurveyDesign, t: Translate = translator("en"), languages: readonly string[] = design.languages): string {
  const line = (cells: readonly string[]) => cells.map((c) => csvCell(c)).join(",");
  // "key" stays as it is in every language: the file is read back by it
  const out = [line(["key", t("survey.texts.what"), ...languages])];
  for (const r of textRows(design, t)) out.push(line([r.key, r.what, ...languages.map((l) => r.texts[l] ?? "")]));
  return `${out.join("\r\n")}\r\n`;
}

/** The rows of a CSV: a comma or a semicolon between cells (whichever the header has more of), quotes and line breaks in cells */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.slice(0, body.search(/\r?\n|$/));
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === separator) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** A cell as the text it holds: the ' a spreadsheet's formula guard put before =, +, -, @ taken away */
const cellText = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

export interface TextsImport {
  /** The texts that change, as typing them would */
  changes: PendingText[];
  /** Language columns the survey does not have yet: added with the texts */
  newLanguages: string[];
  /** Rows whose key is not a text of the survey (the survey changed since the file was made) */
  unknown: number;
}

const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** What a spreadsheet of texts changes: each non-empty cell different from the survey's text */
export function importTexts(design: SurveyDesign, csv: string): TextsImport {
  const [header, ...lines] = parseCsv(csv);
  if (!header || header[0]?.trim() !== "key") return { changes: [], newLanguages: [], unknown: 0 };
  const columns = header.map((h) => h.trim());
  const languages = columns.map((c, i) => (i >= 2 && LANGUAGE.test(c) ? c : null));
  const rows = new Map(textRows(design).map((r) => [r.key, r]));
  // The texts a survey has but the spreadsheet's rows leave out (an empty help) are found by key too
  const changes: PendingText[] = [];
  const newLanguages = new Set<string>();
  let unknown = 0;
  for (const cells of lines) {
    const key = cells[0]?.trim() ?? "";
    const row = rows.get(key);
    if (!row) {
      if (key !== "") unknown++;
      continue;
    }
    cells.forEach((raw, i) => {
      const language = languages[i];
      if (!language) return;
      const text = cellText(raw).trim();
      const current = row.texts[language] ?? "";
      if (text === "" || text === current.trim()) return;
      if (!design.languages.includes(language)) newLanguages.add(language);
      changes.push({ target: row.target, part: row.part, language, text, current });
    });
  }
  return { changes, newLanguages: [...newLanguages], unknown };
}
