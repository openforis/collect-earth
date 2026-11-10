// A Collect Earth Online project's survey and rules as a Collect survey, with the import report
// (docs/plans/2026-11-09-ceo-bridge.md, Part B1 and B2), with its plots (B3); the project file and the page (B4) build on it.
import { writeIdml } from './idml.js';
import { readCeoAnswers, type CeoAnswers } from './answers.js';
import { plotLayout, readCeoPlots, type CeoPlots, type PlotLayout } from './plots.js';
import { CeoImportError, readCeoProject, type CeoProject } from './project.js';
import { Report } from './report.js';
import { planChecks, type PlannedCheck } from './rules.js';
import { planSurvey, slug, type SurveyPlan } from './survey.js';

export { CeoImportError, readCeoProject } from './project.js';
export type { ReportEntry } from './report.js';

export interface CeoSurvey {
  project: CeoProject;
  /** placemark.idm.xml */
  idml: string;
  /** the survey's name in the project file (survey_name) */
  surveyName: string;
  plan: SurveyPlan;
  checks: PlannedCheck[];
  /** how Collect Earth draws the plots (project_definition.properties) */
  layout: PlotLayout;
  /** the plots of CEO's plot list, when one was given */
  plots: CeoPlots | null;
  /** what CEO's collectors answered, when its sample data was given (Part C) */
  answers: CeoAnswers | null;
  report: Report;
}

/**
 * The survey of a CEO project file (as saved from get-project-by-id), translated. `columns`: the plot file's extra
 * columns, read into each record; `plots`: CEO's plot list (get-project-plots), as saved. Refuses a simplified project
 * (collectors draw their samples).
 */
export function ceoSurvey(json: string, options: { columns?: readonly string[]; plots?: string; answers?: string } = {}): CeoSurvey {
  const project = readCeoProject(json);
  if (project.type === 'simplified') {
    throw new CeoImportError(
      'This is a simplified CEO project: its collectors draw their own samples, which Collect Earth does not do. It cannot be imported.',
    );
  }
  const report = new Report();
  const plan = planSurvey(project, report, options);
  if (plan.attributes.length === 0) {
    throw new CeoImportError('None of the questions of this CEO project can be asked in Collect Earth (they are all hidden or have no answers).');
  }
  const checks = planChecks(project, plan, report);
  projectNotes(project, report);
  const layout = plotLayout(project, report);
  const plots = options.plots !== undefined ? readCeoPlots(options.plots, project, report, options.answers !== undefined) : null;
  const answers = options.answers !== undefined
    ? readCeoAnswers(options.answers, project, plan, report, plots ? new Set(plots.plots.map((p) => p.id)) : undefined)
    : null;
  const surveyName = `ceo_${project.id ?? (slug(project.name, 30) || 'project')}`;
  const idml = writeIdml(
    {
      project: project.name || `CEO project ${project.id ?? ''}`.trim(),
      uri: `http://www.openforis.org/idm/${surveyName}`,
      description: [project.description, project.id !== null ? `Imported from Collect Earth Online, project ${project.id}.` : 'Imported from Collect Earth Online.']
        .filter(Boolean)
        .join('\n\n'),
      answerFields: options.answers !== undefined,
    },
    plan,
    checks,
  );
  return { project, idml, surveyName, plan, checks, layout, plots, answers, report };
}

/** What the project's settings mean in Collect Earth, said once each. */
function projectNotes(p: CeoProject, report: Report): void {
  const samples = p.samplesPerPlot ?? 0;
  if (samples > 1) {
    report.add('project', 'Samples', 'changed',
      `CEO asked each question per sample point (${samples} per plot). In Collect Earth each question is answered once for the plot.`);
  }
  if (p.allowDrawnSamples) report.add('project', 'Drawn samples', 'info', 'Collectors could draw samples in CEO; Collect Earth has no drawing.');
  if (p.learningMaterial.trim()) report.add('project', 'Learning material', 'info', "CEO's interpretation guide is kept for the project's survey guide.");
  if (p.options.collectConfidence === true) {
    report.add('project', 'Confidence', 'info', "CEO asked for the collector's confidence: with CEO's sample data, each record keeps it (ceo_confidence).");
  }
  const users = (p.designSettings.userAssignment as { userMethod?: unknown } | undefined)?.userMethod;
  if (typeof users === 'string' && users !== 'none') {
    report.add('project', 'Plot assignment', 'info', `CEO gave out the plots (${users}); divide them again among the members in Collect Earth.`);
  }
  const qaqc = (p.designSettings.qaqcAssignment as { qaqcMethod?: unknown } | undefined)?.qaqcMethod;
  if (typeof qaqc === 'string' && qaqc !== 'none') {
    report.add('project', 'Quality checks', 'info', `CEO had quality checks (${qaqc}); set the check sampling again in Collect Earth.`);
  }
}
