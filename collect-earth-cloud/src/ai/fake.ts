// A scripted stand-in for Gemini, for development only (AI_FAKE=1 with the memory store,
// Task 15; the dashboard's Chrome run in Task 20 uses it). It plays the model's part with
// the real tools: in a report it calls get_agreement and get_differences, then writes a
// report from what they returned (the question that differs most, its plots and the
// people who assessed them), so the run's own checks accept it as they would Gemini's.
// Follow-ups and questions read the finding or the report they are given. Its texts are
// in English only and say they come from the test assistant. It never calls the network.
import type { AiCall, AiClient, AiRequest, AiResponse } from './client.js';
import { ANSWER_CHECK_SYSTEM, TOPIC_CHECK_SYSTEM } from './prompts.js';
import { ANSWER_SCHEMA, REPORT_SCHEMA } from './run.js';

export interface FakeClientOptions {
  /** Waited before each answer, so the panel's progress can be seen (0 in tests). */
  delayMs?: number;
}

/** What the fake understands as a free question about data quality. */
const ON_TOPIC = /quality|agree|differ|check|plot|question|answer|collector|person|note|survey|mistake|error|confus|mix|calidad|parcela|qualit|parcelle|qualidade/i;
/** ...unless it also asks for something else. */
const OFF_TOPIC = /poem|recipe|code|essay|translat|weather|joke|ignore|story|song/i;

const PREFIX = 'Test assistant (no AI model): ';

interface AgreementQuestion {
  key: string;
  label?: string;
  checks: number;
  agreeing: number;
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
    ],
  };
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
  if (!worst) {
    return {
      summary: `${PREFIX}${checked} plots were checked, and the checks agree with the first assessments on every question.`,
      findings: [],
      recheckPlots: [],
      surveyChanges: [],
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
    ],
    recheckPlots: plots,
    surveyChanges: [{ question: worst.key, suggestion: 'Say more clearly in the help text how to choose between the options.' }],
  };
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
