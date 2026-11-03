import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../src/ai/fake.js';
import { ANSWER_SCHEMA, REPORT_SCHEMA } from '../../src/ai/run.js';

const KEY = 'collect_code_land_use_category';
const LABEL = 'Land Use 2025';

function toolTurn(name: string, data: unknown) {
  return { role: 'tool' as const, results: [{ id: 'x', name, result: { project_data: data, note: 'data' } }] };
}

describe('the development fake', () => {
  it('names questions by their label in its report, never by their key', async () => {
    const res = await createFakeClient().generate({
      system: 's',
      turns: [
        { role: 'user', text: 'Review' },
        toolTurn('get_agreement', { plotsChecked: 10, plotsDiffering: 3, questions: [{ label: LABEL, key: KEY, kind: 'choice', checks: 10, agreeing: 7, rate: null }] }),
        toolTurn('get_differences', { differences: [{ plot: 'Plot 1', firstAssessor: 'Person A', answers: [{ question: KEY }] }] }),
      ],
      responseSchema: REPORT_SCHEMA,
      maxOutputTokens: 1000,
    });
    const report = JSON.parse(res.text!);
    expect(report.findings[0].questions).toEqual([KEY]);
    expect(report.surveyChanges[0].question).toBe(KEY);
    const texts = JSON.stringify([report.summary, report.findings[0].title, report.findings[0].explanation, report.findings[0].suggestedNote]);
    expect(texts).toContain(LABEL);
    expect(texts).not.toContain(KEY);
  });

  it('names the question by its label in a follow-up', async () => {
    const res = await createFakeClient().generate({
      system: 's',
      turns: [
        { role: 'user', text: `A finding of this project's quality report:\n${JSON.stringify({ project_data: { questions: [KEY], plots: [] } })}\n\nDraft a guidance note` },
        toolTurn('get_confusions', { label: LABEL, question: KEY, confusions: [] }),
      ],
      responseSchema: ANSWER_SCHEMA,
      maxOutputTokens: 1000,
    });
    const answer = JSON.parse(res.text!);
    expect(answer.note).toContain(LABEL);
    expect(answer.note).not.toContain(KEY);
  });
});
