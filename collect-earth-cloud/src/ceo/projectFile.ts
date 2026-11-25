// The project file (.cep) of a project made from a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md,
// B4): the survey (idml.ts), project_definition.properties and the KML template. There is no balloon: the form is the
// one the plots map and Google Earth Web build from the survey, and the cloud's addRound and addNote change a project
// file that has none. (Collect Earth 2 reads no KML template; earlier versions made Google Earth Pro's KML with it.)
// The import report goes in too, so it stays with the project.
import { zipCep } from '../cep.js';
import type { CeoSurvey } from './index.js';
import { KML_TEMPLATE } from './kmlTemplate.js';
import { layoutProperties, type PlotLayout } from './plots.js';
import type { ReportEntry } from './report.js';

/** The report as text, for the project file and the log */
export function reportText(survey: CeoSurvey): string {
  const lines = [
    `Imported from Collect Earth Online${survey.project.id !== null ? `, project ${survey.project.id}` : ''}: ${survey.project.name}`,
    `Questions: ${count(survey, 'question', 'imported')} imported, ${count(survey, 'question', 'changed')} changed, ${count(survey, 'question', 'skipped')} left out.`,
    `Rules: ${count(survey, 'rule', 'imported') + count(survey, 'rule', 'changed')} checked, ${count(survey, 'rule', 'skipped')} left out.`,
    survey.plots ? `Plots: ${survey.plots.plots.length}, from CEO's plot list.` : 'Plots: none from CEO; add a plot file or a plot design.',
    '',
  ];
  const label: Record<ReportEntry['outcome'], string> = { imported: 'Imported', changed: 'Changed', skipped: 'Left out', info: 'Note' };
  for (const e of survey.report.entries) lines.push(`[${label[e.outcome]}] ${e.subject}: ${e.message}`);
  return lines.join('\n') + '\n';
}

const count = (s: CeoSurvey, area: ReportEntry['area'], outcome: ReportEntry['outcome']) => s.report.count(outcome, area);

/** A properties value: backslashes, and a leading space, escaped; one line */
const property = (s: string): string => s.replace(/\\/g, '\\\\').replace(/^ /, '\\ ').replace(/\r?\n/g, ' ');

/** What a project file the server makes holds: the survey, its layout and the plot file's extra columns. */
export interface MadeProjectFile {
  /** the survey (placemark.idm.xml) */
  idml: string;
  /** survey_name: the survey's name, as Collect Earth names its project folder */
  surveyName: string;
  /** the first line of the properties (a comment: where the project comes from) */
  comment: string;
  /** the plot file's extra columns, in order: the attributes filled from it (collectearth:fromcsv) */
  columns: readonly string[];
  layout: PlotLayout;
  /** more properties lines (key=value) */
  properties?: readonly string[];
  /** more files, by path */
  files?: ReadonlyMap<string, string>;
}

/**
 * A project file made by the server (a CEO import, a backup's, a new survey's): the survey,
 * project_definition.properties and the KML template. No balloon: the form is the one the plots map and Google Earth
 * Web build from the survey.
 */
export function madeProjectFile(o: MadeProjectFile, date: Date): Buffer {
  const extraData = [
    ...o.columns.map((name, i) => `<Data name="EXTRA_${name}">\n<value>\${placemark.extraColumns[${i}]}</value>\n</Data>`),
    '<Data name="EXTRA_id">\n<value>${placemark.idColumns[0]}</value>\n</Data>',
  ].join('\n');
  const template = KML_TEMPLATE.replace('@@EXTRA_DATA@@', extraData);

  const properties = [
    `#${property(o.comment)}`,
    'metadata_file=${project_path}/placemark.idm.xml',
    'template=${project_path}/kml_template.fmt',
    `survey_name=${property(o.surveyName)}`,
    'coordinates_reference_system=EPSG\\:4326',
    ...layoutProperties(o.layout),
    ...(o.properties ?? []),
    '',
  ].join('\n');

  const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
  const entries = new Map<string, Uint8Array>([
    ['placemark.idm.xml', utf8(o.idml)],
    ['project_definition.properties', utf8(properties)],
    ['kml_template.fmt', utf8(template)],
    // Collect Earth copies this folder beside the KML it makes (KmlGeneratorService), and fails without it
    ['earthFiles/README.txt', utf8('Files for the KML of this project, which Collect Earth copies beside it.\n')],
    ...[...(o.files ?? new Map<string, string>())].map(([path, text]) => [path, utf8(text)] as [string, Uint8Array]),
  ]);
  return zipCep(entries, date);
}

/** The project file of a CEO project, ready for the upload path (routes/platform.ts, acceptCep) */
export function ceoProjectFile(survey: CeoSurvey, date: Date): Buffer {
  const { project, plan, surveyName } = survey;
  return madeProjectFile(
    {
      idml: survey.idml,
      surveyName,
      comment: `Collect Earth project made from Collect Earth Online${project.id !== null ? ` project ${project.id}` : ''}`,
      columns: ['elevation', 'slope', 'aspect', ...plan.columns.map((c) => c.name)],
      layout: survey.layout,
      properties: [
        // Answers per sample point: Collect Earth numbers the points on the map, as the rows of the questions' table
        ...(survey.perPoint ? ['sample_point_numbers=true'] : []),
        `open_gee_app=${project.options.showGEEScript === true ? 'true' : 'false'}`,
      ],
      // The import report goes in too, so it stays with the project
      files: new Map([['ceo_import_report.txt', reportText(survey)]]),
    },
    date,
  );
}
