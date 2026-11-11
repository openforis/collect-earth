// The project file (.cep) of a project made from a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md,
// B4): the survey (idml.ts), project_definition.properties, the KML template and a balloon. The form is the one the
// plots map and Google Earth Web build from the survey; the balloon is there for what reads it: the cloud's addRound
// and addNote (its marker line and EXTRA_ID_ATTRIBUTES) and Collect Earth's KML (Google Earth Pro, Export to KML),
// where it only says where the form is. The import report goes in too, so it stays with the project.
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

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A properties value: backslashes, and a leading space, escaped; one line */
const property = (s: string): string => s.replace(/\\/g, '\\\\').replace(/^ /, '\\ ').replace(/\r?\n/g, ' ');

/** What a project file the server makes holds: the survey, its layout and the plot file's extra columns. */
export interface MadeProjectFile {
  /** the survey (placemark.idm.xml) */
  idml: string;
  /** the project's name, for the balloon's title */
  title: string;
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
 * A project file made by the server (a CEO import, a backup's): the survey, project_definition.properties, the KML
 * template and a balloon. The form is the one the plots map and Google Earth Web build from the survey; the balloon is
 * there for what reads it: the cloud's addRound and addNote (its marker line and EXTRA_ID_ATTRIBUTES) and Collect
 * Earth's KML (Google Earth Pro, Export to KML), where it only says where the form is.
 */
export function madeProjectFile(o: MadeProjectFile, date: Date): Buffer {
  const extraData = [
    ...o.columns.map((name, i) => `<Data name="EXTRA_${name}">\n<value>\${placemark.extraColumns[${i}]}</value>\n</Data>`),
    '<Data name="EXTRA_id">\n<value>${placemark.idColumns[0]}</value>\n</Data>',
  ].join('\n');
  const template = KML_TEMPLATE.replace('@@EXTRA_DATA@@', extraData);

  const balloon = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(o.title)}</title>
  <script type="text/javascript">
    var EXTRA_ID_ATTRIBUTES = ['collect_text_id'];
  </script>
</head>
<body>
  <form>
<!-- START OF EXTRA CSV DATA -->
<input type="hidden" id="collect_text_id" name="collect_text_id" value="$[EXTRA_id]" class="extra" />
  </form>
  <p>Plot $[EXTRA_id]: this project's form opens in Collect Earth's plots map and in Google Earth Web
  (Settings, Plot viewer), not in this balloon.</p>
</body>
</html>
`;

  const properties = [
    `#${property(o.comment)}`,
    'metadata_file=${project_path}/placemark.idm.xml',
    'balloon=${project_path}/balloon.html',
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
    ['balloon.html', utf8(balloon)],
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
      title: project.name,
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
