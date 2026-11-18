// The survey designer's stage 0 (docs/plans/2026-11-18-survey-designer.md): the lossless survey tree. A survey read
// and written without a change is the same file, byte for byte; a change rewrites only what it changes. The changed
// templates are written to the desktop's test resources, where DesignedSurveyIdmlTest reads them with Collect and
// checks them as Collect's designer and Collect Earth would.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import { attrValue, readXml, textValue, writeXml, XmlTreeError } from '../src/survey/xmlTree.js';
import { realDemoCep } from './fixtures/cep.js';

const TEMPLATES = fileURLToPath(new URL('./fixtures/templates/', import.meta.url));
const DESKTOP_RESOURCES = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/', import.meta.url));
const DESIGNER_DIR = `${DESKTOP_RESOURCES}designer/`;

const template = (name: string) => readFileSync(`${TEMPLATES}collect_earth${name}.idm.xml`);

/** Every survey at hand: the three templates of Collect, the demo project's, the desktop's test ones, the CEO imports */
function allSurveys(): Array<[string, Buffer]> {
  const out: Array<[string, Buffer]> = [];
  for (const f of readdirSync(TEMPLATES)) if (f.endsWith('.xml')) out.push([f, readFileSync(TEMPLATES + f)]);
  out.push(['demo_survey.cep', Buffer.from(unzipSync(realDemoCep())['placemark.idm.xml'])]);
  out.push(['test_survey.idm.xml', readFileSync(`${DESKTOP_RESOURCES}test_survey.idm.xml`)]);
  for (const f of readdirSync(`${DESKTOP_RESOURCES}ceo/`)) {
    if (f.endsWith('.idm.xml')) out.push([`ceo/${f}`, readFileSync(`${DESKTOP_RESOURCES}ceo/${f}`)]);
  }
  return out;
}

/**
 * The lines that differ: the original's and the changed one's between their common start and end, lastId left out
 * (it changes with every new id, at the top of the file)
 */
function changedLines(before: Buffer, after: Buffer): { removed: string[]; added: string[] } {
  const lines = (b: Buffer) => b.toString('latin1').replace(/ lastId="\d+"/, ' lastId=""').split(/\r?\n/);
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.slice(start, a.length - end), added: b.slice(start, b.length - end) };
}

describe('reading and writing a survey', () => {
  it('gives back the same bytes for every survey at hand', () => {
    const surveys = allSurveys();
    expect(surveys.length).toBeGreaterThan(15);
    for (const [name, bytes] of surveys) {
      expect(Buffer.compare(writeXml(readXml(bytes)), bytes), name).toBe(0);
    }
  });

  it('keeps line breaks, a byte order mark, comments, CDATA and the quotes of attributes', () => {
    const text = "﻿<?xml version='1.0'?>\r\n<!-- a -->\r\n<survey a='1' b=\"2\">\r\n\t<x><![CDATA[<b>&]]></x>\r\n\t<y/>\r\n</survey>\r\n";
    const bytes = Buffer.from(text, 'utf8');
    const doc = readXml(bytes);
    expect(writeXml(doc).equals(bytes)).toBe(true);
    expect(doc.eol).toBe('\r\n');
    expect(textValue(doc, doc.root.children.find((c) => c.kind === 'element' && c.name === 'x') as never)).toBe('<b>&');
  });

  it('reads UTF-8 and character references alike', () => {
    const doc = readXml(Buffer.from('<s a="Pesta&#241;a &amp; ñ"><l>Opción &lt;A&gt;</l></s>', 'utf8'));
    expect(attrValue(doc, doc.root, 'a')).toBe('Pestaña & ñ');
    expect(textValue(doc, doc.root)).toBe('Opción <A>');
  });

  it('refuses what is not a survey it can keep', () => {
    expect(() => readXml(Buffer.from('<!DOCTYPE s [<!ENTITY x "y">]><s/>'))).toThrow(XmlTreeError);
    expect(() => readXml(Buffer.from('<s><a></b></s>'))).toThrow(XmlTreeError);
    expect(() => readXml(Buffer.from('<s><a></s>'))).toThrow(XmlTreeError);
    expect(() => readXml(Buffer.from('<s/><t/>'))).toThrow(XmlTreeError);
    expect(() => readXml(Buffer.from('text<s/>'))).toThrow(XmlTreeError);
  });
});

