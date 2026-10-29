import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { cepWith, demoCep, idOnlyCep } from './fixtures/cep.js';

describe('test CEP fixtures', () => {
  it('the demo CEP leaves out the survey guide but keeps the survey', () => {
    const files = unzipSync(demoCep());
    expect(files['survey_guide.pdf']).toBeUndefined();
    expect(strFromU8(files['placemark.idm.xml'])).toContain('name="round"');
  });

  it('the id-only CEP has no round key anywhere', () => {
    const files = unzipSync(idOnlyCep());
    const idm = strFromU8(files['placemark.idm.xml']);
    expect(idm).not.toContain('name="round"');
    expect(idm).toContain('name="assessment_phases"');
    for (const balloon of ['balloon.html', 'balloon_web.html']) {
      const html = strFromU8(files[balloon]);
      expect(html).not.toContain('id="collect_code_round"');
      expect(html).not.toContain("'collect_code_round'");
      expect(html).toMatch(/EXTRA_ID_ATTRIBUTES = \['collect_text_id'\];/);
    }
    const template = strFromU8(files['kml_template.fmt']);
    expect(template).not.toContain('EXTRA_round');
    expect(template).toContain('EXTRA_id');
  });

  it('cepWith zips the given entries', () => {
    const files = unzipSync(cepWith({ 'a.txt': 'hello', 'b.bin': Buffer.from([1, 2]) }));
    expect(strFromU8(files['a.txt'])).toBe('hello');
    expect(Array.from(files['b.bin'])).toEqual([1, 2]);
  });
});
