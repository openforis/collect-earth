import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { addRound, CepError, readCep, surveyInfo, zipCep } from '../src/cep.js';
import { cepWith, demoCep, idOnlyCep, realDemoCep } from './fixtures/cep.js';

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

// ---------------------------------------------------------------------------------------
// addRound

const text = (cep: Buffer, path: string) => strFromU8(readCep(cep).entries.get(path)!);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const BALLOON_MARKER = '<!-- START OF EXTRA CSV DATA -->';
const TEMPLATE_MARKER =
  '<!-- DO NOT REMOVE THIS LINE - IT GENERATES THE EXTRA FIELDS FROM THE CSV-BALLOON INTEGRATION -->';
const NS = 'xmlns="http://www.openforis.org/idml/3.0" xmlns:ui="http://www.openforis.org/collect/3.0/ui"';

/** A small id-only survey, in the shape Collect writes. */
const miniIdm = (opts: { lists?: string; children?: string; surveyAttrs?: string; codeLists?: boolean } = {}) => {
  const children =
    opts.children ??
    `<text id="2" name="id" required="true" ui:tab="t1" key="true" type="short">
        <label type="instance">Plot ID</label>
      </text>
      <text id="3" name="notes" ui:tab="t1"/>`;
  const codeLists =
    opts.codeLists === false
      ? ''
      : `
  <codeLists>
    <list id="5" name="colours">
      <items>
        <item id="6"><code>r</code><label>Red</label></item>
      </items>
    </list>${opts.lists ?? ''}
  </codeLists>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<survey ${opts.surveyAttrs ?? `lastId="40" ${NS}`}>
  <project>Small</project>
  <language>en</language>
  <language>es</language>${codeLists}
  <schema>
    <entity id="1" name="plot" ui:tab="plot_tab">
      ${children}
    </entity>
  </schema>
</survey>
`;
};
const miniBalloon = (eol = '\n') =>
  [
    '<html><head><script>',
    "    var EXTRA_ID_ATTRIBUTES = ['collect_text_id'];",
    '</script></head><body>',
    BALLOON_MARKER,
    '<input type="hidden" id="collect_text_id" name="collect_text_id" value="$[EXTRA_id]" class="extra" />',
    '</body></html>',
    '',
  ].join(eol);
const miniTemplate = () =>
  [
    '<kml><ExtendedData>',
    TEMPLATE_MARKER,
    '<Data name="EXTRA_id">',
    '<value>${placemark.idColumns[0]}</value>',
    '</Data>',
    '</ExtendedData></kml>',
    '',
  ].join('\n');

const miniCep = (over: Record<string, string | null> = {}): Buffer => {
  const files: Record<string, string | null> = {
    'placemark.idm.xml': miniIdm(),
    'balloon.html': miniBalloon(),
    'kml_template.fmt': miniTemplate(),
    'grid/plots.csv': 'id,lat,lon\n1,0,0\n',
    ...over,
  };
  return cepWith(Object.entries(files).filter((e): e is [string, string] => e[1] !== null));
};

