import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { CepError, readCep, surveyInfo } from '../src/cep.js';
import { cepWith, demoCep, idOnlyCep } from './fixtures/cep.js';

const surveyOf = (cep: Buffer) => {
  const files = readCep(cep);
  return surveyInfo(strFromU8(files.entries.get(files.surveyPath)!));
};

const cepErrorCode = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CepError) return e.code;
    throw e;
  }
  return null;
};

/** A small survey whose root entity has the given children. */
const idm = (children: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<survey lastId="42" xmlns="http://www.openforis.org/idml/3.0" xmlns:ui="http://www.openforis.org/collect/3.0/ui">
  <project>Small</project>
  ${extra}
  <codeLists>
    <list id="5" name="phases">
      <items>
        <item id="6"><code>01</code><label xml:lang="fr">Premier</label><label>First</label>
          <item id="7"><code>011</code><label>Nested</label></item>
        </item>
        <item id="8"><code>2</code><label xml:lang="es">Segunda</label></item>
      </items>
    </list>
    <list id="9" name="external" lookup="table_x" />
  </codeLists>
  <schema>
    <entity id="1" name="plot">
      ${children}
    </entity>
    <entity id="20" name="other" />
  </schema>
</survey>`;

describe('readCep', () => {
  it('finds the survey, balloons and template of the demo, keeping every entry in zip order', () => {
    const cep = demoCep();
    const files = readCep(cep);
    expect(files.surveyPath).toBe('placemark.idm.xml');
    expect(files.balloonPath).toBe('balloon.html');
    expect(files.balloonWebPath).toBe('balloon_web.html');
    expect(files.templatePath).toBe('kml_template.fmt');
    expect(files.entries.has('project_definition.properties')).toBe(true);
    expect([...files.entries.keys()]).toEqual(Object.keys(unzipSync(cep)));
  });

  it('keeps entries whose names look like numbers or object properties, in zip order', () => {
    const files = readCep(
      cepWith([
        ['placemark.idm.xml', idm('')],
        ['2', 'two'],
        ['constructor', 'c'],
        ['prototype', 'p'],
        ['1', 'one'],
      ]),
    );
    expect([...files.entries.keys()]).toEqual(['placemark.idm.xml', '2', 'constructor', 'prototype', '1']);
    expect(strFromU8(files.entries.get('constructor')!)).toBe('c');
  });

  it('refuses a zip with an entry named __proto__, or two entries with the same name', () => {
    expect(
      cepErrorCode(() => readCep(cepWith([['placemark.idm.xml', idm('')], ['__proto__', 'x']]))),
    ).toBe('not_a_zip');
    // Two entries of the same name length, then renamed alike in the zip's bytes.
    const twin = cepWith([['placemark.idm.xml', idm('')], ['aa.txt', 'first'], ['ab.txt', 'second']]);
    const duplicated = Buffer.from(twin.toString('latin1').split('ab.txt').join('aa.txt'), 'latin1');
    expect(cepErrorCode(() => readCep(duplicated))).toBe('not_a_zip');
  });

  it('strips a Windows-style ${project_path}\\ and reads continuation lines and CRLF files', () => {
    const files = readCep(
      cepWith({
        'project_definition.properties':
          '#c\r\nmetadata_file=${project_path}\\\\sur\\\r\n    vey.xml\r\nballoon=${project_path}\\\\b.html\r\n',
        'survey.xml': idm(''),
        'b.html': '<html/>',
      }),
    );
    expect(files.surveyPath).toBe('survey.xml');
    expect(files.balloonPath).toBe('b.html');
  });

  it('reads file locations from project_definition.properties, unescaping \\: and \\\\', () => {
    const files = readCep(
      cepWith({
        'project_definition.properties':
          '#comment\nmetadata_file=${project_path}/my\\:survey.xml\nballoon = ${project_path}/b\\\\x.html\n' +
          'template=${project_path}/missing.fmt\n',
        'my:survey.xml': idm(''),
        'b\\x.html': '<html/>',
        'kml_template.fmt': '<kml/>',
      }),
    );
    expect(files.surveyPath).toBe('my:survey.xml');
    expect(files.balloonPath).toBe('b\\x.html');
    // Named in the properties but missing from the zip: the usual file name is used.
    expect(files.templatePath).toBe('kml_template.fmt');
    expect(files.balloonWebPath).toBeNull();
  });

  it('falls back to the usual file names without a properties file', () => {
    const files = readCep(cepWith({ 'placemark.idm.xml': idm(''), 'balloon.html': '<html/>' }));
    expect(files.surveyPath).toBe('placemark.idm.xml');
    expect(files.balloonPath).toBe('balloon.html');
    expect(files.balloonWebPath).toBeNull();
    expect(files.templatePath).toBeNull();
  });

  it('refuses something that is not a zip', () => {
    expect(cepErrorCode(() => readCep(Buffer.from('just some text', 'utf8')))).toBe('not_a_zip');
  });

  it('refuses a zip without the survey', () => {
    expect(cepErrorCode(() => readCep(cepWith({ 'balloon.html': '<html/>' })))).toBe('no_survey');
  });

  it('names the survey file the properties point to when it is missing', () => {
    const missing = cepWith({ 'project_definition.properties': 'metadata_file=${project_path}/mine.idm.xml\n' });
    expect(() => readCep(missing)).toThrow(/mine\.idm\.xml/);
  });
});

describe('surveyInfo', () => {
  it('reads the demo survey: two keys, its code lists, languages and lastId', () => {
    const info = surveyOf(demoCep());
    expect(info.rootEntity).toBe('plot');
    expect(info.rootEntityCount).toBe(1);
    expect(info.keys).toEqual([
      { name: 'id', type: 'text', list: null },
      { name: 'round', type: 'code', list: 'assessment_phases' },
    ]);
    expect(info.hasNonKeyRound).toBe(false);
    expect(info.codeLists.get('assessment_phases')).toEqual([
      { code: '1', label: 'First assessment' },
      { code: '2', label: 'Re-Assessment' },
    ]);
    expect(info.codeLists.get('years')!.map((i) => i.code).slice(0, 2)).toEqual(['2025', '2024']);
    expect(info.languages).toEqual(['en', 'fr', 'pt', 'es']);
    expect(info.lastId).toBe(2013037);
  });

  it('reads the id-only demo: one key, id', () => {
    const info = surveyOf(idOnlyCep());
    expect(info.keys).toEqual([{ name: 'id', type: 'text', list: null }]);
    expect(info.hasNonKeyRound).toBe(false);
    expect(info.codeLists.has('assessment_phases')).toBe(true);
  });

  it('notices a round attribute that is not a key', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/><code id="3" name="round" list="phases"/>'),
    );
    expect(info.keys).toEqual([{ name: 'id', type: 'text', list: null }]);
    expect(info.hasNonKeyRound).toBe(true);
  });

  it('keeps codes as written, takes the default-language label (else the first), and only top-level items', () => {
    const info = surveyInfo(idm('<text id="2" name="id" key="true"/>'));
    expect(info.codeLists.get('phases')).toEqual([
      { code: '01', label: 'First' },
      { code: '2', label: 'Segunda' },
    ]);
    expect(info.codeLists.get('external')).toEqual([]);
    expect(info.rootEntityCount).toBe(2);
    expect(info.languages).toEqual([]);
    expect(info.lastId).toBe(42);
  });

  it('ignores keys of nested entities', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/><entity id="4" name="lc"><code id="5" name="el" key="true" list="phases"/></entity>'),
    );
    expect(info.keys.map((k) => k.name)).toEqual(['id']);
  });

  it('decodes character references in labels and attribute values', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/>').replace(
        '<label>First</label>',
        '<label>Caf&#233; &#x2019;s &amp; co</label>',
      ).replace('name="phases"', 'name="ph&#228;ses"'),
    );
    expect(info.codeLists.get('phäses')![0].label).toBe('Café ’s & co');
  });

  it('takes the label of the default language when no label is unmarked', () => {
    const info = surveyInfo(
      idm('<text id="2" name="id" key="true"/>', '<language>es</language><language>fr</language>').replace(
        '<label xml:lang="fr">Premier</label><label>First</label>',
        '<label xml:lang="fr">Premier</label><label xml:lang="es">Primero</label>',
      ),
    );
    expect(info.codeLists.get('phases')![0].label).toBe('Primero');
  });

  it('refuses a survey with a DOCTYPE, so no entity of it is ever expanded', () => {
    const withDoctype = idm('<text id="2" name="id" key="true"/>')
      .replace('<survey ', '<!DOCTYPE survey [<!ENTITY boom "EXPANDED">]>\n<survey ')
      .replace('<label>First</label>', '<label>&boom;</label>');
    expect(cepErrorCode(() => surveyInfo(withDoctype))).toBe('survey_unreadable');
  });

  it('refuses XML it cannot read, or a survey without a schema entity', () => {
    expect(cepErrorCode(() => surveyInfo('<foo/>'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('<survey><schema></survey>'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('not xml at all'))).toBe('survey_unreadable');
    expect(cepErrorCode(() => surveyInfo('<survey lastId="1"><schema/></survey>'))).toBe('survey_unreadable');
  });
});

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
