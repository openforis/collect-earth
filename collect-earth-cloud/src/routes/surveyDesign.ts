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
import { surveyImpact } from '../survey/impact.js';
import { XmlTreeError } from '../survey/xmlTree.js';
import type {
  ConditionPart,
  ConditionRows,
  NewRule,
  NewRuleLimit,
  SurveyChangeInput,
  SurveyChangeRefusal,
  SurveyDesignAnswer,
  SurveyImpactAnswer,
  SurveyOperation,
  SurveyRestoreInput,
  SurveyVersionsAnswer,
  TotalTest,
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

/** Texts by language, as an operation gives them */
function readLocalized(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (!isString(k, 20) || !isString(t, 10_000)) return null;
    out[k] = t;
  }
  return out;
}

const optionalString = (v: unknown, max = 200): v is string | undefined => v === undefined || isString(v, max);
const optionalId = (v: unknown): v is number | undefined => v === undefined || Number.isInteger(v);
const NEW_TYPES = new Set(['choice', 'choices', 'yesNo', 'integer', 'decimal', 'text', 'memo', 'date']);

function readItem(v: unknown): { code: string; label: Record<string, string> } | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const label = readLocalized(o.label);
  return isString(o.code, 100) && label ? { code: o.code, label } : null;
}

/** One operation as the designer sends it, or null */
function readOperation(raw: unknown): SurveyOperation | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  switch (o.op) {
    case 'addLanguage':
      return isString(o.language, 20) ? { op: 'addLanguage', language: o.language } : null;
    case 'setText': {
      const target = readTarget(o.target);
      return target && ['label', 'help', 'message'].includes(o.part as string) && isString(o.language, 20) && isString(o.text, 10_000)
        ? { op: 'setText', target, part: o.part as 'label' | 'help' | 'message', language: o.language, text: o.text }
        : null;
    }
    case 'addPage': {
      const label = readLocalized(o.label);
      return label && optionalString(o.before) ? { op: 'addPage', label, ...(o.before !== undefined ? { before: o.before } : {}) } : null;
    }
    case 'movePage':
      return isString(o.name) && optionalString(o.before) ? { op: 'movePage', name: o.name, ...(o.before !== undefined ? { before: o.before } : {}) } : null;
    case 'deletePage':
      return isString(o.name) ? { op: 'deletePage', name: o.name } : null;
    case 'addQuestion': {
      const label = readLocalized(o.label);
      if (!label || !NEW_TYPES.has(o.type as string) || !optionalString(o.name, 63) || !optionalString(o.page) || !optionalId(o.table) || !optionalId(o.before)) return null;
      if (!optionalString(o.list) || (o.required !== undefined && typeof o.required !== 'boolean')) return null;
      return {
        op: 'addQuestion',
        type: o.type as Extract<SurveyOperation, { op: 'addQuestion' }>['type'],
        label,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.page !== undefined ? { page: o.page } : {}),
        ...(o.table !== undefined ? { table: o.table } : {}),
        ...(o.before !== undefined ? { before: o.before } : {}),
        ...(o.list !== undefined ? { list: o.list } : {}),
        ...(o.required !== undefined ? { required: o.required } : {}),
      };
    }
    case 'moveQuestion':
      return Number.isInteger(o.id) && optionalString(o.page) && optionalId(o.before)
        ? { op: 'moveQuestion', id: o.id as number, ...(o.page !== undefined ? { page: o.page } : {}), ...(o.before !== undefined ? { before: o.before } : {}) }
        : null;
    case 'deleteQuestion':
      return Number.isInteger(o.id) ? { op: 'deleteQuestion', id: o.id as number } : null;
    case 'setRequired': {
      const required = typeof o.required === 'boolean' ? o.required : readRows(o.required);
      return Number.isInteger(o.id) && required !== null ? { op: 'setRequired', id: o.id as number, required } : null;
    }
    case 'setShownWhen': {
      const when = o.when === null ? null : readRows(o.when);
      return Number.isInteger(o.id) && (o.when === null || when !== null) ? { op: 'setShownWhen', id: o.id as number, when } : null;
    }
    case 'addRule': {
      const rule = readRule(o.rule);
      return Number.isInteger(o.id) && rule ? { op: 'addRule', id: o.id as number, rule } : null;
    }
    case 'setRule': {
      const rule = readRule(o.rule);
      return Number.isInteger(o.id) && isIndex(o.index) && rule ? { op: 'setRule', id: o.id as number, index: o.index as number, rule } : null;
    }
    case 'deleteRule':
      return Number.isInteger(o.id) && isIndex(o.index) ? { op: 'deleteRule', id: o.id as number, index: o.index as number } : null;
    case 'addList': {
      const label = readLocalized(o.label);
      if (!label || !optionalString(o.name, 63) || !Array.isArray(o.items) || o.items.length > 1000) return null;
      const items = o.items.map(readItem);
      if (items.some((i) => i === null)) return null;
      return { op: 'addList', label, items: items as Array<{ code: string; label: Record<string, string> }>, ...(o.name !== undefined ? { name: o.name } : {}) };
    }
    case 'deleteList':
      return isString(o.name) ? { op: 'deleteList', name: o.name } : null;
    case 'addItem': {
      const item = readItem(o.item);
      return isString(o.list) && item && optionalString(o.before, 100)
        ? { op: 'addItem', list: o.list, item, ...(o.before !== undefined ? { before: o.before } : {}) }
        : null;
    }
    case 'moveItem':
      return isString(o.list) && isString(o.code, 100) && optionalString(o.before, 100)
        ? { op: 'moveItem', list: o.list, code: o.code, ...(o.before !== undefined ? { before: o.before } : {}) }
        : null;
    case 'deleteItem':
      return isString(o.list) && isString(o.code, 100) ? { op: 'deleteItem', list: o.list, code: o.code } : null;
    default:
      return null;
  }
}

