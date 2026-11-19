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
import { cepProperties, CepError, readCep, roundInfoOf, withProperties, withSurvey, type CepFiles } from '../cep.js';
import { rewriteProperties } from '../plotLayout.js';
import type { Config } from '../config.js';
import { checkUploadFits } from '../limits.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { checkSurvey, newProblems } from '../survey/check.js';
import { surveyDesign } from '../survey/design.js';
import { operationFor, SurveyEdit, SurveyEditError } from '../survey/edit.js';
import { surveyImpact } from '../survey/impact.js';
import { olderSurveyPlots } from '../survey/olderPlots.js';
import { newProjectFile, TEMPLATES_WITH_YEARS } from '../survey/templates.js';
import { acceptCep } from './platform.js';
import { XmlTreeError } from '../survey/xmlTree.js';
import type {
  ConditionPart,
  ConditionRows,
  ExpressionCheckAnswer,
  NewFormula,
  NewRule,
  NewRuleLimit,
  SurveyChangeInput,
  SurveyChangeRefusal,
  SurveyDesignAnswer,
  SurveyImpactAnswer,
  SurveyOlderAnswer,
  SurveyOperation,
  SurveyNewInput,
  SurveyRestoreInput,
  SurveyRevisionAnswer,
  SurveyTemplate,
  SurveyVersionsAnswer,
  TotalTest,
  WordTarget,
} from '../wire/survey.js';

/**
 * The operations with a name given to each new page that has none: one neither survey has (the served one, and the
 * uploaded one when it differs), as the designer makes them (tab_<number>)
 */
function namedPages(operations: SurveyOperation[], served: SurveyEdit, original: Buffer | null): SurveyOperation[] {
  if (!operations.some((o) => o.op === 'addPage' && o.name === undefined)) return operations;
  const taken = served.pageNames();
  let next = served.lastIdValue() + 1;
  if (original) {
    try {
      const other = new SurveyEdit(surveyOf(readCep(original)));
      for (const n of other.pageNames()) taken.add(n);
      next = Math.max(next, other.lastIdValue() + 1);
    } catch (err) {
      if (!(err instanceof XmlTreeError || err instanceof SurveyEditError || err instanceof CepError)) throw err;
    }
  }
  for (const o of operations) if (o.op === 'addPage' && o.name !== undefined) taken.add(o.name);
  return operations.map((o) => {
    if (o.op !== 'addPage' || o.name !== undefined) return o;
    while (taken.has(`tab_${next}`)) next++;
    const name = `tab_${next++}`;
    taken.add(name);
    return { ...o, name };
  });
}

/** A refusal of the designer, with its code and values when it has them */
function refusalOf(err: SurveyEditError): SurveyChangeRefusal {
  return { error: 'bad_request', reason: err.message, ...(err.code ? { code: err.code, values: err.values } : {}) };
}

const UNREADABLE = { error: 'unreadable', reason: 'the survey of the project file cannot be read' };

/** The changes whose impact reads no plot */
const CHEAP_IMPACT = new Set<SurveyOperation['op']>(['setText', 'addLanguage', 'addPage', 'movePage', 'deletePage', 'addQuestion', 'moveQuestion', 'copyQuestion', 'addList', 'addItem', 'moveItem', 'addTable']);
/** The most tries of a change on a plot one impact request makes */
const MAX_IMPACT_TRIES = 500_000;

/** The most operations one save takes */
const MAX_OPERATIONS = 2000;
/** The most answers one save adds, in new lists and one by one (a save stays a matter of a second or two) */
const MAX_NEW_ANSWERS = 20000;

/** A survey's revision: what a change names, so that two coordinators do not undo each other */
export const revisionOf = (survey: Uint8Array): string => createHash('sha256').update(survey).digest('hex').slice(0, 24);

const surveyOf = (files: CepFiles): Buffer => Buffer.from(files.entries.get(files.surveyPath)!);

/**
 * A project file whose survey the designer changed shows Collect Earth 2.0's form, made from the survey: never the
 * balloon of the upload (web_form=balloon), written for the survey before. Written out, as Collect Earth 2.0 keeps the
 * value of the project opened before when the key is missing; versions before 2.0 ignore it.
 */
