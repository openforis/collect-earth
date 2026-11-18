// A scripted stand-in for Gemini, for development only (AI_FAKE=1 with the memory store,
// Task 15; the dashboard's Chrome run in Task 20 uses it). It plays the model's part with
// the real tools: in a report it calls get_agreement, get_differences and
// get_survey_health, then writes a report from what they returned (the question that
// differs most, its plots and the people who assessed them; the question most often left
// empty or answered "other", with its figures), so the run's own checks accept it as they
// would Gemini's.
// Follow-ups and questions read the finding or the report they are given. Its texts are
// in English only and say they come from the test assistant. It never calls the network.
import type { AiCall, AiClient, AiRequest, AiResponse } from './client.js';
import { ANSWER_CHECK_SYSTEM, TOPIC_CHECK_SYSTEM } from './prompts.js';
import { ANSWER_SCHEMA, REPORT_SCHEMA } from './run.js';
import { VIEWS_SCHEMA, type AnalysisStructure } from './analysisViews.js';
import { DESCRIBE_SCHEMA, EXPLAIN_SCHEMA, SUGGEST_SCHEMA, TRANSLATE_SCHEMA, type HelpStructure } from './surveyHelp.js';

export interface FakeClientOptions {
  /** Waited before each answer, so the panel's progress can be seen (0 in tests). */
  delayMs?: number;
}

/** What the fake understands as a free question about data quality. */
const ON_TOPIC = /quality|agree|differ|check|plot|question|answer|collector|person|note|survey|mistake|error|confus|mix|calidad|parcela|qualit|parcelle|qualidade|kalite|parsel|anket/i;
/** ...unless it also asks for something else. */
const OFF_TOPIC = /poem|recipe|code|essay|translat|weather|joke|ignore|story|song/i;

const PREFIX = 'Test assistant (no AI model): ';

interface AgreementQuestion {
  key: string;
  label?: string;
  checks: number;
  agreeing: number;
}
interface HealthQuestion {
  key: string;
  label?: string;
  reasons?: { reason: string }[];
  saysIfEmpty?: number;
  emptyPercent?: number | null;
  answered?: number;
  otherLike?: { plots: number; percentOfAnswered: number | null };
}
interface Difference {
  plot: string;
  firstAssessor?: string;
  answers?: { question: string }[];
}

export function createFakeClient(options: FakeClientOptions = {}): AiClient {
  const delay = options.delayMs ?? 0;
  return {
    async generate(req: AiRequest): Promise<AiResponse> {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const answer = respond(req);
      const out = answer.text ?? JSON.stringify(answer.calls);
      const input = req.system.length + JSON.stringify(req.turns).length + JSON.stringify(req.tools ?? []).length;
      return { text: answer.text, calls: answer.calls, inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(out.length / 4) + 10, blocked: false };
    },
  };
}

function respond(req: AiRequest): { text: string | null; calls: AiCall[] } {
  const json = (v: unknown) => ({ text: JSON.stringify(v), calls: [] });
  if (req.system === TOPIC_CHECK_SYSTEM) {
    const question = firstText(req).replace(/^Question: /, '');
    return json({ on_topic: ON_TOPIC.test(question) && !OFF_TOPIC.test(question) });
  }
  if (req.system === ANSWER_CHECK_SYSTEM) return json({ on_topic: true });
  if (req.responseSchema === REPORT_SCHEMA) return json(report(req));
  if (req.responseSchema === ANSWER_SCHEMA) return json(answer(req));
  if (req.responseSchema === VIEWS_SCHEMA) return json(views(req));
  if (req.responseSchema === DESCRIBE_SCHEMA) return json(describeRule(req));
  if (req.responseSchema === SUGGEST_SCHEMA) return json(suggestRules(req));
  if (req.responseSchema === TRANSLATE_SCHEMA) return json(translate(req));
  if (req.responseSchema === EXPLAIN_SCHEMA) return json(explain(req));
  // The tool loop: call the tools once, then say it is done.
  if (req.turns.some((t) => t.role === 'tool')) return { text: 'I have read what I need.', calls: [] };
  const finding = findingOf(req);
  if (finding && finding.questions.length > 0) {
    return { text: null, calls: [{ id: 'fake-1', name: 'get_confusions', args: { question: finding.questions[0] } }] };
  }
  if (finding) return { text: null, calls: [{ id: 'fake-1', name: 'get_differences', args: { limit: 10 } }] };
  if (firstText(req).includes('The coordinator asks')) return { text: null, calls: [{ id: 'fake-1', name: 'get_agreement', args: {} }] };
  return {
    text: null,
    calls: [
      { id: 'fake-1', name: 'get_agreement', args: {} },
      { id: 'fake-2', name: 'get_differences', args: { limit: 20 } },
      { id: 'fake-3', name: 'get_survey_health', args: {} },
    ],
  };
}

