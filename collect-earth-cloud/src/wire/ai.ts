// The AI assistant's runs as the server sends them: starting one, the list, one run with its result,
// and the server owner's view of its use. The switch (GET/PUT .../ai) is in projectSettings.ts.
// Types only: see README.md in this folder.

/** `views`: the analysis page's views proposed from the survey's structure (src/ai/analysisViews.ts). */
export type AiRunKind = 'report' | 'follow_up' | 'question' | 'views';
export type AiRunStatus = 'running' | 'done' | 'failed' | 'refused';

/** What a follow-up asks of a finding. */
export type FollowUpAction = 'explain' | 'draft_note' | 'recheck';

export type FindingCause = 'unclear_question' | 'overlapping_options' | 'person_habit' | 'number_typing' | 'other';

export interface AiFinding {
  title: string;
  explanation: string;
  cause: FindingCause;
  questions: string[];
  /** Pseudonyms in a stored result; usernames after withRealNames. */
  persons: string[];
  /** Plot names ("Plot 1") in a stored result; plot ids after withRealNames. */
  plots: string[];
  /** A draft guidance note: never names a person. */
  suggestedNote: string | null;
}

/** The result of a report run. */
export interface AiReport {
  summary: string;
  findings: AiFinding[];
  recheckPlots: string[];
  surveyChanges: { question: string; suggestion: string }[];
}

/** The result of a follow-up or a question. */
export interface AiAnswer {
  text: string;
  plots: string[];
  /** A draft guidance note: never names a person. */
  note: string | null;
}

/** What to run: a report, a follow-up on one of a report's findings, or a free question about a report. */
export type AiStart =
  | { kind: 'report' }
  | { kind: 'follow_up'; parentRunId: string; findingIndex: number; action: FollowUpAction }
  | { kind: 'question'; parentRunId: string; question: string };

/** The body of POST /v1/projects/:pid/ai/runs: what to run, in which language (the dashboard's; en when left out). */
export type AiRunStartBody = AiStart & { language?: string };

/** POST /v1/projects/:pid/ai/runs (202): the run started, to be followed with GET .../ai/runs/:id. */
export interface AiRunStarted {
  runId: string;
}

/** A run as listed: who, when, what, and its tokens; never a result, a question or tool arguments. */
export interface AiRunListed {
  id: string;
  kind: AiRunKind;
  status: AiRunStatus;
  startedAt: number;
  finishedAt: number | null;
  /** Username of who started it; null once the account is deleted. */
  startedBy: string | null;
  inputTokens: number;
  outputTokens: number;
  /** inputTokens + outputTokens. */
  tokens: number;
  /** The report a follow-up or a question is about. */
  parentRunId: string | null;
  findingIndex: number | null;
  action: FollowUpAction | null;
  /** Why it failed (blocked, ai_timeout, interrupted...); `off_topic` when refused. */
  errorCode: string | null;
}

/** GET /v1/projects/:pid/ai/runs: the project's runs, newest first (the analysis page's views left out). */
export interface AiRunsAnswer {
  runs: AiRunListed[];
}

/** GET /v1/projects/:pid/ai/runs/:id: one run, its progress, and its result with real names and plot ids. */
export interface AiRunAnswer extends AiRunListed {
  /** The free question asked (questions only), with real names. */
  question: string | null;
  /** The tools used so far, in order. */
  progress: { tools: string[] };
  /**
   * A done run's result: a report for a report, an answer for a follow-up or a question, the
   * proposed views for a views run (the analysis page's); null until it is done or when it failed.
   */
  result: AiReport | AiAnswer | { views: unknown[] } | null;
  /** A failed run: its code and the server's English text. */
  error: { code: string; message: string } | null;
  /** The server's refusal text, in the run's language (refused runs). */
  refusal: string | null;
}

/** A project's (or every project's) use of the assistant this month. */
export interface AiUsageCounts {
  runs: number;
  reports: number;
  followUps: number;
  questions: number;
  failed: number;
  refused: number;
  inputTokens: number;
  outputTokens: number;
  /** inputTokens + outputTokens. */
  tokens: number;
}

/** GET /v1/admin/ai-usage: the assistant's use this calendar month (UTC), per project id only, never a name or content. */
export interface AiUsageAnswer {
  /** YYYY-MM */
  month: string;
  /** The month's start and the next month's (ms). */
  from: number;
  until: number;
  /** The most tokens first. */
  projects: (AiUsageCounts & { projectId: string })[];
  totals: AiUsageCounts;
}