describe('changing a survey', () => {
  it('changes only the line of a label', () => {
    const before = template('');
    const s = new SurveyEdit(before);
    s.setLabel(s.node('code_demo'), 'fr', 'Une question à choix', 'instance');
    const { removed, added } = changedLines(before, s.bytes());
    expect(removed).toEqual([expect.stringMatching(/^ {8}<label type="instance" xml:lang="fr">D\u00c3\u00a9mo - Attribut de code/)]);
    expect(added).toEqual(['        <label type="instance" xml:lang="fr">Une question &#224; choix</label>']);
  });

  it('adds a question on a line of its own, indented as its neighbours, on their page, with a new id', () => {
    for (const [name, indent] of [['', '      '], ['_multipurpose', '\t\t\t']] as const) {
      const before = template(name);
      const s = new SurveyEdit(before);
      const lastId = Number(attrValue(s.doc, s.survey, 'lastId'));
      const q = s.addYesNo('has_water', { en: 'Is there water?', es: '¿Hay agua?' }, { after: s.node('location') });
      const id = Number(attrValue(s.doc, q, 'id'));
      expect(id).toBeGreaterThan(lastId);
      const { removed, added } = changedLines(before, s.bytes());
      expect(removed).toEqual([]);
      expect(attrValue(s.doc, s.survey, 'lastId')).toBe(String(id));
      const inner = indent + (name === '' ? '  ' : '\t');
      const tab = name === '' ? '' : ' ui:tab="tab_10007"';
      expect(added).toEqual([
        `${indent}<boolean id="${id}" name="has_water"${tab}>`,
        `${inner}<label type="instance" xml:lang="en">Is there water?</label>`,
        `${inner}<label type="instance" xml:lang="es">&#191;Hay agua?</label>`,
        `${indent}</boolean>`,
      ]);
    }
  });

  it('refuses names Collect or Collect Earth would not take, and questions and codes twice', () => {
    const s = new SurveyEdit(template(''));
    expect(() => s.addYesNo('Water', {})).toThrow(SurveyEditError);
    expect(() => s.addYesNo('water_2', {})).toThrow(SurveyEditError);
    expect(() => s.addYesNo('yes_no_demo', {})).toThrow(SurveyEditError);
    expect(() => s.addItem(s.list('demo_codelist'), 'A', {})).toThrow(SurveyEditError);
  });

  it('refuses a condition Collect would refuse, before writing it', () => {
    const before = template('');
    const s = new SurveyEdit(before);
    expect(() => s.setShownWhen(s.node('memo_text_demo'), 'yes_no_demo = tru()')).toThrow('There is no function tru.');
    expect(() => s.setShownWhen(s.node('memo_text_demo'), "no_such = 'A'")).toThrow('There is no question no_such in plot.');
    expect(() => s.setRequired(s.node('demo_date'), "code_demo = 'B")).toThrow(/cannot be read/);
    expect(s.bytes().equals(before)).toBe(true);
    expect(s.problems()).toEqual([]);
  });

  it('refuses to delete a question another one uses, and deletes it once nothing does', () => {
    const before = template('');
    const s = new SurveyEdit(before);
    expect(() => s.removeQuestion(s.node('yes_no_demo'))).toThrow(/memo_text_demo/);
    s.removeQuestion(s.node('memo_text_demo'));
    s.removeQuestion(s.node('yes_no_demo'));
    const out = s.bytes().toString('latin1');
    expect(out).not.toContain('yes_no_demo');
    // Only the two questions' lines went
    const { removed, added } = changedLines(before, s.bytes());
    expect(added).toEqual([]);
    expect(removed[0]).toContain('<boolean id="1308" name="yes_no_demo"');
    expect(removed[removed.length - 1]).toBe('      </text>');
  });
});