/** Views of the analysis page: the survey's first two code questions, counted and side by side. */
function views(req: AiRequest): { views: unknown[] } {
  const line = firstText(req).split('\n').find((l) => l.startsWith('{')) ?? '{}';
  const structure = (JSON.parse(line) as { survey_structure?: AnalysisStructure }).survey_structure;
  const codes = (structure?.columns ?? []).filter((c) => c.type === 'code' && c.source === 'answer');
  const out: unknown[] = [];
  if (codes[0]) {
    out.push({ title: `${PREFIX}${codes[0].label}`, why: 'How many plots have each answer.', rows: [codes[0].id], columns: [], measures: ['plots'], chart: 'hbars', filters: [], order: 'largest' });
  }
  if (codes[0] && codes[1]) {
    out.push({ title: `${PREFIX}${codes[0].label} by ${codes[1].label}`, why: 'The two questions side by side.', rows: [codes[0].id], columns: [codes[1].id], measures: ['plots'], chart: 'stacked', filters: [], order: 'name' });
  }
  return { views: out };
}

/** The survey designer's help: the structure and the JSON lines of the first turn */
function helpTurn(req: AiRequest): { structure: HelpStructure; lines: string[] } {
  const lines = firstText(req).split('\n');
  const line = lines.find((l) => l.startsWith('{"survey_structure"')) ?? '{}';
  const structure = (JSON.parse(line) as { survey_structure?: HelpStructure }).survey_structure ?? { languages: [], questions: [], lists: [] };
  return { structure, lines };
}

/** A rule from the numbers of the description: a range for a number, a length for a text; else not possible */
function describeRule(req: AiRequest): unknown {
  const { structure, lines } = helpTurn(req);
  const name = /^The question the rule is for: "([^"]+)"/.exec(lines.find((l) => l.startsWith('The question the rule is for')) ?? '')?.[1];
  const description = (JSON.parse(lines.find((l) => l.startsWith('{"description"')) ?? '{"description":""}') as { description: string }).description;
  const q = structure.questions.find((x) => x.name === name);
  const numbers = (description.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const message = `${PREFIX}check the answer`;
  if (q && (q.type === 'integer' || q.type === 'decimal') && numbers.length > 0) {
    const below = /most|under|below|less|max|menos|moins|máximo|en çok/i.test(description);
    const rule =
      numbers.length >= 2
        ? { kind: 'range', flag: 'error', message, min: { number: numbers[0], inclusive: true }, max: { number: numbers[1], inclusive: true } }
        : below
          ? { kind: 'range', flag: 'error', message, max: { number: numbers[0], inclusive: true } }
          : { kind: 'range', flag: 'error', message, min: { number: numbers[0], inclusive: true } };
    return { possible: true, why: `${PREFIX}a range made from the numbers of the description.`, rule };
  }
  if (q && (q.type === 'text' || q.type === 'memo') && numbers.length > 0) {
    return { possible: true, why: `${PREFIX}a length made from the description.`, rule: { kind: 'length', flag: 'error', message, minChars: numbers[0] } };
  }
  return { possible: false, why: `${PREFIX}this cannot be said with the designer's rules.` };
}

