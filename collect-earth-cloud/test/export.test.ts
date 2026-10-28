import { describe, expect, it } from 'vitest';
import { recordsCsv } from '../src/export.js';
import type { RecordRow } from '../src/types.js';

function row(summary: Record<string, string>): RecordRow {
  return {
    projectId: 'p',
    recordKey: '1',
    operator: 'maria',
    modifiedOn: 0,
    receivedAt: 0,
    activelySaved: true,
    step: 0,
    xml: null,
    summary,
    deleted: false,
    deletedOn: null,
  };
}

describe('recordsCsv', () => {
  it('neutralises values a spreadsheet would run as a formula, but keeps numbers', () => {
    const csv = recordsCsv([row({ a: '=HYPERLINK("http://x","y")', b: '+1+1', c: '@SUM(A1)', d: '-70.25', e: '\t=1', f: '-x', g: '1e5' })]);
    const values = csv.split('\r\n')[1];
    expect(values).toBe(`1,maria,true,1970-01-01T00:00:00.000Z,"'=HYPERLINK(""http://x"",""y"")",'+1+1,'@SUM(A1),-70.25,'\t=1,'-x,1e5`);
  });
});
