// The error of a change the survey designer cannot make: its message says why, in plain English (the route sends it),
// and, for the refusals a coordinator can meet (something changed by another one meanwhile, a name taken…), a code
// and values the dashboard words in each language.

import type { SurveyRefusalCode } from '../wire/survey.js';

export class SurveyEditError extends Error {
  constructor(
    message: string,
    readonly code?: SurveyRefusalCode,
    readonly values: Record<string, string> = {},
  ) {
    super(message);
  }
}
