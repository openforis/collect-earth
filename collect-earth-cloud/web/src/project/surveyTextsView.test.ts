import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surveyDesign } from "../../../src/survey/design";
import { translator } from "../i18n";
import { decodeTexts, importTexts, parseCsv, textRows, textsCsv } from "./surveyTextsView";

const basic = surveyDesign(readFileSync(new URL("../../../templates/collect_earth.idm.xml", import.meta.url)));

describe("the survey's texts as a spreadsheet", () => {
  it("lists every text people read, a column per language", () => {
    const rows = textRows(basic);
    expect(rows[0]).toMatchObject({ key: "title:label", target: { kind: "title" } });
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["page:plot_tab:label", "list:demo_codelist:label", "item:demo_codelist:A:label"]));
    // Not the hidden fields, nor the calculated values
    expect(rows.some((r) => r.what.includes("operator") || r.what.includes("calculated_"))).toBe(false);
    const csv = textsCsv(basic);
    expect(csv.split("\r\n")[0]).toBe("key,what,en,es,fr,pt");
    expect(parseCsv(csv).length).toBe(rows.length + 1);
  });

  it("reads back what a spreadsheet changed, in a language added or not, a cell with quotes and lines", () => {
    const csv = [
      "key;what;en;es;sw",
      'title:label;Survey title;Forest survey;;"Utafiti wa ""misitu"""',
      "page:plot_tab:label;Page;First tab with questions CHANGE!;Primera;",
      "item:demo_codelist:A:label;Answer;'-A minus;;",
      'gone:1:label;Removed;x;;',
      "",
    ].join("\r\n");
    const result = importTexts(basic, `﻿${csv}`);
    expect(result.newLanguages).toEqual(["sw"]);
    expect(result.unknown).toBe(1);
    expect(result.changes.map((c) => [c.target.kind, c.language, c.text])).toEqual([
      ["title", "en", "Forest survey"],
      ["title", "sw", 'Utafiti wa "misitu"'],
      ["page", "es", "Primera"],
      ["item", "en", "-A minus"],
    ]);
    // An empty cell, or the same text, changes nothing
    expect(importTexts(basic, textsCsv(basic)).changes).toEqual([]);
    expect(importTexts(basic, "not,a,texts,file\r\n1,2,3,4").changes).toEqual([]);
  });

  it("reads quoted cells with line breaks", () => {
    expect(parseCsv('a,b\r\n"one\nline",2\r\n')).toEqual([["a", "b"], ["one\nline", "2"]]);
  });
});

describe("the texts' spreadsheet in the dashboard's language", () => {
  it("says what each text is in it, and is read back by its keys alone", () => {
    const csv = textsCsv(basic, translator("es"));
    expect(csv.split("\r\n")[0]).toBe("key,qué es,en,es,fr,pt");
    expect(textRows(basic, translator("es"))[0].what).toBe("Título de la encuesta");
    expect(importTexts(basic, csv).changes).toEqual([]);
    const changed = csv.replace(/^("?title:label"?,[^,]*,)[^,\r\n]*/m, "$1New title");
    expect(importTexts(basic, changed).changes).toMatchObject([{ target: { kind: "title" }, language: "en", text: "New title" }]);
  });
});

describe("a spreadsheet saved by Excel (review 3)", () => {
  it("reads UTF-8, else Windows-1252, and refuses a file whose letters were lost", () => {
    const utf8 = new TextEncoder().encode("key,what,es\r\ntitle:label,x,Año forestal\r\n");
    expect(decodeTexts(utf8)).toEqual({ text: "key,what,es\r\ntitle:label,x,Año forestal\r\n", encoding: "utf-8" });
    // Excel's plain CSV: ñ is one byte, 0xF1, which is no UTF-8
    const cp1252 = Uint8Array.from([..."title:label;x;A"].map((c) => c.charCodeAt(0)).concat([0xf1, 0x6f, 0x20, 0x80]));
    expect(decodeTexts(cp1252)).toEqual({ text: "title:label;x;Año €", encoding: "windows-1252" });
    expect(decodeTexts(new TextEncoder().encode("key,what,es\r\ntitle:label,x,A\uFFFDo\r\n"))).toBeNull();
  });

  it("finds a rule's message by the rule it was for", () => {
    const q = basic.pages[0].items.find((i) => i.kind === "question" && i.rules.length > 0)!;
    const row = textRows(basic).find((r) => r.target.kind === "rule" && r.target.node === q.id)!;
    expect(row.anchor).toBeDefined();
    const csv = `key,what,en\r\n${row.key},x,New message\r\n`;
    expect(importTexts(basic, csv).changes[0].anchor).toBe(row.anchor);
  });
});