describe('zipCep', () => {
  it('re-zips the real demo (made by Java) entry for entry, in order, readable by fflate', () => {
    const original = readCep(realDemoCep()).entries;
    const again = zipCep(original);
    const back = unzipSync(again);
    expect(Object.keys(back)).toEqual([...original.keys()]);
    for (const [name, bytes] of original) {
      expect(Buffer.from(back[name]).equals(Buffer.from(bytes)), name).toBe(true);
    }
    // The same entries always give the same bytes.
    expect(zipCep(original).equals(again)).toBe(true);
  });

  it('stores what does not shrink, and keeps empty entries and UTF-8 names', () => {
    const entries = new Map<string, Uint8Array>([
      ['dir/', new Uint8Array()],
      ['dir/ñandú.txt', new Uint8Array(Buffer.from('ñandú'.repeat(50)))],
      ['tiny', new Uint8Array([7])],
    ]);
    const back = readCep(cepWith([['placemark.idm.xml', idm('')], ...[...entries].map(([n, d]): [string, Buffer] => [n, Buffer.from(d)])]));
    for (const [name, bytes] of entries) expect(Buffer.from(back.entries.get(name)!).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('addRound', () => {
  it('adds a hidden round key to the id-only demo, reusing its assessment_phases list', () => {
    const original = idOnlyCep();
    const { cep, info } = addRound(original);
    expect(info).toEqual({
      state: 'added',
      refusal: null,
      keyCount: 2,
      roundIndex: 1,
      roundCodes: [
        { code: '1', label: 'First assessment' },
        { code: '2', label: 'Re-Assessment' },
      ],
      reassessmentCode: '2',
    });
    const survey = surveyOf(cep);
    expect(survey.keys).toEqual([
      { name: 'id', type: 'text', list: null },
      { name: 'round', type: 'code', list: 'assessment_phases' },
    ]);
    expect([...survey.codeLists.keys()].filter((n) => n.startsWith('assessment_phases'))).toEqual([
      'assessment_phases',
    ]);
    expect(survey.lastId).toBe(2013038);

    const idmText = text(cep, 'placemark.idm.xml');
    const roundTag = /<code id="2013038" name="round"[^>]*>/.exec(idmText)![0];
    expect(roundTag).toContain('collectearth:hideinrecordlist="true"');
    expect(roundTag).toContain('collectearth:fromcsv="true"');
    expect(roundTag).toContain('collect:measurement="true"');
    expect(roundTag).toContain('ui:tab="tab_10007"');

    for (const balloon of ['balloon.html', 'balloon_web.html']) {
      const html = text(cep, balloon);
      expect(count(html, 'id="collect_code_round"')).toBe(1);
      expect(html).toMatch(/EXTRA_ID_ATTRIBUTES = \['collect_text_id', 'collect_code_round'\];/);
    }
    expect(count(text(cep, 'kml_template.fmt'), '<Data name="EXTRA_round">')).toBe(1);

    const before = readCep(original).entries;
    const after = readCep(cep).entries;
    expect([...after.keys()]).toEqual([...before.keys()]);
    const changed = ['placemark.idm.xml', 'balloon.html', 'balloon_web.html', 'kml_template.fmt'];
    for (const [name, bytes] of before) {
      if (changed.includes(name)) continue;
      expect(Buffer.from(after.get(name)!).equals(Buffer.from(bytes)), name).toBe(true);
    }
  });

  it('leaves a CEP it has already changed alone: its survey now has its own round', () => {
    const once = addRound(idOnlyCep()).cep;
    const twice = addRound(once);
    expect(twice.info.state).toBe('own');
    expect(twice.cep.equals(once)).toBe(true);
  });

  it('leaves the demo alone: it has its own round, codes 1 and 2', () => {
    const original = demoCep();
    const { cep, info } = addRound(original);
    expect(cep.equals(original)).toBe(true);
    expect(info).toEqual({
      state: 'own',
      refusal: null,
      keyCount: 2,
      roundIndex: 1,
      roundCodes: [
        { code: '1', label: 'First assessment' },
        { code: '2', label: 'Re-Assessment' },
      ],
      reassessmentCode: '2',
    });
  });

  it('an own round without code 2 has no re-assessment code until the coordinator picks one', () => {
    const years = `
    <list id="30" name="years"><items><item id="31"><code>2024</code><label>2024</label></item><item id="32"><code>2025</code><label>2025</label></item></items></list>`;
    const { info } = addRound(
      miniCep({
        'placemark.idm.xml': miniIdm({
          lists: years,
          children: '<code id="4" name="round" key="true" list="years"/><text id="2" name="id" key="true"/>',
        }),
      }),
    );
    expect(info).toMatchObject({ state: 'own', keyCount: 2, roundIndex: 0, reassessmentCode: null });
    expect(info.roundCodes.map((c) => c.code)).toEqual(['2024', '2025']);
  });

  it('adds a new list, assessment_phases_2, when assessment_phases lacks code 2', () => {
    const taken = `
    <list id="30" name="assessment_phases"><items><item id="31"><code>1</code><label>One</label></item></items></list>`;
    const { cep, info } = addRound(miniCep({ 'placemark.idm.xml': miniIdm({ lists: taken }) }));
    expect(info.state).toBe('added');
    expect(info.roundCodes).toEqual([
      { code: '1', label: 'First assessment' },
      { code: '2', label: 'Re-assessment' },
    ]);
    const survey = surveyOf(cep);
    expect(survey.keys[1]).toEqual({ name: 'round', type: 'code', list: 'assessment_phases_2' });
    expect(survey.lastId).toBe(44);
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText).toContain('<code id="41" name="round"');
    expect(idmText).toContain('<list id="42" name="assessment_phases_2">');
    expect(idmText).toContain('<item id="43"><code>1</code>');
    expect(idmText).toContain('<item id="44"><code>2</code>');
    // The survey's own languages: English unmarked, Spanish marked; no French or Portuguese.
    expect(idmText).toContain('<label xml:lang="es">Reevaluaci&#243;n</label>');
    expect(idmText).not.toContain('xml:lang="fr"');
    // The old list is untouched.
    expect(survey.codeLists.get('assessment_phases')).toEqual([{ code: '1', label: 'One' }]);
  });

  it('keeps ids above every id in the survey, and adds the namespaces it uses', () => {
    const { cep } = addRound(miniCep({ 'placemark.idm.xml': miniIdm({ surveyAttrs: `lastId="3" ${NS}` }) }));
    const idmText = text(cep, 'placemark.idm.xml');
    // lastId says 3, but ids up to 6 are in use.
    expect(idmText).toContain('<code id="7" name="round"');
    expect(surveyOf(cep).lastId).toBe(10);
    const surveyTag = /<survey [^>]*>/.exec(idmText)![0];
    expect(surveyTag).toContain('xmlns:collect="http://www.openforis.org/collect/3.0/collect"');
    expect(surveyTag).toContain('xmlns:collectearth="http://www.openforis.org/collect/3.0/collectearth"');
    expect(count(surveyTag, 'xmlns:ui=')).toBe(1);
  });

  it('creates the code lists section when the survey has none, and leaves out ui:tab when id has none', () => {
    const { cep, info } = addRound(
      miniCep({ 'placemark.idm.xml': miniIdm({ codeLists: false, children: '<text id="2" name="id" key="true"/>' }) }),
    );
    expect(info.state).toBe('added');
    const survey = surveyOf(cep);
    expect(survey.codeLists.get('assessment_phases')!.map((c) => c.code)).toEqual(['1', '2']);
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText.indexOf('<codeLists>')).toBeLessThan(idmText.indexOf('<schema>'));
    expect(/<code id="\d+" name="round"[^>]*>/.exec(idmText)![0]).not.toContain('ui:tab');
  });

  it('puts round right after the id key, with its indentation', () => {
    const { cep } = addRound(miniCep());
    const idmText = text(cep, 'placemark.idm.xml');
    expect(idmText).toMatch(
      /<\/text>\n      <code id="41" name="round"[^>]*>\n        <label type="instance">Assessment round<\/label>/,
    );
    expect(idmText.indexOf('name="round"')).toBeLessThan(idmText.indexOf('name="notes"'));
  });

  it("inserts into a CRLF balloon with CRLF only, after the marker", () => {
    const { cep } = addRound(miniCep({ 'balloon.html': miniBalloon('\r\n') }));
    const html = text(cep, 'balloon.html');
    expect(html.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(html).toContain(
      `${BALLOON_MARKER}\r\n<input type="hidden" id="collect_code_round" name="collect_code_round" value="$[EXTRA_round]" class="extra" />\r\n`,
    );
    const template = text(cep, 'kml_template.fmt');
    expect(template).toContain(
      `${TEMPLATE_MARKER}\n<Data name="EXTRA_round">\n<value>\${placemark.idColumns[1]}</value>\n</Data>\n`,
    );
  });

  it('follows the quotes and spacing of EXTRA_ID_ATTRIBUTES', () => {
    const balloon = miniBalloon().replace("['collect_text_id']", '["collect_text_id","collect_text_other"]');
    const { cep } = addRound(miniCep({ 'balloon.html': balloon }));
    expect(text(cep, 'balloon.html')).toContain(
      'EXTRA_ID_ATTRIBUTES = ["collect_text_id","collect_text_other","collect_code_round"]',
    );
  });

  it('puts the template entry after EXTRA_id when the marker is missing', () => {
    const template = miniTemplate().replace(`${TEMPLATE_MARKER}\n`, '');
    const { cep } = addRound(miniCep({ 'kml_template.fmt': template }));
    expect(text(cep, 'kml_template.fmt')).toContain(
      '<value>${placemark.idColumns[0]}</value>\n</Data>\n<Data name="EXTRA_round">\n',
    );
  });

  const idmWith = (children: string) => miniIdm({ children });
  const refusals: Array<[string, () => Buffer]> = [
    ['not_a_zip', () => Buffer.from('plain text')],
    ['no_survey', () => miniCep({ 'placemark.idm.xml': null })],
    ['survey_unreadable', () => miniCep({ 'placemark.idm.xml': '<survey><schema></survey>' })],
    [
      'several_entities',
      () => miniCep({ 'placemark.idm.xml': miniIdm().replace('</schema>', '<entity id="9" name="other"/>\n  </schema>') }),
    ],
    [
      'round_not_key',
      () =>
        miniCep({
          'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><code id="4" name="round" list="colours"/>'),
        }),
    ],
    [
      'several_keys',
      () => miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><text id="4" name="b" key="true"/>') }),
    ],
    ['several_keys', () => miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id"/>') })],
    ['balloon_missing', () => miniCep({ 'balloon.html': null })],
    ['balloon_marker_missing', () => miniCep({ 'balloon.html': miniBalloon().replace(BALLOON_MARKER, '') })],
    [
      'balloon_ids_missing',
      () => miniCep({ 'balloon.html': miniBalloon().replace(/var EXTRA_ID_ATTRIBUTES[^\n]*/, '') }),
    ],
    ['balloon_marker_missing', () => miniCep({ 'balloon_web.html': miniBalloon().replace(BALLOON_MARKER, '') })],
    ['balloon_ids_missing', () => miniCep({ 'balloon_web.html': miniBalloon().replace("'collect_text_id'", '') })],
    ['template_missing', () => miniCep({ 'kml_template.fmt': null })],
    ['template_marker_missing', () => miniCep({ 'kml_template.fmt': '<kml><ExtendedData></ExtendedData></kml>\n' })],
  ];
  for (const [code, make] of refusals) {
    it(`refuses with ${code} and hands back the original bytes`, () => {
      const original = make();
      const { cep, info } = addRound(original);
      expect(info.refusal).toBe(code);
      expect(info.state).toBe('none');
      expect(info.roundIndex).toBeNull();
      expect(info.reassessmentCode).toBeNull();
      expect(info.roundCodes).toEqual([]);
      expect(cep.equals(original)).toBe(true);
    });
  }

  it('reports the keys of a refused survey', () => {
    const { info } = addRound(
      miniCep({ 'placemark.idm.xml': idmWith('<text id="2" name="id" key="true"/><text id="4" name="b" key="true"/>') }),
    );
    expect(info.keyCount).toBe(2);
    expect(addRound(Buffer.from('x')).info.keyCount).toBe(0);
  });
});