const isIndex = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000;
const CONDITION_TESTS = new Set(['is', 'isNot', 'lt', 'lte', 'gt', 'gte', 'answered', 'notAnswered']);

/** A condition's rows as the builder sends them; what they say is checked when they are written (logic.ts) */
function readRows(v: unknown): ConditionRows | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if ((o.kind !== 'all' && o.kind !== 'any') || !Array.isArray(o.parts) || o.parts.length > 50) return null;
  const parts: ConditionPart[] = [];
  for (const raw of o.parts) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const value = p.value;
    const valueOk = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || isString(value, 1000);
    if (!isString(p.question, 63) || !CONDITION_TESTS.has(p.test as string) || !valueOk) return null;
    parts.push({ question: p.question, test: p.test as ConditionPart['test'], value: value as ConditionPart['value'] });
  }
  return { kind: o.kind, parts };
}

function readLimit(v: unknown): NewRuleLimit | null | undefined {
  if (v === null || v === undefined) return null;
  const o = v as Record<string, unknown>;
  const b = (o.bound ?? {}) as Record<string, unknown>;
  if (typeof o.inclusive !== 'boolean') return undefined;
  if (typeof b.number === 'number' && Number.isFinite(b.number)) return { bound: { number: b.number }, inclusive: o.inclusive };
  if (isString(b.question, 63)) return { bound: { question: b.question }, inclusive: o.inclusive };
  return undefined;
}

const nullableNumber = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));

/** A rule as the builder sends it */
function readRule(v: unknown): NewRule | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.flag !== 'error' && o.flag !== 'warning') return null;
  const message = o.message === undefined ? {} : readLocalized(o.message);
  if (!message) return null;
  const when = o.when === null || o.when === undefined ? null : readRows(o.when);
  if (o.when !== null && o.when !== undefined && when === null) return null;
  const base = { flag: o.flag, message, when } as const;
  switch (o.kind) {
    case 'range': {
      const min = readLimit(o.min);
      const max = readLimit(o.max);
      return min !== undefined && max !== undefined ? { ...base, kind: 'range', min, max } : null;
    }
    case 'length':
      return nullableNumber(o.min) && nullableNumber(o.max) ? { ...base, kind: 'length', min: o.min, max: o.max } : null;
    case 'total':
      return ['atLeast', 'atMost', 'exactly'].includes(o.test as string) && typeof o.total === 'number' && Number.isFinite(o.total)
        ? { ...base, kind: 'total', test: o.test as TotalTest, total: o.total }
        : null;
    default:
      return null;
  }
}

function readOperationList(v: unknown): SurveyOperation[] | string {
  if (!Array.isArray(v) || v.length === 0) return 'operations is missing';
  if (v.length > MAX_OPERATIONS) return `at most ${MAX_OPERATIONS} operations at once`;
  const operations: SurveyOperation[] = [];
  for (const [i, raw] of v.entries()) {
    const op = readOperation(raw);
    if (!op) return `operation ${i + 1} is not one the designer makes`;
    operations.push(op);
  }
  return operations;
}

function readOperations(body: unknown): { revision: string; operations: SurveyOperation[] } | string {
  const b = (body ?? {}) as Partial<Record<keyof SurveyChangeInput, unknown>>;
  if (!isString(b.revision, 100)) return 'revision is missing';
  const operations = readOperationList(b.operations);
  return typeof operations === 'string' ? operations : { revision: b.revision, operations };
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
    const structure = asked.operations.filter((o) => o.op !== 'setText' && o.op !== 'addLanguage').length;
    await audit(store, request, 'survey.edited', {
      changes: asked.operations.length,
      ...(languages.length > 0 ? { languages: languages.join(',') } : {}),
      ...(structure > 0 ? { structure } : {}),
    });
    return designAnswer(store, config, projectId, request.log);
  });

  // What the changes would do to the plots already collected, before they are saved (nothing is written)
  app.post('/v1/projects/:pid/survey/design/impact', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const operations = readOperationList(((request.body ?? {}) as { operations?: unknown }).operations);
    if (typeof operations === 'string') return reply.code(400).send({ error: 'bad_request', reason: operations } satisfies SurveyChangeRefusal);
    const served = await store.getCep(projectId);
    if (!served) return reply.code(404).send({ error: 'not_found' });
    const survey = surveyOf(readCep(served));
    let after: Buffer;
    try {
      const edit = new SurveyEdit(survey);
      for (const op of operations) edit.apply(op);
      after = edit.bytes();
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send({ error: 'bad_request', reason: err.message } satisfies SurveyChangeRefusal);
      throw err;
    }
    const records = await store.listRecordSummaries(projectId);
    return surveyImpact(survey, operations, records, after) satisfies SurveyImpactAnswer;
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
