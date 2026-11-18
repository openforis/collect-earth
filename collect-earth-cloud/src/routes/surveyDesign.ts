// The survey designer (docs/plans/2026-11-18-survey-designer.md): the project's survey as the designer shows it
// (stage 1), its words changed (stage 2), and the versions kept before each change.
//
// A change is made on the served project file's survey, and on the uploaded file's when the server serves a changed
// copy, each through the lossless tree (src/survey): every other byte of both stays. It is refused when the survey
// check (src/survey/check.ts) finds a problem the survey did not have before. People who have the project file keep
// theirs until they open the project again from their list in Collect Earth; those who join get the new one.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { readCep, roundInfoOf, withSurvey, type CepFiles } from '../cep.js';
import type { Config } from '../config.js';
import { checkUploadFits } from '../limits.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { checkSurvey, type SurveyProblem } from '../survey/check.js';
import { surveyDesign } from '../survey/design.js';
import { SurveyEdit, SurveyEditError } from '../survey/edit.js';
import { XmlTreeError } from '../survey/xmlTree.js';
import type {
  SurveyChangeInput,
  SurveyChangeRefusal,
  SurveyDesignAnswer,
  SurveyOperation,
  SurveyRestoreInput,
  SurveyVersionsAnswer,
  WordTarget,
} from '../wire/survey.js';

/** The most operations one save takes */
const MAX_OPERATIONS = 2000;

/** A survey's revision: what a change names, so that two coordinators do not undo each other */
export const revisionOf = (survey: Uint8Array): string => createHash('sha256').update(survey).digest('hex').slice(0, 24);

const surveyOf = (files: CepFiles): Buffer => Buffer.from(files.entries.get(files.surveyPath)!);

async function designAnswer(store: Store, config: Config, projectId: string, log: FastifyRequest['log']): Promise<SurveyDesignAnswer> {
  const empty = { design: null, revision: null, editable: false, peopleWithFile: 0, problems: [] };
  const cep = await store.getCep(projectId);
  if (!cep) return { ...empty, unreadable: false };
  try {
    const survey = surveyOf(readCep(cep));
    const activity = await store.listMemberActivity(projectId);
    return {
      design: surveyDesign(survey),
      unreadable: false,
      revision: revisionOf(survey),
      editable: !config.localMode,
      peopleWithFile: activity.filter((a) => a.lastCepDownloadAt !== null).length,
      // What Collect or Collect Earth would refuse in it: shown as warnings, as the survey came from Collect's designer
      problems: checkSurvey(survey),
    };
  } catch (err) {
    log.warn({ err }, 'could not read the survey of the project file for the designer');
    return { ...empty, unreadable: true };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What a change asks: checked before anything is read

const isString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

function readTarget(v: unknown): WordTarget | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  switch (t.kind) {
    case 'title':
      return { kind: 'title' };
    case 'page':
      return isString(t.name) ? { kind: 'page', name: t.name } : null;
    case 'node':
      return Number.isInteger(t.id) ? { kind: 'node', id: t.id as number } : null;
    case 'list':
      return isString(t.name) ? { kind: 'list', name: t.name } : null;
    case 'item':
      return isString(t.list) && isString(t.code) ? { kind: 'item', list: t.list, code: t.code } : null;
    case 'rule':
      return Number.isInteger(t.node) && Number.isInteger(t.index) && (t.index as number) >= 0
        ? { kind: 'rule', node: t.node as number, index: t.index as number }
        : null;
    default:
      return null;
  }
}

function readOperations(body: unknown): { revision: string; operations: SurveyOperation[] } | string {
  const b = (body ?? {}) as Partial<Record<keyof SurveyChangeInput, unknown>>;
  if (!isString(b.revision, 100)) return 'revision is missing';
  if (!Array.isArray(b.operations) || b.operations.length === 0) return 'operations is missing';
  if (b.operations.length > MAX_OPERATIONS) return `at most ${MAX_OPERATIONS} operations at once`;
  const operations: SurveyOperation[] = [];
  for (const [i, raw] of b.operations.entries()) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (o.op === 'addLanguage' && isString(o.language, 20)) {
      operations.push({ op: 'addLanguage', language: o.language });
      continue;
    }
    const target = readTarget(o.target);
    if (o.op === 'setText' && target && ['label', 'help', 'message'].includes(o.part as string) && isString(o.language, 20) && isString(o.text, 10_000)) {
      operations.push({ op: 'setText', target, part: o.part as 'label' | 'help' | 'message', language: o.language, text: o.text });
      continue;
    }
    return `operation ${i + 1} is not one the designer makes`;
  }
  return { revision: b.revision, operations };
}

