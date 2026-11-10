// A Collect Earth Online (CEO) project, as CEO's own pages load it (get-project-by-id) and a coordinator saves it
// from their browser (docs/plans/2026-11-09-ceo-bridge.md). Only what the import reads is typed; the shapes are those
// of the 628 public projects read on 10 Nov 2026 (test/fixtures/ceo/).

export type CeoComponent = 'button' | 'input' | 'radiobutton' | 'dropdown';
export type CeoDataType = 'text' | 'number' | 'boolean';

export interface CeoAnswer {
  id: string;
  answer: string;
  color: string | null;
  /** hidden: kept in CEO for reuse, never offered */
  hide: boolean;
  /** an input's single answer: whether the input must be filled */
  required: boolean | null;
}

export interface CeoQuestion {
  id: string;
  question: string;
  /** the export name, on the newest projects only */
  questionLabel: string | null;
  componentType: CeoComponent;
  dataType: CeoDataType;
  answers: CeoAnswer[];
  /** null at the top */
  parentQuestionId: string | null;
  /** the parent's answers that show this question; empty: any answer of the parent */
  parentAnswerIds: string[];
  cardOrder: number | null;
  hideQuestion: boolean;
  /** on the newest projects only; otherwise every question is needed (CEO saves a plot once all are answered) */
  required: boolean | null;
}

export type CeoRule =
  | { id: string; ruleType: 'text-match'; questionId: string; regex: string }
  | { id: string; ruleType: 'numeric-range'; questionId: string; min: number | null; max: number | null }
  | { id: string; ruleType: 'sum-of-answers'; questionIds: string[]; validSum: number }
  | { id: string; ruleType: 'matching-sums'; questionIds1: string[]; questionIds2: string[] }
  | { id: string; ruleType: 'incompatible-answers'; questionId1: string; answerId1: string; questionId2: string; answerId2: string }
  | {
      id: string;
      ruleType: 'multiple-incompatible-answers';
      /** question id -> answer id, all of them together */
      answers: Record<string, string>;
      incompatQuestionId: string;
      incompatAnswerId: string;
    }
  | { id: string; ruleType: string; unknown: true };

export interface CeoProject {
  id: number | null;
  name: string;
  description: string;
  /** `regular`, or `simplified` (collectors draw their samples) */
  type: string;
  learningMaterial: string;
  plotDistribution: string | null;
  plotShape: string | null;
  plotSize: number | null;
  sampleDistribution: string | null;
  samplesPerPlot: number | null;
  allowDrawnSamples: boolean;
  questions: CeoQuestion[];
  rules: CeoRule[];
  /** projectOptions and designSettings as they are, for the report */
  options: Record<string, unknown>;
  designSettings: Record<string, unknown>;
}

/** A file that is no CEO project definition, in words for the coordinator. */
export class CeoImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CeoImportError';
  }
}

const COMPONENTS: readonly string[] = ['button', 'input', 'radiobutton', 'dropdown'];
const DATA_TYPES: readonly string[] = ['text', 'number', 'boolean'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const id = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(id).filter((x) => x !== '') : []);

/** The project file saved from CEO (`get-project-by-id`), read and checked. */
export function readCeoProject(json: string): CeoProject {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CeoImportError('The file is not JSON: save the page CEO shows at get-project-by-id?projectId=… as it is.');
  }
  if (!isObject(raw) || !isObject(raw.surveyQuestions)) {
    throw new CeoImportError('The file is not a Collect Earth Online project: it has no survey questions (surveyQuestions).');
  }
  const questions: CeoQuestion[] = [];
  for (const [key, value] of Object.entries(raw.surveyQuestions)) {
    if (!isObject(value)) continue;
    const answers: CeoAnswer[] = [];
    if (isObject(value.answers)) {
      for (const [aid, a] of Object.entries(value.answers)) {
        if (!isObject(a)) continue;
        answers.push({
          id: aid,
          answer: text(a.answer),
          color: typeof a.color === 'string' ? a.color : null,
          hide: a.hide === true,
          required: typeof a.required === 'boolean' ? a.required : null,
        });
      }
    }
    answers.sort(byId);
    const parent = id(value.parentQuestionId);
    questions.push({
      id: key,
      question: text(value.question).trim(),
      questionLabel: text(value.questionLabel).trim() || null,
      componentType: (COMPONENTS.includes(text(value.componentType)) ? text(value.componentType) : 'button') as CeoComponent,
      dataType: (DATA_TYPES.includes(text(value.dataType)) ? text(value.dataType) : 'text') as CeoDataType,
      answers,
      parentQuestionId: parent === '' || parent === '-1' ? null : parent,
      parentAnswerIds: ids(value.parentAnswerIds),
      cardOrder: num(value.cardOrder),
      hideQuestion: value.hideQuestion === true,
      required: typeof value.required === 'boolean' ? value.required : null,
    });
  }
  questions.sort(byId);
  const rules: CeoRule[] = [];
  for (const r of Array.isArray(raw.surveyRules) ? raw.surveyRules : []) {
    if (isObject(r)) rules.push(readRule(r));
  }
  return {
    id: num(raw.id),
    name: text(raw.name).trim(),
    description: text(raw.description).trim(),
    type: text(raw.type) || 'regular',
    learningMaterial: text(raw.learningMaterial),
    plotDistribution: text(raw.plotDistribution) || null,
    plotShape: text(raw.plotShape) || null,
    plotSize: num(raw.plotSize),
    sampleDistribution: text(raw.sampleDistribution) || null,
    samplesPerPlot: num(raw.samplesPerPlot),
    allowDrawnSamples: raw.allowDrawnSamples === true,
    questions,
    rules,
    options: isObject(raw.projectOptions) ? raw.projectOptions : {},
    designSettings: isObject(raw.designSettings) ? raw.designSettings : {},
  };
}

function readRule(r: Record<string, unknown>): CeoRule {
  const ruleId = id(r.id);
  switch (r.ruleType) {
    case 'text-match':
      return { id: ruleId, ruleType: 'text-match', questionId: id(r.questionId), regex: text(r.regex) };
    case 'numeric-range':
      return { id: ruleId, ruleType: 'numeric-range', questionId: id(r.questionId), min: num(r.min), max: num(r.max) };
    case 'sum-of-answers':
      return { id: ruleId, ruleType: 'sum-of-answers', questionIds: ids(r.questionIds), validSum: num(r.validSum) ?? NaN };
    case 'matching-sums':
      return { id: ruleId, ruleType: 'matching-sums', questionIds1: ids(r.questionIds1), questionIds2: ids(r.questionIds2) };
    case 'incompatible-answers':
      return {
        id: ruleId,
        ruleType: 'incompatible-answers',
        questionId1: id(r.questionId1),
        answerId1: id(r.answerId1),
        questionId2: id(r.questionId2),
        answerId2: id(r.answerId2),
      };
    case 'multiple-incompatible-answers': {
      const answers: Record<string, string> = {};
      if (isObject(r.answers)) for (const [q, a] of Object.entries(r.answers)) answers[q] = id(a);
      return {
        id: ruleId,
        ruleType: 'multiple-incompatible-answers',
        answers,
        incompatQuestionId: id(r.incompatQuestionId),
        incompatAnswerId: id(r.incompatAnswerId),
      };
    }
    default:
      return { id: ruleId, ruleType: text(r.ruleType) || '(none)', unknown: true };
  }
}

/** Ids are numbers written as text: "2" before "10" */
function byId<T extends { id: string }>(a: T, b: T): number {
  const na = Number(a.id);
  const nb = Number(b.id);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.id.localeCompare(b.id);
}
