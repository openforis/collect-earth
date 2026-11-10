// A new project from a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md, B3 to B5): the files a
// coordinator saved from CEO (get-project-by-id, and get-project-plots for its plots), its survey, rules and plots
// translated (src/ceo), shown as a report first, then made into a project whose project file goes through the upload
// path every project file takes (acceptCep), so the round, the note and the space limit apply as they do to any; its
// plots become its plot file, written as the plot design writes one. Without the plots file, the plots come after: a
// plot file or a plot design.
//
// - POST /v1/projects/from-ceo/preview { ceoProject, ceoPlots? } -> { name, ceoProjectId, counts, report }: nothing stored.
// - POST /v1/projects/from-ceo { ceoProject, ceoPlots?, name? } -> 201 { projectId, name, round, plotFile, counts, report }:
//   who may make a project (projectCreation, maxProjectsPerUser) as for POST /v1/projects; the caller is its coordinator.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ceoSurvey, CeoImportError, type CeoSurvey } from '../ceo/index.js';
import { ceoProjectFile, reportText } from '../ceo/projectFile.js';
import { checkUploadFits } from '../limits.js';
import { plotFileCsv } from '../plotDesign.js';
import { parsePlotFile } from '../plots.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { acceptCep } from './platform.js';
import { plotFileFormat } from './plotDesign.js';
import { creationRefusal } from './projects.js';

interface ImportBody {
  /** the saved file: its JSON, or its text */
  ceoProject?: unknown;
  /** CEO's plot list (get-project-plots), as saved: its JSON, or its text; optional */
  ceoPlots?: unknown;
  /** the new project's name; CEO's by default */
  name?: unknown;
}

const MAX_NAME = 200;

/** What the dashboard shows of an import: the counts, and every entry */
function summary(s: CeoSurvey) {
  const r = s.report;
  return {
    ceoProjectId: s.project.id,
    counts: {
      questions: r.count('imported', 'question') + r.count('changed', 'question'),
      questionsChanged: r.count('changed', 'question'),
      questionsSkipped: r.count('skipped', 'question'),
      rules: r.count('imported', 'rule') + r.count('changed', 'rule'),
      rulesSkipped: r.count('skipped', 'rule'),
      /** null: no plots file */
      plots: s.plots ? s.plots.plots.length : null,
    },
    report: r.entries,
  };
}

/** The survey of the body's CEO file, or the answer refusing it */
function translate(body: ImportBody, reply: FastifyReply): CeoSurvey | null {
  const asText = (raw: unknown) => (typeof raw === 'string' ? raw : raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : null);
  const json = asText(body.ceoProject);
  if (json === null) {
    void reply.code(400).send({ error: 'bad_request', reason: 'ceoProject must be the project file saved from Collect Earth Online' });
    return null;
  }
  const plots = body.ceoPlots === undefined || body.ceoPlots === null ? undefined : asText(body.ceoPlots);
  if (plots === null) {
    void reply.code(400).send({ error: 'bad_request', reason: 'ceoPlots must be the plots file saved from Collect Earth Online' });
    return null;
  }
  try {
    return ceoSurvey(json, plots !== undefined ? { plots } : {});
  } catch (e) {
    if (e instanceof CeoImportError) {
      void reply.code(400).send({ error: 'ceo_unreadable', reason: e.message });
      return null;
    }
    throw e;
  }
}

export async function registerCeoImportRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post('/v1/projects/from-ceo/preview', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const survey = translate((request.body ?? {}) as ImportBody, reply);
    if (!survey) return reply;
    return reply.send({ name: survey.project.name, ...summary(survey) });
  });

  app.post('/v1/projects/from-ceo', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await store.getUserById(request.userId!);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const refused = await creationRefusal(store, user);
    if (refused) return reply.code(403).send(refused);
    const body = (request.body ?? {}) as ImportBody;
    const survey = translate(body, reply);
    if (!survey) return reply;
    const asked = typeof body.name === 'string' ? body.name.trim() : '';
    const name = (asked || survey.project.name || `CEO project ${survey.project.id ?? ''}`.trim()).slice(0, MAX_NAME);

    const cep = ceoProjectFile(survey, new Date());
    const { projectId } = await store.createProject({ name });
    await store.addMembership(projectId, user.id, 'admin');
    const accepted = await acceptCep(store, projectId, cep, request.log);
    if (!accepted.ok) {
      // Nothing half made: the project goes with its refusal
      await store.deleteProject(projectId);
      return reply.code(accepted.status).send(accepted.body);
    }
    // Its plots, as the plot design writes a plot file, through what the plot-file upload stores and logs
    let plotFile: { csvFileId: string; filename: string; plots: number } | null = null;
    if (survey.plots) {
      const format = await plotFileFormat(store, projectId, request.log);
      const filename = `ceo_${survey.project.id ?? 'project'}_plots.csv`;
      const data = Buffer.from(plotFileCsv(survey.plots.plots, format?.keys ?? { count: 1, roundIndex: null, roundCode: '1' }, format?.extra ?? null), 'utf8');
      const over = await checkUploadFits(store, projectId, { kind: 'csv', filename }, data.length);
      if (over) {
        await store.deleteProject(projectId);
        return reply.code(413).send(over);
      }
      const keyCount = format?.keys.count ?? 1;
      const meta = await store.putCsvFile(projectId, filename, data, parsePlotFile(data, keyCount).plotIds);
      plotFile = { csvFileId: meta.id, filename, plots: meta.plotCount };
    }
    const s = summary(survey);
    try {
      await store.appendAudit(projectId, {
        actorUserId: user.id,
        action: 'project.imported',
        details: {
          source: 'ceo',
          ceoProjectId: survey.project.id,
          questions: s.counts.questions,
          questionsChanged: s.counts.questionsChanged,
          questionsSkipped: s.counts.questionsSkipped,
          rules: s.counts.rules,
          rulesSkipped: s.counts.rulesSkipped,
          plots: s.counts.plots,
        },
      });
      if (plotFile) await store.appendAudit(projectId, { actorUserId: user.id, action: 'csv.uploaded', details: { csvFileId: plotFile.csvFileId, plots: plotFile.plots } });
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    request.log.info({ projectId, ceoProjectId: survey.project.id, round: accepted.info.state }, 'project made from a Collect Earth Online project');
    return reply.code(201).send({ projectId, name, round: accepted.info.state, plotFile, reportText: reportText(survey), ...s });
  });
}