/** The problems a changed survey has that the survey before had not */
function newProblems(before: SurveyProblem[], after: SurveyProblem[]): SurveyProblem[] {
  const key = (p: SurveyProblem) => JSON.stringify([p.node, p.code, p.values, p.expression]);
  const known = new Set(before.map(key));
  return after.filter((p) => !known.has(key(p)));
}

export async function registerSurveyDesignRoutes(app: FastifyInstance, store: Store, config: Config): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.get('/v1/projects/:pid/survey/design', admin, async (request) => {
    return designAnswer(store, config, request.membership!.projectId, request.log);
  });

  /**
   * Writes the survey into the served project file and the uploaded one (when they differ), keeping the survey before
   * as a version.
   */
  async function writeSurvey(
    request: FastifyRequest,
    projectId: string,
    served: Buffer,
    next: Buffer,
    nextOriginal: Buffer | null,
    kept: { survey: Buffer; original: Buffer | null; changes: number; restoredFrom: string | null },
  ): Promise<{ status: 413; body: unknown } | null> {
    const date = new Date();
    const storedOriginal = await store.getOriginalCep(projectId);
    const originalCep = storedOriginal && !storedOriginal.equals(served) ? storedOriginal : null;
    const nextServed = withSurvey(served, next, date);
    const nextOriginalCep = originalCep ? withSurvey(originalCep, nextOriginal ?? next, date) : null;
    const over = await checkUploadFits(store, projectId, { kind: 'cep' }, nextServed.length + (nextOriginalCep?.length ?? 0));
    if (over) return { status: 413, body: over };
    await store.addSurveyVersion(projectId, { ...kept, createdBy: request.userId ?? null });
    await store.putCep(projectId, nextServed, (await store.getRoundInfo(projectId)) ?? roundInfoOf(nextServed), nextOriginalCep);
    return null;
  }

  app.post('/v1/projects/:pid/survey/design', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const asked = readOperations(request.body);
    if (typeof asked === 'string') return reply.code(400).send({ error: 'bad_request', reason: asked } satisfies SurveyChangeRefusal);
    const served = await store.getCep(projectId);
    if (!served) return reply.code(404).send({ error: 'not_found' });
    let files: CepFiles;
    let edit: SurveyEdit;
    try {
      files = readCep(served);
      edit = new SurveyEdit(surveyOf(files));
    } catch (err) {
      if (err instanceof XmlTreeError || err instanceof SurveyEditError) {
        return reply.code(409).send({ error: 'unreadable', reason: 'the survey of the project file cannot be read' });
      }
      throw err;
    }
    const survey = surveyOf(files);
    if (revisionOf(survey) !== asked.revision) {
      return reply.code(409).send({ error: 'stale', reason: 'the survey changed since it was read: read it again' } satisfies SurveyChangeRefusal);
    }
    try {
      for (const op of asked.operations) edit.apply(op);
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send({ error: 'bad_request', reason: err.message } satisfies SurveyChangeRefusal);
      throw err;
    }
    const next = edit.bytes();
    if (next.equals(survey)) return designAnswer(store, config, projectId, request.log);
    const problems = newProblems(checkSurvey(survey), edit.problems());
    if (problems.length > 0) {
      return reply.code(400).send({ error: 'survey_problems', reason: 'Collect Earth would not open the survey changed so', problems } satisfies SurveyChangeRefusal);
    }

    // The same changes on the uploaded file's survey, where it differs: what it lacks (a field the server added) is
    // left as it is there
    const storedOriginal = await store.getOriginalCep(projectId);
    let originalSurvey: Buffer | null = null;
    let nextOriginal: Buffer | null = null;
    if (storedOriginal && !storedOriginal.equals(served)) {
      try {
        originalSurvey = surveyOf(readCep(storedOriginal));
        const originalEdit = new SurveyEdit(originalSurvey);
        for (const op of asked.operations) {
          try {
            originalEdit.apply(op);
          } catch (err) {
            if (!(err instanceof SurveyEditError)) throw err;
          }
        }
        nextOriginal = originalEdit.bytes();
      } catch (err) {
        if (!(err instanceof XmlTreeError || err instanceof SurveyEditError)) throw err;
        request.log.warn({ err }, 'the uploaded project file\'s survey could not be changed as the served one');
        nextOriginal = null;
      }
    }
    const refused = await writeSurvey(request, projectId, served, next, nextOriginal, {
      survey,
      original: originalSurvey,
      changes: asked.operations.length,
      restoredFrom: null,
    });
    if (refused) return reply.code(refused.status).send(refused.body);
    const languages = asked.operations.filter((o) => o.op === 'addLanguage').map((o) => (o as { language: string }).language);
    await audit(store, request, 'survey.edited', { changes: asked.operations.length, ...(languages.length > 0 ? { languages: languages.join(',') } : {}) });
    return designAnswer(store, config, projectId, request.log);
  });

  app.get('/v1/projects/:pid/survey/versions', admin, async (request) => {
    const projectId = request.membership!.projectId;
    const versions = await store.listSurveyVersions(projectId);
    const names = new Map<string, string | null>();
    for (const v of versions) {
      if (v.createdBy !== null && !names.has(v.createdBy)) names.set(v.createdBy, (await store.getUserById(v.createdBy))?.username ?? null);
    }
    return {
      versions: versions.map((v) => ({
        id: v.id,
        createdAt: v.createdAt,
        by: v.createdBy === null ? null : (names.get(v.createdBy) ?? null),
        changes: v.changes,
        restore: v.restoredFrom !== null,
      })),
    } satisfies SurveyVersionsAnswer;
  });

  // Brings a kept version back; the survey of the moment is kept in its turn, so the restore can be undone too
  app.post('/v1/projects/:pid/survey/versions/:vid/restore', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const { vid } = request.params as { vid: string };
    const b = (request.body ?? {}) as Partial<SurveyRestoreInput>;
    if (!isString(b.revision, 100)) return reply.code(400).send({ error: 'bad_request', reason: 'revision is missing' } satisfies SurveyChangeRefusal);
    const [served, version] = await Promise.all([store.getCep(projectId), store.getSurveyVersionData(projectId, vid)]);
    if (!served || !version) return reply.code(404).send({ error: 'not_found' });
    const survey = surveyOf(readCep(served));
    if (revisionOf(survey) !== b.revision) {
      return reply.code(409).send({ error: 'stale', reason: 'the survey changed since it was read: read it again' } satisfies SurveyChangeRefusal);
    }
    const storedOriginal = await store.getOriginalCep(projectId);
    const originalSurvey = storedOriginal && !storedOriginal.equals(served) ? surveyOf(readCep(storedOriginal)) : null;
    const refused = await writeSurvey(request, projectId, served, version.survey, version.original, {
      survey,
      original: originalSurvey,
      changes: 0,
      restoredFrom: vid,
    });
    if (refused) return reply.code(refused.status).send(refused.body);
    await audit(store, request, 'survey.edited', { restored: true });
    return designAnswer(store, config, projectId, request.log);
  });
}