/** For questions without rules: a warning against negative numbers, a total of 100 for a table, a length for a text */
function suggestRules(req: AiRequest): unknown {
  const { structure } = helpTurn(req);
  const out: unknown[] = [];
  const tables = new Set<string>();
  for (const q of structure.questions) {
    if (out.length >= 3 || q.calculated || q.fromPlotFile || q.rules) continue;
    if (q.type === 'text' || q.type === 'memo') {
      out.push({ question: q.name, why: `${PREFIX}${q.label} should stay short.`, rule: { kind: 'length', flag: 'warning', message: 'At most 500 characters', maxChars: 500 } });
      continue;
    }
    if (q.type !== 'integer' && q.type !== 'decimal') continue;
    if (q.place !== 'plot' && !tables.has(q.place)) {
      tables.add(q.place);
      out.push({ question: q.name, why: `${PREFIX}the rows of ${q.place} should add up to 100.`, rule: { kind: 'total', flag: 'warning', message: 'The rows add up to more than 100', totalTest: 'atMost', total: 100 } });
    } else {
      out.push({ question: q.name, why: `${PREFIX}${q.label} cannot be negative.`, rule: { kind: 'range', flag: 'warning', message: 'The answer cannot be negative', min: { number: 0, inclusive: true } } });
    }
  }
  return { suggestions: out };
}

