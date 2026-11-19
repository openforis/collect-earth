// A new project's survey (docs/plans/2026-11-18-survey-designer.md, stage 5, "Design the survey here"): one of Collect's
// Collect Earth templates (templates/, copied byte for byte from Collect's Survey Designer), or a blank survey made
// from the basic one with only the fields Collect Earth needs. Its title, its own identifier and folder name, the
// language it is written in, and, for the templates with a list of years, its years. The project file around it is
// the one the server makes for an import (ceo/projectFile.ts, madeProjectFile).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { madeProjectFile } from '../ceo/projectFile.js';
import { slug } from '../ceo/survey.js';
import type { PlotLayout } from '../wire/projects.js';
import type { SurveyTemplate } from '../wire/survey.js';
import { surveyDesign } from './design.js';
import { SurveyEdit, SurveyEditError } from './edit.js';

const FILES: Record<Exclude<SurveyTemplate, 'blank'>, string> = {
  basic: 'collect_earth.idm.xml',
  multipurpose: 'collect_earth_multipurpose.idm.xml',
  ipcc: 'collect_earth_ipcc.idm.xml',
};

/** The templates with a list of years (the year of a change, the base year) */
export const TEMPLATES_WITH_YEARS: readonly SurveyTemplate[] = ['multipurpose', 'ipcc'];