function generatedForm(cep: Buffer, date: Date): Buffer {
  return cepProperties(readCep(cep)).get('web_form') === 'generated' ? cep : withProperties(cep, (data) => rewriteProperties(data, { web_form: 'generated' }), date);
}

async function designAnswer(store: Store, config: Config, projectId: string, log: FastifyRequest['log']): Promise<SurveyDesignAnswer> {
  const empty = { design: null, revision: null, editable: false, peopleWithFile: 0, writtenBy: null, problems: [] };
  const cep = await store.getCep(projectId);
  // Without a project file, editable says a survey can be started here (POST /survey/new)
  if (!cep) return { ...empty, editable: !config.localMode, unreadable: false };
  try {
    const survey = surveyOf(readCep(cep));
    const [activity, versions] = await Promise.all([store.listMemberActivity(projectId), store.listSurveyVersions(projectId)]);
    const revision = revisionOf(survey);
    return {
      design: surveyDesign(survey),
      unreadable: false,
      revision,
      editable: !config.localMode,
      peopleWithFile: activity.filter((a) => a.lastCepDownloadAt !== null).length,
      writtenBy: versions[0]?.revisionAfter === revision ? 'designer' : 'file',
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
      return label && optionalString(o.before) && optionalString(o.name, 63)
        ? { op: 'addPage', label, ...(o.before !== undefined ? { before: o.before } : {}), ...(o.name !== undefined ? { name: o.name } : {}) }
        : null;
    }
    case 'movePage':
      return isString(o.name) && optionalString(o.before) ? { op: 'movePage', name: o.name, ...(o.before !== undefined ? { before: o.before } : {}) } : null;
    case 'deletePage':
      return isString(o.name) ? { op: 'deletePage', name: o.name } : null;
    case 'addQuestion': {
      const label = readLocalized(o.label);
      if (!label || !NEW_TYPES.has(o.type as string) || !optionalString(o.name, 63) || !optionalString(o.page) || !optionalId(o.table) || !optionalId(o.before)) return null;
      if (!optionalString(o.list) || !optionalString(o.parent, 63) || (o.required !== undefined && typeof o.required !== 'boolean')) return null;
      return {
        op: 'addQuestion',
        type: o.type as Extract<SurveyOperation, { op: 'addQuestion' }>['type'],
        label,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.page !== undefined ? { page: o.page } : {}),
        ...(o.table !== undefined ? { table: o.table } : {}),
        ...(o.before !== undefined ? { before: o.before } : {}),
        ...(o.list !== undefined ? { list: o.list } : {}),
        ...(o.parent !== undefined ? { parent: o.parent } : {}),
        ...(o.required !== undefined ? { required: o.required } : {}),
      };
    }
    case 'moveQuestion':
      return Number.isInteger(o.id) && optionalString(o.page) && optionalId(o.before)
        ? { op: 'moveQuestion', id: o.id as number, ...(o.page !== undefined ? { page: o.page } : {}), ...(o.before !== undefined ? { before: o.before } : {}) }
        : null;
    case 'copyQuestion':
      return Number.isInteger(o.id) && optionalId(o.before) ? { op: 'copyQuestion', id: o.id as number, ...(o.before !== undefined ? { before: o.before } : {}) } : null;
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
    case 'setExpression':
      return Number.isInteger(o.id) && (o.part === 'shownWhen' || o.part === 'required') && (o.text === null || isString(o.text, 4000))
        ? { op: 'setExpression', id: o.id as number, part: o.part, text: o.text as string | null }
        : null;
    case 'setFormulas': {
      if (!Number.isInteger(o.id) || !Array.isArray(o.formulas) || o.formulas.length > 100) return null;
      const formulas: NewFormula[] = [];
      for (const raw of o.formulas) {
        const f = (raw ?? {}) as Record<string, unknown>;
        if (!optionalString(f.expression, 4000) || !optionalString(f.value, 4000) || !optionalString(f.when, 4000)) return null;
        formulas.push({
          ...(f.expression !== undefined ? { expression: f.expression } : {}),
          ...(f.value !== undefined ? { value: f.value } : {}),
          ...(f.when !== undefined ? { when: f.when } : {}),
        });
      }
      return { op: 'setFormulas', id: o.id as number, formulas };
    }
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
      return isString(o.list) && item && optionalString(o.before, 100) && optionalString(o.under, 100)
        ? { op: 'addItem', list: o.list, item, ...(o.before !== undefined ? { before: o.before } : {}), ...(o.under !== undefined ? { under: o.under } : {}) }
        : null;
    }
    case 'addTable': {
      const label = readLocalized(o.label);
      return label && isString(o.page) && isString(o.rows) && optionalString(o.name, 63) && optionalId(o.before)
        ? { op: 'addTable', label, page: o.page, rows: o.rows, ...(o.name !== undefined ? { name: o.name } : {}), ...(o.before !== undefined ? { before: o.before } : {}) }
        : null;
    }
    case 'deleteTable':
      return Number.isInteger(o.id) ? { op: 'deleteTable', id: o.id as number } : null;
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
    case 'expression':
      return isString(o.text, 4000) && (o.whenText === undefined || o.whenText === null || isString(o.whenText, 4000))
        ? { ...base, kind: 'expression', text: o.text, ...(typeof o.whenText === 'string' ? { whenText: o.whenText } : {}) }
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
  const answers = operations.reduce((n, o) => n + (o.op === 'addList' ? o.items.length : o.op === 'addItem' ? 1 : 0), 0);
  if (answers > MAX_NEW_ANSWERS) return `at most ${MAX_NEW_ANSWERS} new answers at once`;
  return operations;
}