function translate(req: AiRequest): unknown {
  const lines = firstText(req).split('\n');
  const to = [...(lines[0] ?? '').replace(/^.*into each of: /, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const text = (JSON.parse(lines[1] ?? '{"text":""}') as { text: string }).text;
  return { translations: to.map((language) => ({ language, text: `[${language}] ${text}` })) };
}

function explain(req: AiRequest): unknown {
  const { structure, lines } = helpTurn(req);
  const expression = (JSON.parse(lines.find((l) => l.startsWith('{"expression"')) ?? '{"expression":""}') as { expression: string }).expression;
  const named = structure.questions.filter((q) => new RegExp(`\\b${q.name}\\b`).test(expression)).map((q) => `${q.label} (${q.name})`);
  return { text: `${PREFIX}it depends on ${named.length > 0 ? named.join(', ') : 'no question of the survey'}.` };
}

function firstText(req: AiRequest): string {
  return req.turns.find((t) => t.role === 'user')?.text ?? '';
}

/** What a tool sent in this conversation (its project_data), by tool name; the last call wins. */
function toolData(req: AiRequest, name: string): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  for (const t of req.turns) {
    for (const r of t.results ?? []) {
      const data = (r.result as { project_data?: unknown } | null)?.project_data;
      if (r.name === name && data && typeof data === 'object') found = data as Record<string, unknown>;
    }
  }
  return found;
}

/** The finding a follow-up is about (pasted as data in its first turn), or null. */
function findingOf(req: AiRequest): { questions: string[]; plots: string[] } | null {
  const text = firstText(req);
  if (!text.startsWith('A finding of')) return null;
  try {
    const f = (JSON.parse(text.split('\n')[1]) as { project_data?: { questions?: unknown; plots?: unknown } }).project_data ?? {};
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { questions: strings(f.questions), plots: strings(f.plots) };
  } catch {
    return { questions: [], plots: [] };
  }
}

function report(req: AiRequest) {
  const agreement = toolData(req, 'get_agreement') ?? {};
  const questions = (Array.isArray(agreement.questions) ? agreement.questions : []) as AgreementQuestion[];
  const differences = (toolData(req, 'get_differences')?.differences ?? []) as Difference[];
  const worst = questions
    .filter((q) => q.checks > 0 && q.agreeing < q.checks)
    .sort((a, b) => a.agreeing / a.checks - b.agreeing / b.checks || b.checks - a.checks)[0];
  const checked = typeof agreement.plotsChecked === 'number' ? agreement.plotsChecked : 0;
  const differing = typeof agreement.plotsDiffering === 'number' ? agreement.plotsDiffering : 0;
  const health = healthFinding(req);
  if (!worst) {
    return {
      summary: `${PREFIX}${checked} plots were checked, and the checks agree with the first assessments on every question.`,
      findings: health ? [health.finding] : [],
      recheckPlots: [],
      surveyChanges: health ? [health.change] : [],
    };
  }
  // Questions are named by their label in texts (as the system instruction asks), the key only in the lists.
  const name = typeof worst.label === 'string' && worst.label !== '' ? worst.label : worst.key;
  const ofWorst = differences.filter((d) => (d.answers ?? []).some((a) => a.question === worst.key));
  const plots = ofWorst.map((d) => d.plot).slice(0, 5);
  const persons = [...new Set(ofWorst.map((d) => d.firstAssessor).filter((p): p is string => typeof p === 'string' && p.length > 0))].slice(0, 2);
  return {
    summary: `${PREFIX}${differing} of ${checked} checked plots have an answer that differs between the first assessment and the check. The question that differs most is ${name}.`,
    findings: [
      {
        title: `Checks often disagree on ${name}`,
        explanation: `${worst.checks - worst.agreeing} of ${worst.checks} checks of this question give another answer than the first assessment.`,
        cause: 'unclear_question',
        questions: [worst.key],
        persons,
        plots,
        suggestedNote: `Before you answer ${name}, read its help text and compare the options with what you see on the plot.`,
      },
      ...(health ? [health.finding] : []),
    ],
    recheckPlots: plots,
    surveyChanges: [
      { question: worst.key, suggestion: 'Say more clearly in the help text how to choose between the options.' },
      ...(health && health.change.question !== worst.key ? [health.change] : []),
    ],
  };
}

/** From get_survey_health: the first question often left empty or answered "other", with its figures. */
function healthFinding(req: AiRequest) {
  const rows = (toolData(req, 'get_survey_health')?.questions ?? []) as HealthQuestion[];
  for (const q of rows) {
    const name = typeof q.label === 'string' && q.label !== '' ? q.label : q.key;
    const reasons = (q.reasons ?? []).map((r) => r.reason);
    let explanation: string | null = null;
    if (reasons.includes('often_empty') && typeof q.emptyPercent === 'number') {
      explanation = `It is left empty on ${q.emptyPercent} % of the ${q.saysIfEmpty} plots that say whether it was.`;
    } else if (reasons.includes('often_other') && q.otherLike && typeof q.otherLike.percentOfAnswered === 'number') {
      explanation = `${q.otherLike.plots} of ${q.answered} plots (${q.otherLike.percentOfAnswered} %) answer it with an option like "other" or "unknown".`;
    }
    if (explanation === null) continue;
    return {
      finding: { title: `${name} may need rewording`, explanation, cause: 'unclear_question', questions: [q.key], persons: [], plots: [], suggestedNote: null },
      change: { question: q.key, suggestion: 'Check whether the options cover what collectors see, and say when the question applies.' },
    };
  }
  return null;
}

function answer(req: AiRequest) {
  const first = firstText(req);
  const finding = findingOf(req);
  if (!finding) {
    return { text: `${PREFIX}the agreement figures were read to answer this question. Look at the findings of the report for the details.`, plots: [], note: null };
  }
  // The question by its label, as get_confusions gave it (the key only when it gave none).
  const confusions = toolData(req, 'get_confusions');
  const question = typeof confusions?.label === 'string' && confusions.label !== '' ? confusions.label : (finding.questions[0] ?? 'this question');
  if (first.includes('Draft a guidance note')) {
    return {
      text: `${PREFIX}a short note can help collectors tell the options apart.`,
      plots: [],
      note: `When you answer ${question}, read the help text first and choose the option that fits most of the plot.`,
    };
  }
  if (first.includes('checked again')) {
    return { text: `${PREFIX}these plots have answers that differ between the first assessment and the check.`, plots: finding.plots, note: null };
  }
  return {
    text: `${PREFIX}this finding is about ${question}. The first assessments and the checks of its plots choose different options, which often means the options are hard to tell apart.`,
    plots: finding.plots,
    note: null,
  };
}