/** Read when a project is made, never at start: the local bundle has no templates folder (the designer is off there) */
function templateBytes(name: Exclude<SurveyTemplate, 'blank'>): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../templates/${FILES[name]}`, import.meta.url)));
}

/** What a page of the blank survey is called, in the template's languages */
const PLOT_PAGE: Record<string, string> = { en: 'Plot', es: 'Parcela', fr: 'Parcelle', pt: 'Parcela' };

/**
 * The basic template with only what Collect Earth needs: its own fields, the plot file's values (elevation, slope,
 * aspect) and the classes calculated from them; one page, the lists they use; and one question, the land use
 */
function blank(): SurveyEdit {
  const edit = new SurveyEdit(templateBytes('basic'));
  const design = surveyDesign(edit.bytes());
  // Deleted until nothing more can be: a question another uses goes after it
  let left = design.pages.flatMap((p) => p.items).filter((i) => i.kind === 'table' || !i.fixed);
  for (let round = 0; left.length > 0 && round < 10; round++) {
    left = left.filter((item) => {
      try {
        edit.apply(item.kind === 'table' ? { op: 'deleteTable', id: item.id } : { op: 'deleteQuestion', id: item.id });
        return false;
      } catch (err) {
        if (err instanceof SurveyEditError) return true;
        throw err;
      }
    });
  }
  const after = surveyDesign(edit.bytes());
  for (const l of after.lists) if (l.usedBy.length === 0) edit.apply({ op: 'deleteList', name: l.name });
  const [first, ...others] = after.pageOrder;
  for (const page of others) {
    try {
      edit.apply({ op: 'deletePage', name: page });
    } catch {
      // a page something is on stays
    }
  }
  for (const language of edit.languages()) {
    if (PLOT_PAGE[language]) edit.apply({ op: 'setText', target: { kind: 'page', name: first }, part: 'label', language, text: PLOT_PAGE[language] });
  }
  // One question to start from (a form with none has nothing to show): the land use, in IPCC's six categories
  const languages = new Set(edit.languages());
  const words = (texts: Record<string, string>) => Object.fromEntries(Object.entries(texts).filter(([l]) => languages.has(l)));
  edit.apply({
    op: 'addList',
    name: 'land_use_categories',
    label: words({ en: 'Land use categories', es: 'Categorías de uso de la tierra', fr: "Catégories d'utilisation des terres", pt: 'Categorias de uso da terra' }),
    items: LAND_USES.map(([code, ...texts]) => ({ code, label: words({ en: texts[0], es: texts[1], fr: texts[2], pt: texts[3] }) })),
  });
  edit.apply({
    op: 'addQuestion',
    type: 'choice',
    name: 'land_use',
    label: words({ en: 'Land use', es: 'Uso de la tierra', fr: 'Utilisation des terres', pt: 'Uso da terra' }),
    page: first,
    list: 'land_use_categories',
    required: true,
  });
  return edit;
}

/** IPCC's land use categories: code, then en, es, fr, pt */
const LAND_USES: Array<[string, string, string, string, string]> = [
  ['F', 'Forest land', 'Tierras forestales', 'Terres forestières', 'Terras florestais'],
  ['C', 'Cropland', 'Tierras de cultivo', 'Terres cultivées', 'Terras agrícolas'],
  ['G', 'Grassland', 'Pastizales', 'Prairies', 'Pastagens'],
  ['W', 'Wetlands', 'Humedales', 'Terres humides', 'Zonas húmidas'],
  ['S', 'Settlements', 'Asentamientos', 'Établissements', 'Povoamentos'],
  ['O', 'Other land', 'Otras tierras', 'Autres terres', 'Outras terras'],
];

export interface NewSurveyOptions {
  template: SurveyTemplate;
  title: string;
  /** The language the coordinator writes in: added to the template's when it has not it */
  language: string;
  /** For a template with years */
  years?: { first: number; last: number };
  /** The project's id: the survey's identifier and folder name are made unique with it */
  projectId: string;
}

/** The plot layout of a new project: Collect Earth's usual 5 x 5 points in a square, to change in Setup › Plot layout */
const LAYOUT: PlotLayout = { shape: 'SQUARE', points: 25, distance: 20, boundary: 10, pointSide: 2 };

/** The year the multipurpose template's texts are written for (its years list ends there) */
const MULTIPURPOSE_LAST_YEAR = '2023';

/**
 * A template's text as people should read it: the layout of its file taken out (a label on one line; help with its
 * line breaks, not the file's indentation), its placeholders filled where the answer is known (the last year of the
 * multipurpose template's years, written <END YEAR>, <ANO FINAL> or 2023) and taken out where it is not (<DISTANCE>)
 */
export function tidyTemplateText(text: string, kind: 'label' | 'help', lastYear: number | null): string {
  let t = kind === 'label' ? text.replace(/\s*\r?\n\s*/g, ' ').trim() : text.replace(/[ \t]*\r?\n[ \t]*/g, '\n').trim();
  t = t.replace(/ ?<DISTANCE> ?/g, ' ').replace(/within buffer/g, 'within the buffer').replace(/ {2,}/g, ' ').trim();
  if (lastYear !== null) {
    t = t.replace(/<END YEAR>|<ANO FINAL>/g, String(lastYear)).replace(new RegExp(`\\b${MULTIPURPOSE_LAST_YEAR}\\b`, 'g'), String(lastYear));
  }
  return t;
}

/** A new project's survey (placemark.idm.xml) */
export function newSurvey(o: NewSurveyOptions): { survey: Buffer; surveyName: string } {
  const edit = o.template === 'blank' ? blank() : new SurveyEdit(templateBytes(o.template));
  const title = o.title.trim();
  if (title === '' || title.length > 200) throw new SurveyEditError('A survey needs a title, of at most 200 characters.');
  edit.addLanguage(o.language);
  // The title in every language: the template's says "fill with your project name"
  for (const language of edit.languages()) edit.apply({ op: 'setText', target: { kind: 'title' }, part: 'label', language, text: title });
  const surveyName = `${slug(title, 30) || 'survey'}_${o.projectId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
  edit.setUri(`http://www.openforis.org/idm/${surveyName}`);
  if (o.years) {
    if (!TEMPLATES_WITH_YEARS.includes(o.template)) throw new SurveyEditError('This template has no list of years.');
    edit.setYears('years', o.years.first, o.years.last);
  }
  edit.rewriteTexts((text, kind) => tidyTemplateText(text, kind, o.template === 'multipurpose' ? (o.years?.last ?? Number(MULTIPURPOSE_LAST_YEAR)) : null));
  const problems = edit.problems();
  if (problems.length > 0) throw new SurveyEditError(`The survey made has problems: ${problems.map((p) => p.code).join(', ')}.`);
  return { survey: edit.bytes(), surveyName };
}

/** A new project's project file: the survey, its properties (the default plot layout), the KML template and a balloon */
export function newProjectFile(o: NewSurveyOptions, date: Date): Buffer {
  const { survey, surveyName } = newSurvey(o);
  const design = surveyDesign(survey);
  return madeProjectFile(
    {
      idml: survey.toString('utf8'),
      title: o.title.trim(),
      surveyName,
      comment: `Collect Earth project designed in Collect Earth Cloud, from the ${o.template} template`,
      // The plot file's columns after id, latitude and longitude: the values filled from it, in the survey's order
      columns: design.fromPlotFile.map((q) => q.name),
      layout: LAYOUT,
    },
    date,
  );
}