function readOperations(body: unknown): { revision: string; operations: SurveyOperation[] } | string {
  const b = (body ?? {}) as Partial<Record<keyof SurveyChangeInput, unknown>>;
  if (!isString(b.revision, 100)) return 'revision is missing';
  const operations = readOperationList(b.operations);
  return typeof operations === 'string' ? operations : { revision: b.revision, operations };
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
  ): Promise<{ status: 409 | 413; body: unknown } | null> {
    const date = new Date();
    const storedOriginal = await store.getOriginalCep(projectId);
    const originalCep = storedOriginal && !storedOriginal.equals(served) ? storedOriginal : null;
    const nextServed = generatedForm(withSurvey(served, next, date), date);
    // The uploaded file's survey that could not be changed stays as it is: never the served one, with the server's fields
    const nextOriginalCep = originalCep ? (nextOriginal ? generatedForm(withSurvey(originalCep, nextOriginal, date), date) : originalCep) : null;
    const over = await checkUploadFits(store, projectId, { kind: 'cep' }, nextServed.length + (nextOriginalCep?.length ?? 0));
    if (over) return { status: 413, body: over };
    // Written only while the project file is still the one the change was made on: of two changes at once, the
    // second is refused as one made on a survey read before
    const written = await store.replaceCep(projectId, served, nextServed, (await store.getRoundInfo(projectId)) ?? roundInfoOf(nextServed), nextOriginalCep, {
      version: { ...kept, createdBy: request.userId ?? null, revisionAfter: revisionOf(next) },
    });
    if (!written) return { status: 409, body: { error: 'stale', reason: 'the survey changed since it was read: read it again' } satisfies SurveyChangeRefusal };
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
    const storedOriginal = await store.getOriginalCep(projectId);
    // A new page gets the same name in the served file and the uploaded one (made from ids, it would differ: the
    // server's fields take ids in one of them), so that the operations naming it reach it in both
    const operations = namedPages(asked.operations, edit, storedOriginal && !storedOriginal.equals(served) ? storedOriginal : null);
    try {
      for (const op of operations) edit.apply(op);
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send(refusalOf(err));
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
    let originalSurvey: Buffer | null = null;
    let nextOriginal: Buffer | null = null;
    /** The changes the uploaded file's survey did not take (what they name is not there) */
    let notInUploaded = 0;
    if (storedOriginal && !storedOriginal.equals(served)) {
      try {
        originalSurvey = surveyOf(readCep(storedOriginal));
        const originalEdit = new SurveyEdit(originalSurvey);
        // The ids differ between the two (the server's fields take some): each operation names its questions by
        // their names there, on both surveys as they are at that point
        const servedEdit = new SurveyEdit(survey);
        for (const op of operations) {
          const there = operationFor(op, servedEdit, originalEdit);
          servedEdit.apply(op);
          if (!there) {
            notInUploaded++;
            continue;
          }
          try {
            originalEdit.apply(there);
          } catch (err) {
            if (!(err instanceof SurveyEditError)) throw err;
            notInUploaded++;
          }
        }
        nextOriginal = originalEdit.bytes();
        if (notInUploaded > 0) request.log.warn({ projectId, notInUploaded }, 'changes the uploaded project file\'s survey did not take');
      } catch (err) {
        if (!(err instanceof XmlTreeError || err instanceof SurveyEditError)) throw err;
        request.log.warn({ err }, 'the uploaded project file\'s survey could not be changed as the served one');
        nextOriginal = null;
        notInUploaded = operations.length;
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
      // Kept in the Activity log: the uploaded file (GET /cep/original) lacks them
      ...(notInUploaded > 0 ? { notInUploaded } : {}),
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
    let survey: Buffer;
    let edit: SurveyEdit;
    try {
      survey = surveyOf(readCep(served));
      edit = new SurveyEdit(survey);
    } catch (err) {
      if (err instanceof XmlTreeError || err instanceof SurveyEditError || err instanceof CepError) {
        return reply.code(409).send({ error: 'unreadable', reason: 'the survey of the project file cannot be read' });
      }
      throw err;
    }
    let after: Buffer;
    try {
      for (const op of operations) edit.apply(op);
      after = edit.bytes();
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send(refusalOf(err));
      throw err;
    }
    const records = await store.listRecordSummaries(projectId);
    // Each change tried on every plot: at most so many tries in one request (one change on 500,000 plots, 250 on 2,000)
    const tried = operations.filter((o) => !CHEAP_IMPACT.has(o.op)).length * records.length;
    if (tried > MAX_IMPACT_TRIES) {
      return reply.code(400).send({ error: 'bad_request', reason: 'too many changes to try on the plots at once: save fewer at a time', code: 'tooMany', values: {} } satisfies SurveyChangeRefusal);
    }
    return surveyImpact(survey, operations, records, after) satisfies SurveyImpactAnswer;
  });

  // A project without a project file starts from a template (stage 5): the survey made, its project file stored as an
  // upload is (acceptCep), so the round, the note and everything an upload gets come with it
  app.post('/v1/projects/:pid/survey/new', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const b = (request.body ?? {}) as Partial<Record<keyof SurveyNewInput, unknown>>;
    const templates: SurveyTemplate[] = ['blank', 'basic', 'multipurpose', 'ipcc'];
    const years = b.years as { first?: unknown; last?: unknown } | undefined;
    if (
      !templates.includes(b.template as SurveyTemplate) ||
      !isString(b.title, 200) ||
      (b.title as string).trim() === '' ||
      typeof b.language !== 'string' ||
      !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(b.language) ||
      (years !== undefined && (!Number.isInteger(years?.first) || !Number.isInteger(years?.last)))
    ) {
      return reply.code(400).send({ error: 'bad_request', reason: 'template, title and language are needed; years as {first, last}' } satisfies SurveyChangeRefusal);
    }
    if (years && !TEMPLATES_WITH_YEARS.includes(b.template as SurveyTemplate)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'only the multipurpose and IPCC templates have years' } satisfies SurveyChangeRefusal);
    }
    if (await store.getCep(projectId)) {
      return reply.code(409).send({ error: 'has_project_file', reason: 'The project has a project file already: change its survey here, or upload another one.' });
    }
    let cep: Buffer;
    try {
      cep = newProjectFile(
        {
          template: b.template as SurveyTemplate,
          title: b.title as string,
          language: b.language,
          projectId,
          ...(years ? { years: { first: years.first as number, last: years.last as number } } : {}),
        },
        new Date(),
      );
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send(refusalOf(err));
      throw err;
    }
    const accepted = await acceptCep(store, projectId, cep, request.log);
    if (!accepted.ok) return reply.code(accepted.status).send(accepted.body);
    await audit(store, request, 'cep.replaced', { bytes: cep.length, template: b.template as string });
    return designAnswer(store, config, projectId, request.log);
  });

  // An expression typed in the designer, checked as Collect checks it from the place of its question (stage 7); nothing
  // is written. The words of a problem are the dashboard's (surveyCheck.<code>)
  app.post('/v1/projects/:pid/survey/check', admin, async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(b.id) || (b.kind !== 'boolean' && b.kind !== 'value') || !isString(b.text, 4000)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'id, kind (boolean or value) and text are needed' } satisfies SurveyChangeRefusal);
    }
    const cep = await store.getCep(request.membership!.projectId);
    if (!cep) return reply.code(404).send({ error: 'not_found' });
    try {
      const verdict = new SurveyEdit(surveyOf(readCep(cep))).checkText(b.id as number, b.kind, b.text);
      return (verdict.ok ? { ok: true } : { ok: false, code: verdict.code, values: verdict.values, beyondCollect: verdict.beyondCollect }) satisfies ExpressionCheckAnswer;
    } catch (err) {
      if (err instanceof SurveyEditError) return reply.code(400).send(refusalOf(err));
      if (err instanceof CepError || err instanceof XmlTreeError) return reply.code(409).send(UNREADABLE);
      throw err;
    }
  });

  // The served survey's revision, for every member (stage 6): Collect Earth compares it with the one it opened, and
  // offers to take the survey again when the coordinator changed it. null without a project file
  app.get('/v1/projects/:pid/survey/revision', { preHandler: requireProjectMembership(store) }, async (request, reply) => {
    const cep = await store.getCep(request.membership!.projectId);
    let revision: string | null = null;
    if (cep) {
      try {
        revision = revisionOf(surveyOf(readCep(cep)));
      } catch {
        revision = null;
      }
    }
    return reply.header('cache-control', 'private, no-cache').send({ revision } satisfies SurveyRevisionAnswer);
  });

  // The plots of an earlier survey: read apart from the design (every record's answers are read), when the page asks
  app.get('/v1/projects/:pid/survey/older', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const served = await store.getCep(projectId);
    if (!served) return { plots: 0, byRevision: 0 } satisfies SurveyOlderAnswer;
    let survey: Buffer;
    try {
      survey = surveyOf(readCep(served));
    } catch (err) {
      if (err instanceof CepError) return reply.code(409).send({ error: 'unreadable', reason: 'the survey of the project file cannot be read' });
      throw err;
    }
    const [records, revisions] = await Promise.all([store.listRecordSummaries(projectId), store.listRecordSurveyRevisions(projectId)]);
    try {
      return olderSurveyPlots(survey, revisionOf(survey), records.filter((r) => !r.deleted), revisions) satisfies SurveyOlderAnswer;
    } catch (err) {
      if (err instanceof XmlTreeError) return reply.code(409).send({ error: 'unreadable', reason: 'the survey of the project file cannot be read' });
      throw err;
    }
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
    let survey: Buffer;
    try {
      survey = surveyOf(readCep(served));
    } catch (err) {
      if (err instanceof CepError) return reply.code(409).send(UNREADABLE);
      throw err;
    }
    if (revisionOf(survey) !== b.revision) {
      return reply.code(409).send({ error: 'stale', reason: 'the survey changed since it was read: read it again' } satisfies SurveyChangeRefusal);
    }
    const storedOriginal = await store.getOriginalCep(projectId);
    let originalSurvey: Buffer | null = null;
    try {
      originalSurvey = storedOriginal && !storedOriginal.equals(served) ? surveyOf(readCep(storedOriginal)) : null;
    } catch (err) {
      if (!(err instanceof CepError)) throw err;
    }
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
