import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { backupReader, javaDouble, readBackup, surveyUriOf } from '../src/collectImport.js';

const fixture = (path: string) => fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(fixture(path), 'utf8')) as Record<string, Record<string, string>>;

// The expected summaries were made by Collect Earth's own code (BalloonInputFieldsUtils.getValuesByHtmlParameters of
// the record Collect's DataUnmarshaller reads, after RecordUpdater.initializeRecord, as CeoRecordsXmlTest does), from
// the same survey and record files, by a small Java program run against collect-core 4.0.110 and collect-earth-core.
describe('the summary of a backup record', () => {
  it('is the one Collect Earth makes, for records the desktop exported', () => {
    const { surveyXml, files } = readBackup(readFileSync(fixture('desktop-xml-export.zip')));
    const expected = json('collect-import/desktop-xml-export.summaries.json');
    const read = backupReader(surveyXml, null);
    expect(files).toHaveLength(Object.keys(expected).length);
    for (const file of files) {
      const record = read(file);
      if ('problem' in record) throw new Error(record.problem);
      expect(record.summary, file.name).toEqual(expected[file.name]);
    }
  });

  it('is the one Collect Earth makes, for every attribute type', () => {
    const surveyXml = readFileSync(fixture('collect-import/types/idml.xml'), 'utf8');
    const expected = json('collect-import/types/summaries.json');
    const read = backupReader(surveyXml, null);
    const names = readdirSync(fixture('collect-import/types/1'));
    expect(names).toHaveLength(3);
    for (const name of names) {
      const record = read({ name: `1/${name}`, step: 1, xml: readFileSync(fixture(`collect-import/types/1/${name}`), 'utf8') });
      if ('problem' in record) throw new Error(record.problem);
      expect(record.summary, name).toEqual(expected[`1/${name}`]);
    }
  });

  it('is the one Collect Earth makes, for the CEO records the desktop reads (CeoRecordsXmlTest checks those summaries)', () => {
    const base = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/ceo/answers/', import.meta.url));
    let compared = 0;
    for (const project of readdirSync(base)) {
      const read = backupReader(readFileSync(`${base}${project}/placemark.idm.xml`, 'utf8'), null);
      for (const name of readdirSync(`${base}${project}`).filter((n) => n.endsWith('.xml') && n !== 'placemark.idm.xml')) {
        const record = read({ name, step: 1, xml: readFileSync(`${base}${project}/${name}`, 'utf8') });
        if ('problem' in record) throw new Error(record.problem);
        expect(record.summary, `${project}/${name}`).toEqual(JSON.parse(readFileSync(`${base}${project}/${name.replace('.xml', '.summary.json')}`, 'utf8')));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('carries the envelope Collect Earth sends: key, operator, submitted, modified, step', () => {
    const surveyXml = readFileSync(fixture('collect-import/types/idml.xml'), 'utf8');
    const record = backupReader(surveyXml, null)({ name: '2/1.xml', step: 2, xml: readFileSync(fixture('collect-import/types/1/1.xml'), 'utf8') });
    expect(record).toMatchObject({ recordKey: 'p1', operator: 'Anna Pérez', activelySaved: true, step: 2, modifiedOn: Date.parse('2026-10-30T14:22:56.362+01:00') });
    expect(surveyUriOf(surveyXml)).toBe('http://www.openforis.org/idm/import_types');
  });

  it('tells a file that is no record of the survey', () => {
    const read = backupReader(readFileSync(fixture('collect-import/types/idml.xml'), 'utf8'), null);
    expect(read({ name: '1/9.xml', step: 1, xml: '<tree><id><value>1</value></id></tree>' })).toEqual({ problem: expect.stringContaining('not a record of this survey') });
    expect(read({ name: '1/9.xml', step: 1, xml: '<plot><id>' })).toEqual({ problem: '1/9.xml: not valid XML' });
    expect(read({ name: '1/9.xml', step: 1, xml: '<plot><operator><value>a</value></operator></plot>' })).toEqual({ problem: expect.stringContaining('empty') });
  });

  it('writes numbers as Java does', () => {
    expect([2015, 0.5, 0.0005, 1e7, 12345678.5, -0.25, 1e-5, 0].map(javaDouble)).toEqual(['2015.0', '0.5', '5.0E-4', '1.0E7', '1.23456785E7', '-0.25', '1.0E-5', '0.0']);
  });
});