/** The trial changes of the plan, on each template: what DesignedSurveyIdmlTest then reads with Collect */
const TRIALS: Array<[string, string, (s: SurveyEdit) => void]> = [
  [
    '',
    'basic',
    (s) => {
      s.setLabel(s.node('code_demo'), 'fr', 'Une question à choix', 'instance');
      s.setDescription(s.node('code_demo'), 'en', 'Pick the option that fits best.');
      const water = s.addYesNo('has_water', { en: 'Is there water?', es: '¿Hay agua?', fr: "Y a-t-il de l'eau ?", pt: 'Há água?' }, { after: s.node('code_demo') });
      const kind = s.addChoice(
        'water_kind',
        { en: 'What kind of water?', es: '¿Qué tipo de agua?' },
        [
          ['river', { en: 'River', es: 'Río' }],
          ['lake', { en: 'Lake', es: 'Lago' }],
        ],
        { after: water },
      );
      s.setShownWhen(kind.question, 'has_water = true()');
      s.setRequired(kind.question, true);
      s.addItem(kind.list, 'pond', { en: 'Pond', es: 'Estanque' });
      s.addItem(s.list('demo_codelist'), 'C', { en: 'Third Option C', fr: 'Troisième option C' });
      s.setLabel(s.item(s.list('demo_codelist'), 'A'), 'es', 'Primera opción (A)');
      const trees = s.addQuestion('number', 'tree_count', { en: 'How many trees?' }, { attrs: [['type', 'integer']] });
      s.addRangeCheck(trees, 0, 500, { en: 'Between 0 and 500 trees' });
      s.move(s.node('integer_demo'), s.node('short_text_demo'));
      s.removeQuestion(s.node('memo_text_demo'));
    },
  ],
  [
    '_ipcc',
    'ipcc',
    (s) => {
      s.setLabel(s.node('land_use_subcategory'), 'en', 'Land use of the plot (IPCC)', 'instance');
      const q = s.addYesNo('burnt', { en: 'Are there signs of fire?', es: '¿Hay señales de fuego?' }, { after: s.node('land_use_subcategory') });
      s.setShownWhen(q, "land_use_category = 'F'");
      s.addItem(s.list('drivers'), 'mining', { en: 'Mining' });
    },
  ],
  [
    '_multipurpose',
    'multipurpose',
    (s) => {
      s.addChoice('access', { en: 'How easy is the plot to reach?' }, [
        ['easy', { en: 'Easy' }],
        ['hard', { en: 'Hard' }],
      ]);
      // The list's label without xml:lang is the default language's: it is the one changed
      s.setLabel(s.list('five'), 'en', 'Five years', 'item');
      s.setLabel(s.item(s.list('five'), 'more'), 'en', 'More than five years');
    },
  ],
];

describe('the trial changes on the templates', () => {
  for (const [file, name, change] of TRIALS) {
    it(`${name}: read again, the same; written to the desktop's test resources`, () => {
      const s = new SurveyEdit(template(file));
      change(s);
      const written = s.bytes();
      // What was written reads and writes back unchanged, and is ASCII-safe for any encoding
      expect(writeXml(readXml(written)).equals(written)).toBe(true);
      const again = new SurveyEdit(written);
      expect(again.languages().length).toBeGreaterThan(0);
      const path = `${DESIGNER_DIR}${name}.idm.xml`;
      if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) {
        mkdirSync(DESIGNER_DIR, { recursive: true });
        writeFileSync(path, written);
      }
      // a Windows checkout (core.autocrlf) has the file with CRLF: only the content is compared
      expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n'), path).toBe(written.toString('latin1').replace(/\r\n/g, '\n'));
    });
  }

  it('basic: the new list and items are in the codeLists, the new questions in the order asked', () => {
    const s = new SurveyEdit(template(''));
    TRIALS[0][2](s);
    const again = new SurveyEdit(s.bytes());
    const names = again.rootEntity().children.filter((c) => c.kind === 'element' && c.name !== 'label').map((c) => attrValue(again.doc, c as never, 'name'));
    expect(names.indexOf('has_water')).toBe(names.indexOf('code_demo') + 1);
    expect(names.indexOf('water_kind')).toBe(names.indexOf('has_water') + 1);
    expect(names.indexOf('integer_demo')).toBe(names.indexOf('short_text_demo') - 1);
    expect(names).not.toContain('memo_text_demo');
    expect(names[names.length - 1]).toBe('tree_count');
    expect(textValue(again.doc, again.item(again.list('water_kind'), 'pond'))).toContain('Estanque');
    expect(attrValue(again.doc, again.node('water_kind'), 'relevant')).toBe('has_water = true()');
  });
});
