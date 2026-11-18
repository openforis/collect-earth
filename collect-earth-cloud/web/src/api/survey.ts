// The survey designer (docs/plans/2026-11-18-survey-designer.md): the project's survey as the designer shows it.

import type { SurveyChangeInput, SurveyDesignAnswer, SurveyHelpAnswer, SurveyHelpInput, SurveyImpactAnswer, SurveyOperation, SurveyVersionsAnswer } from "../../../src/wire/survey";
import { p, request } from "./transport";

export type {
  ConditionPart,
  ConditionRows,
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
  SurveyOperation,
  SurveyChangeInput,
  SurveyEffect,
  SurveyImpactAnswer,
  NewQuestionType,
  NewItem,
  NewRule,
  NewRuleLimit,
  TotalTest,
  SurveyChangeRefusal,
  SurveyHelpAnswer,
  SurveyHelpInput,
  SuggestedRule,
  SurveyVersionView,
  SurveyVersionsAnswer,
  WordTarget,
} from "../../../src/wire/survey";

/** The project's survey, read-only: its pages, questions, lists, conditions and rules (coordinators). */
export function getSurveyDesign(projectId: string): Promise<SurveyDesignAnswer> {
  return request("GET", `${p(projectId)}/survey/design`);
}

/**
 * Saves changes of the survey's words into the project file (coordinators); answers the survey as it is then.
 * 409 `stale`: the survey changed since it was read; 400 `survey_problems`: what Collect Earth would refuse (details.problems).
 */
export function saveSurveyChanges(projectId: string, input: SurveyChangeInput): Promise<SurveyDesignAnswer> {
  return request("POST", `${p(projectId)}/survey/design`, { json: input });
}

/** The survey's versions kept before each change, newest first. */
export function listSurveyVersions(projectId: string): Promise<SurveyVersionsAnswer> {
  return request("GET", `${p(projectId)}/survey/versions`);
}

/** Brings a kept version of the survey back (the survey of the moment is kept in its turn). */
export function restoreSurveyVersion(projectId: string, versionId: string, revision: string): Promise<SurveyDesignAnswer> {
  return request("POST", `${p(projectId)}/survey/versions/${encodeURIComponent(versionId)}/restore`, { json: { revision } });
}

/** What changes would do to the plots already collected, before they are saved (nothing is written). */
export function getSurveyImpact(projectId: string, operations: SurveyOperation[]): Promise<SurveyImpactAnswer> {
  return request("POST", `${p(projectId)}/survey/design/impact`, { json: { operations } });
}

/** The AI assistant's help with the survey's rules (coordinators, the assistant switched on): nothing is saved. */
export function getSurveyHelp(projectId: string, input: SurveyHelpInput): Promise<SurveyHelpAnswer> {
  return request("POST", `${p(projectId)}/survey/help`, { json: input });
}
