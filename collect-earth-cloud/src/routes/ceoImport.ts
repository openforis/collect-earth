// A new project from a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md, B4 and B5): the file a
// coordinator saved from CEO (get-project-by-id), its survey and rules translated (src/ceo), shown as a report first,
// then made into a project whose project file goes through the upload path every project file takes (acceptCep), so
// the round, the note and the space limit apply as they do to any. The plots come after: a plot file, a plot design,
// or (later) CEO's own plots.
//
// - POST /v1/projects/from-ceo/preview { ceoProject } -> { name, ceoProjectId, counts, report }: nothing stored.
// - POST /v1/projects/from-ceo { ceoProject, name? } -> 201 { projectId, name, counts, report }: who may make a project
//   (projectCreation, maxProjectsPerUser) as for POST /v1/projects; the caller is its coordinator.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ceoSurvey, CeoImportError, type CeoSurvey } from '../ceo/index.js';
import { ceoProjectFile, reportText } from '../ceo/projectFile.js';
import { requireSession } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { acceptCep } from './platform.js';
import { creationRefusal } from './projects.js';

interface ImportBody {
  /** the saved file: its JSON, or its text */
  ceoProject?: unknown;
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
    },
    report: r.entries,
  };
}

/** The survey of the body's CEO file, or the answer refusing it */
function translate(body: ImportBody, reply: FastifyReply): CeoSurvey | null {
  const raw = body.ceoProject;
  const json = typeof raw === 'string' ? raw : raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : null;
  if (json === null) {
    void reply.code(400).send({ error: 'bad_request', reason: 'ceoProject must be the project file saved from Collect Earth Online' });
    return null;
  }
  try {
    return ceoSurvey(json);
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
        },
      });
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    request.log.info({ projectId, ceoProjectId: survey.project.id, round: accepted.info.state }, 'project made from a Collect Earth Online project');
    return reply.code(201).send({ projectId, name, round: accepted.info.state, reportText: reportText(survey), ...s });
  });
}
