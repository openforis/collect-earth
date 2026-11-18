// The survey designer (docs/plans/2026-11-18-survey-designer.md): the survey of a project as the designer shows it.
// Read-only for now (stage 1): GET /v1/projects/:pid/survey/design.

/** A text in each language it has, by language code ("en", "es"); the survey's default language first */
export type Localized = Record<string, string>;

/** The kinds of question, as the designer names them */
export type QuestionType =
  | 'choice' // one answer from a list
  | 'choices' // several answers from a list
  | 'yesNo'
  | 'integer'
  | 'decimal'
  | 'text'
  | 'memo'
  | 'date'
  // Kept and shown, not offered by the designer
  | 'time'
  | 'range'
  | 'coordinate'
  | 'species'
  | 'file';

export type ConditionTest = 'is' | 'isNot' | 'lt' | 'lte' | 'gt' | 'gte' | 'answered' | 'notAnswered';

/** One row of a condition: a question, a test and a value (a code, a number, yes or no; null for answered) */
export interface ConditionPart {
  question: string;
  test: ConditionTest;
  value: string | number | boolean | null;
}

/**
 * When a question is shown or required, or a rule applies: rows joined by all (and) or any (or); never (Collect
 * Earth's hidden fields); or, for a condition the designer cannot show as rows, the expression as written
 */
export type DesignCondition =
  | { kind: 'all' | 'any'; parts: ConditionPart[] }
  | { kind: 'never' }
  | { kind: 'advanced'; text: string };

/** A limit of a number: a number, another question, or an expression as written */
export type RuleBound = { number: number } | { question: string } | { expression: string };

/** A rule (a check of Collect) on a question's answer */
export type DesignRule = {
  /** error: the answer cannot be saved as it is; warning: it can, after a look */
  flag: 'error' | 'warning';
  message: Localized;
  /** When the rule applies; null: always */
  when: DesignCondition | null;
} & (
  | { kind: 'range'; min: { bound: RuleBound; inclusive: boolean } | null; max: { bound: RuleBound; inclusive: boolean } | null }
  | { kind: 'advanced'; text: string }
);

/** One formula of a calculated value: its value, or its expression, when its condition holds */
export interface Formula {
  value: string | null;
  expression: string | null;
  when: string | null;
}

export interface DesignQuestion {
  kind: 'question';
  /** Collect's id of the node */
  id: number;
  /** The internal name: the column of the exports, what conditions name */
  name: string;
  type: QuestionType;
  label: Localized;
  help: Localized;
  /** The answer list (choice, choices) */
  list: string | null;
  /** A sub-list: the question whose answer picks the items shown */
  parentQuestion: string | null;
  /** Buttons or a list to pick from (choice); null: the form decides */
  layout: 'buttons' | 'dropdown' | null;
  required: 'always' | 'never' | { when: DesignCondition };
  shownWhen: DesignCondition | null;
  rules: DesignRule[];
  /** A key of the plot's record */
  key: boolean;
  /** Filled from the plot file's column of that name */
  fromPlotFile: boolean;
  /** Not shown in the form */
  hidden: boolean;
  /** Filled by the form from other answers: its formulas, first that holds wins */
  formulas: Formula[] | null;
  /** The questions the formulas use */
  uses: string[];
  /** Left out of the exports */
  notExported: boolean;
}

/** A group of questions asked once per item of a list (a table), or once in all (a group) */
export interface DesignTable {
  kind: 'table';
  id: number;
  name: string;
  label: Localized;
  help: Localized;
  /** The rows: one per item of this list; null: rows the interpreter adds */
  rowsList: string | null;
  /** Laid out as a table, or as a block of questions per row */
  layout: 'table' | 'block' | 'group';
  shownWhen: DesignCondition | null;
  columns: DesignQuestion[];
}

export type DesignItem = DesignQuestion | DesignTable;

export interface DesignPage {
  name: string;
  label: Localized;
  items: DesignItem[];
}

export interface DesignListItem {
  code: string;
  label: Localized;
  help: Localized;
  /** The second level (a sub-list's items) */
  items: DesignListItem[];
}

export interface DesignList {
  id: number;
  name: string;
  label: Localized;
  items: DesignListItem[];
  /** Its items come from a table of the server (Collect's lookup), not from the survey */
  external: boolean;
  /** The questions that use it */
  usedBy: string[];
}

export interface SurveyDesign {
  /** The default first */
  languages: string[];
  title: Localized;
  /** The pages and what they ask, as the interpreter meets them */
  pages: DesignPage[];
  /** Values kept from the plot file's columns */
  fromPlotFile: DesignQuestion[];
  /** Hidden values the form fills itself */
  calculated: DesignQuestion[];
  /** The other hidden fields: the plot's keys, the ones Collect Earth fills, hidden questions */
  hidden: DesignQuestion[];
  lists: DesignList[];
  counts: { questions: number; lists: number; conditions: number; rules: number; formulas: number };
}

export interface SurveyDesignAnswer {
  /** null: no project file yet, or a survey the server cannot read (unreadable) */
  design: SurveyDesign | null;
  unreadable: boolean;
}
