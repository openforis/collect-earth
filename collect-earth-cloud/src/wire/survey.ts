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

/** A condition as the designer's builder makes it: rows joined by all (and) or any (or) */
export interface ConditionRows {
  kind: 'all' | 'any';
  parts: ConditionPart[];
}

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
  /** A text's number of characters, at least and at most */
  | { kind: 'length'; min: number | null; max: number | null }
  /** A table's column adds up to at least, at most or exactly a number (written on the column) */
  | { kind: 'total'; test: TotalTest; total: number }
  /** expression: the text is a check's expression (changed as text); else another of Collect's checks, as written */
  | { kind: 'advanced'; text: string; expression: boolean }
);

export type TotalTest = 'atLeast' | 'atMost' | 'exactly';

/** A limit of a number in a rule the builder makes: a number or another question */
export interface NewRuleLimit {
  bound: { number: number } | { question: string };
  inclusive: boolean;
}

/** A rule as the builder makes it: the server writes Collect's check from it */
export type NewRule = {
  flag: 'error' | 'warning';
  /** In the languages given; another language's message stays when the rule is changed */
  message: Localized;
  when: ConditionRows | null;
} & (
  | { kind: 'range'; min: NewRuleLimit | null; max: NewRuleLimit | null }
  | { kind: 'length'; min: number | null; max: number | null }
  | { kind: 'total'; test: TotalTest; total: number }
  /**
   * Written as an expression of Collect's language (stage 7): the answer passes when it is true; `whenText`, its
   * condition written so too (else `when`'s rows)
   */
  | { kind: 'expression'; text: string; whenText?: string | null }
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
  /** The questions whose condition, rule or formula names this answer: it is deleted once they no longer do */
  usedBy: string[];
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
  /** deletable: nothing names the page (no hidden field either); the others hold hidden fields and stay */
  emptyPages: Array<{ name: string; label: Localized; deletable: boolean }>;
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

/** The kinds of question the designer adds */
export type NewQuestionType = 'choice' | 'choices' | 'yesNo' | 'integer' | 'decimal' | 'text' | 'memo' | 'date';

/** An answer of a list, as the designer adds it */
export interface NewItem {
  code: string;
  label: Localized;
}

/** A change of the survey designer: its words (stage 2), its pages, questions and lists (stage 3), its logic (stage 4) */
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
      /** A sub-list: the choice of the same page or table whose answer's sub-answers it offers (its list is that one's) */
      parent?: string;
      required?: boolean;
    }
  /** A question moved before another of the same page or table, or last; to another page of the plot */
  | { op: 'moveQuestion'; id: number; page?: string; before?: number }
  /** A question nothing else uses (no condition, rule or formula names it) */
  | { op: 'deleteQuestion'; id: number }
  /** Required always (true), never (false), or when the rows hold */
  | { op: 'setRequired'; id: number; required: boolean | ConditionRows }
  /** When a question or table is shown: null, always */
  | { op: 'setShownWhen'; id: number; when: ConditionRows | null }
  /** A rule of a question, after its others */
  | { op: 'addRule'; id: number; rule: NewRule }
  /** A rule of a question replaced: its place among the question's rules */
  | { op: 'setRule'; id: number; index: number; rule: NewRule }
  | { op: 'deleteRule'; id: number; index: number }
  /** A question's or table's show-when, or a question's required-when, written as an expression (stage 7); null takes it away */
  | { op: 'setExpression'; id: number; part: 'shownWhen' | 'required'; text: string | null }
  /** A calculated value's formulas, the first that holds giving its value (stage 7) */
  | { op: 'setFormulas'; id: number; formulas: NewFormula[] }
  /** A new answer list, its name made from its label when not given */
  | { op: 'addList'; name?: string; label: Localized; items: NewItem[] }
  /** A list no question uses */
  | { op: 'deleteList'; name: string }
  /** An answer, last of the list's first level or of the answers under another (`under`), or before one of its level */
  | { op: 'addItem'; list: string; item: NewItem; before?: string; under?: string }
  /**
   * A table on a page: one row per answer of the list `rows`, which is the row's key; its columns are added after,
   * as questions of the table
   */
  | { op: 'addTable'; label: Localized; page: string; rows: string; name?: string; before?: number }
  /** A table nothing outside it uses, with its columns */
  | { op: 'deleteTable'; id: number }
  | { op: 'moveItem'; list: string; code: string; before?: string }
  | { op: 'deleteItem'; list: string; code: string };

