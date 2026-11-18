// The survey designer (docs/plans/2026-11-18-survey-designer.md): the project's survey as the designer shows it.

import type { SurveyDesignAnswer } from "../../../src/wire/survey";
import { p, request } from "./transport";

export type {
  ConditionPart,
  ConditionTest,
  DesignCondition,
  DesignItem,
  DesignList,
  DesignListItem,
  DesignPage,
  DesignQuestion,
  DesignRule,
  DesignTable,
  Formula,
  Localized,
  QuestionType,
  RuleBound,
  SurveyDesign,
  SurveyDesignAnswer,
  SurveyCheckCode,
  SurveyProblem,
} from "../../../src/wire/survey";

/** The project's survey, read-only: its pages, questions, lists, conditions and rules (coordinators). */
export function getSurveyDesign(projectId: string): Promise<SurveyDesignAnswer> {
  return request("GET", `${p(projectId)}/survey/design`);
}
