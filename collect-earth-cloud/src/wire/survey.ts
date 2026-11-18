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
  /** One of the fields Collect Earth or the server needs (the plot's keys, who and where, the round...): kept */
  fixed: boolean;
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
  /** The other hidden fields: the plot's keys, the ones Collect Earth fills, hidden questions and hidden tables' columns */
  hidden: DesignQuestion[];
  lists: DesignList[];
  counts: { formulas: number };
  /** Every page, in the order of the form, those with no question among them */
  pageOrder: string[];
  /** The pages nothing is on yet: shown while the survey is edited, to put questions on (or delete) */
  emptyPages: Array<{ name: string; label: Localized }>;
}

/** What the survey check finds (src/survey/check.ts): Collect's checks of expressions, Collect Earth's survey rules */
export type SurveyCheckCode =
  | 'syntax'
  | 'unknownFunction'
  | 'argumentCount'
  | 'unknownQuestion'
  | 'unknownField'
  | 'insideField'
  | 'insideQuestion'
  | 'aboveThePlot'
  | 'unknownVariable'
  | 'noPlot'
  | 'rootName'
  | 'missingField'
  | 'fieldKind'
  | 'noKey'
  | 'tooManyKeys'
  | 'listTwice'
  | 'codeTwice'
  | 'questionTwice'
  | 'badName'
  | 'nameSuffix'
  | 'longName'
  | 'nestedTable'
  | 'unknownList';

/** Something Collect or Collect Earth would refuse in a survey */
export interface SurveyProblem {
  /** The node's path ("plot/land_use/lu"), or null for the survey as a whole */
  node: string | null;
  code: SurveyCheckCode;
  /** The names and numbers the problem's words take */
  values: Record<string, string>;
  /** The expression concerned, as written */
  expression: string | null;
  /** Collect's own check lets it through, but the form fails on it */
  beyondCollect: boolean;
}

/** What a text of the survey belongs to */
export type WordTarget =
  | { kind: 'title' }
  | { kind: 'page'; name: string }
  /** A question or a table, by its id */
  | { kind: 'node'; id: number }
  | { kind: 'list'; name: string }
  | { kind: 'item'; list: string; code: string }
  /** A rule's message: the rule's place among the node's rules */
  | { kind: 'rule'; node: number; index: number };

/** A change of the survey designer (stage 2: its words) */
/** The kinds of question the designer adds */
export type NewQuestionType = 'choice' | 'choices' | 'yesNo' | 'integer' | 'decimal' | 'text' | 'memo' | 'date';

/** An answer of a list, as the designer adds it */
export interface NewItem {
  code: string;
  label: Localized;
}

/** A change of the survey designer: its words (stage 2), its pages, questions and lists (stage 3) */
export type SurveyOperation =
  /** A text in a language; "" takes it away (the form shows another language's) */
  | { op: 'setText'; target: WordTarget; part: 'label' | 'help' | 'message'; language: string; text: string }
  | { op: 'addLanguage'; language: string }
  /** A page, before another or last */
  | { op: 'addPage'; label: Localized; before?: string }
  | { op: 'movePage'; name: string; before?: string }
  /** A page nothing is on */
  | { op: 'deletePage'; name: string }
  /**
   * A question on a page (of the plot), or a column of a table, before another question of the same page or table, or
   * last; its name made from its label when not given
   */
  | {
      op: 'addQuestion';
      type: NewQuestionType;
      label: Localized;
      name?: string;
      page?: string;
      table?: number;
      before?: number;
      /** For a choice: the answer list */
      list?: string;
      required?: boolean;
    }
  /** A question moved before another of the same page or table, or last; to another page of the plot */
  | { op: 'moveQuestion'; id: number; page?: string; before?: number }
  /** A question nothing else uses (no condition, rule or formula names it) */
  | { op: 'deleteQuestion'; id: number }
  | { op: 'setRequired'; id: number; required: boolean }
  /** A new answer list, its name made from its label when not given */
  | { op: 'addList'; name?: string; label: Localized; items: NewItem[] }
  /** A list no question uses */
  | { op: 'deleteList'; name: string }
  | { op: 'addItem'; list: string; item: NewItem; before?: string }
  | { op: 'moveItem'; list: string; code: string; before?: string }
  | { op: 'deleteItem'; list: string; code: string };

/** What a change does to the plots already collected (POST /v1/projects/:pid/survey/design/impact) */
export type SurveyEffect =
  /** Questions added: the plots collected have no answer to them, and are not reopened by themselves */
  | { kind: 'newQuestions'; count: number }
  /** A question deleted: its answers stay in the records, but leave the form, the exports and the analysis */
  | { kind: 'questionDeleted'; question: string; answered: number }
  /** An answer deleted: the plots that chose it keep a code that matches nothing */
  | { kind: 'itemDeleted'; list: string; code: string; chosen: number }
  /** A question made required: the plots that have no answer to it are flagged when they are opened again */
  | { kind: 'nowRequired'; question: string; unanswered: number };

export interface SurveyImpactAnswer {
  /** The plots collected so far */
  plots: number;
  effects: SurveyEffect[];
}

/** POST /v1/projects/:pid/survey/design */
export interface SurveyChangeInput {
  /** The revision the changes were made on (SurveyDesignAnswer.revision): another one is 409 */
  revision: string;
  operations: SurveyOperation[];
}

/** POST /v1/projects/:pid/survey/versions/:id/restore */
export interface SurveyRestoreInput {
  revision: string;
}

/** Why a change was refused (400): the operation, or what the survey check found */
export interface SurveyChangeRefusal {
  error: 'bad_request' | 'survey_problems' | 'stale';
  reason: string;
  /** The problems the changes would bring (survey_problems) */
  problems?: SurveyProblem[];
}

/** A version of the survey kept before a change, newest first */
export interface SurveyVersionView {
  id: string;
  /** When the survey stopped being this one */
  createdAt: number;
  /** Who changed it then (null: a deleted account) */
  by: string | null;
  changes: number;
  /** The change was a restore */
  restore: boolean;
}

export interface SurveyVersionsAnswer {
  versions: SurveyVersionView[];
}

export interface SurveyDesignAnswer {
  /** null: no project file yet, or a survey the server cannot read (unreadable) */
  design: SurveyDesign | null;
  unreadable: boolean;
  /** The served survey's revision, which a change names; null without a project file */
  revision: string | null;
  /** The coordinator can change the survey here (not in the dashboard inside Collect Earth) */
  editable: boolean;
  /** People who have the project file already: a change reaches them when they open the project again */
  peopleWithFile: number;
  /** What Collect or Collect Earth would refuse in the survey: none for a survey that opens */
  problems: SurveyProblem[];
}