/** What a change does to the plots already collected (POST /v1/projects/:pid/survey/design/impact) */
export type SurveyEffect =
  /** Questions added: the plots collected have no answer to them, and are not reopened by themselves */
  | { kind: 'newQuestions'; count: number }
  /** A question deleted: its answers leave the form, the exports and the analysis, and Collect Earth drops them from a plot the next time it is saved */
  | { kind: 'questionDeleted'; question: string; answered: number }
  /** A table deleted: the plots with an answer in one of its rows */
  | { kind: 'tableDeleted'; table: string; answered: number }
  /** An answer deleted: the plots that chose it keep a code that matches nothing */
  | { kind: 'itemDeleted'; list: string; code: string; chosen: number }
  /** A question made required: the plots that have no answer to it are flagged when they are opened again */
  | { kind: 'nowRequired'; question: string; unanswered: number }
  /**
   * A rule added or changed, tried on the plots collected: those it would flag (the first of them in examples), of
   * those where it applies (an answer, the question shown, the rule's condition holding)
   */
  | { kind: 'ruleFlags'; question: string; flagged: number; checked: number; examples: string[] }
  /** A question or table shown under a new condition: plots with an answer to it where it would now be hidden */
  | { kind: 'hiddenAnswers'; question: string; answered: number };

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
  /**
   * The coordinator can change the survey here (not in the dashboard inside Collect Earth); without a project file,
   * start one from a template (POST /v1/projects/:pid/survey/new)
   */
  editable: boolean;
  /** People who have the project file already: Collect Earth 2.0 offers them a change within ten minutes */
  peopleWithFile: number;
  /**
   * Plots last saved with an earlier version of the survey (as Collect Earth 2.0 says; older ones do not): their
   * answers follow the survey of then
   */
  olderSurveyPlots: number;
  /** What Collect or Collect Earth would refuse in the survey: none for a survey that opens */
  problems: SurveyProblem[];
}

/**
 * POST /v1/projects/:pid/survey/help: the AI assistant's help with the survey's rules (stage 4b). `language`: the
 * dashboard's, for the explanations; `surveyLanguage`: the survey's language the messages are written in.
 */
export type SurveyHelpInput =
  /** A rule of a question described in the coordinator's words */
  | { task: 'describe'; question: number; text: string; language: string; surveyLanguage: string }
  /** Rules the survey lacks */
  | { task: 'suggest'; language: string; surveyLanguage: string }
  /** A text of the survey (a rule's message) in other languages of the survey */
  | { task: 'translate'; text: string; from: string; to: string[]; language: string }
  /** A question's advanced condition (shown when, required when), rule or formula, in plain words */
  | { task: 'explain'; question: number; which: 'shownWhen' | 'required' | 'rule' | 'formula'; index?: number; language: string };

/** A rule the assistant proposes, checked as a coordinator's and tried on the plots collected */
export interface SuggestedRule {
  question: number;
  questionName: string;
  rule: NewRule;
  why: string;
  /** The plots collected it would flag, of those where it applies */
  flagged: number;
  checked: number;
}

export type SurveyHelpAnswer =
  /** rule null: the request cannot be said with the designer's rules, or the assistant's rule did not pass the checks */
  | { task: 'describe'; rule: NewRule | null; why: string; flagged: number; checked: number }
  | { task: 'suggest'; suggestions: SuggestedRule[] }
  | { task: 'translate'; translations: Record<string, string> }
  | { task: 'explain'; text: string };

/** The surveys a new project can start from: Collect's Collect Earth templates, or a blank one */
export type SurveyTemplate = 'blank' | 'basic' | 'multipurpose' | 'ipcc';

/** POST /v1/projects/:pid/survey/new: a project without a project file starts from a template */
export interface SurveyNewInput {
  template: SurveyTemplate;
  title: string;
  /** The language the coordinator writes the survey in */
  language: string;
  /** multipurpose and ipcc: the list of years, from the first to the last */
  years?: { first: number; last: number };
}

/**
 * GET /v1/projects/:pid/survey/revision (any member): the served survey's revision, the one a change names; Collect
 * Earth compares it with the survey it opened. null without a project file.
 */
export interface SurveyRevisionAnswer {
  revision: string | null;
}

/** A formula of a calculated value: its value (a code, a number, a text) or expression, when its condition holds */
export interface NewFormula {
  /** An expression of Collect's language giving the value; or `value`, a value as it is */
  expression?: string;
  value?: string;
  /** The condition, written as an expression; none: always */
  when?: string;
}

/** POST /v1/projects/:pid/survey/check: an expression typed in the designer, checked as Collect checks it */
export interface ExpressionCheckInput {
  /** The question or table it belongs to (its place decides which questions it reaches) */
  id: number;
  /** boolean: a condition or a rule; value: a formula */
  kind: 'boolean' | 'value';
  text: string;
}

export type ExpressionCheckAnswer = { ok: true } | { ok: false; code: SurveyCheckCode; values: Record<string, string>; beyondCollect: boolean };
