import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { CepError } from '../src/cep.js';
import { BOOKKEEPING_KEYS, surveyOutline } from '../src/surveyOutline.js';
import { demoCep } from './fixtures/cep.js';

const demoSurvey = () => strFromU8(unzipSync(demoCep())['placemark.idm.xml']);

/** A small survey with one attribute of each kind, a single entity and two multiple ones. */
const SURVEY = `<?xml version="1.0" encoding="UTF-8"?>
<survey xmlns="http://www.openforis.org/idml/3.0" xmlns:collect="http://www.openforis.org/collect/3.0/collect"
  xmlns:collectearth="http://www.openforis.org/collect/3.0/collectearth" lastId="100">
  <language>en</language>
  <language>es</language>
  <codeLists>
    <list id="1" name="uses">
      <items>
        <item id="2"><code>F</code><label xml:lang="es">Bosque</label><label>Forest</label>
          <item id="3"><code>FP</code><label>Plantation</label></item>
        </item>
        <item id="4"><code>G</code><label>Grassland</label>
          <item id="5"><code>GM</code><label>Meadow</label></item>
        </item>
      </items>
    </list>
    <list id="9" name="lookup_list" lookup="ofc_sampling_design"/>
    <list id="6" name="covers">
      <items>
        <item id="7"><code>trees</code><label>Trees</label></item>
        <item id="8"><code>grass</code><label>Grass</label></item>
      </items>
    </list>
  </codeLists>
  <schema>
    <entity id="10" name="plot">
      <label type="instance">Plot</label>
      <text id="11" name="id" key="true"><label type="instance">Plot id</label></text>
      <code id="12" name="round" key="true" list="phases"/>
      <text id="13" name="operator"/>
      <text id="40" name="operator_notes"/>
      <boolean id="42" name="actively_saved"/>
      <date id="43" name="actively_saved_on"/>
      <text id="44" name="plot_file"/>
      <code id="14" name="land_use" list="uses">
        <label type="instance" xml:lang="es">Uso</label>
        <label type="instance">Land use</label>
        <label type="reporting">LU</label>
        <description xml:lang="es">Elija el uso</description>
        <description>Pick the &#8220;main&#8221; use</description>
      </code>
      <code id="15" name="sub_use" list="uses" parent="land_use"><label type="reporting">Sub use</label></code>
      <code id="16" name="other_uses" list="uses" multiple="true"><label>Other uses</label></code>
      <boolean id="17" name="changed"/>
      <number id="18" name="trees" type="integer"/>
      <number id="19" name="height" type="real" calculated="true"/>
      <number id="20" name="area"/>
      <range id="21" name="age" type="integer"/>
      <range id="22" name="depth"/>
      <coordinate id="23" name="location"/>
      <date id="24" name="seen_on"/>
      <time id="25" name="seen_at"/>
      <taxon id="26" name="species"/>
      <file id="27" name="photo"/>
      <text id="28" name="notes" type="memo"/>
      <number id="29" name="elevation" type="integer" collectearth:fromcsv="true"/>
      <entity id="30" name="stand">
        <label type="instance">Stand</label>
        <number id="31" name="age" type="integer"><label type="instance">Age</label></number>
        <entity id="32" name="deeper"><text id="33" name="x"/></entity>
      </entity>
      <entity id="34" name="cover" multiple="true">
        <label type="instance">Cover</label>
        <code id="35" name="element" key="true" list="covers"/>
        <number id="36" name="pct" type="real"><label type="instance">Percent</label></number>
      </entity>
      <entity id="45" name="patch" multiple="true" collect:enumerate="true">
        <text id="46" name="label" key="true"/>
        <code id="47" name="kind" key="true" list="covers"/>
      </entity>
      <entity id="48" name="sample" multiple="true" collect:enumerate="true">
        <code id="49" name="source" key="true" list="lookup_list"/>
      </entity>
      <entity id="37" name="tree" multiple="true">
        <label type="instance">Tree</label>
        <number id="38" name="height" type="real"><label type="instance">Height</label></number>
      </entity>
    </entity>
  </schema>
</survey>`;

describe('surveyOutline: summary keys, as BalloonInputFieldsUtils.getValuesByHtmlParameters names them', () => {
  const outline = surveyOutline(SURVEY);

  // [summary key, kind, excluded]
  const table: Array<[string, string, boolean]> = [
    ['collect_text_id', 'text', true], // a key
    ['collect_code_round', 'choice', true], // a key
    ['collect_text_operator', 'text', true], // bookkeeping (EarthConstants)
    ['collect_text_operator_notes', 'text', false], // not bookkeeping, whatever its name
    ['collect_boolean_actively_saved', 'choice', true], // bookkeeping
    ['collect_date_actively_saved_on', 'other', true], // bookkeeping
    ['collect_text_plot_file', 'text', true], // bookkeeping
    ['collect_code_land_use', 'choice', false],
    ['collect_code_sub_use', 'choice', false],
    ['collect_code_other_uses', 'choice', false], // multiple: values joined by "==="
    ['collect_boolean_changed', 'choice', false],
    ['collect_integer_trees', 'number', false], // <number type="integer">
    ['collect_real_height', 'number', false], // <number type="real">
    ['collect_real_area', 'number', false], // <number> without a type is real
    ['collect_integer_range_age', 'other', false],
    ['collect_real_range_depth', 'other', false], // <range> without a type is real
    ['collect_coord_location', 'other', true], // bookkeeping: the plot's centre, set by the app
    ['collect_date_seen_on', 'other', false],
    ['collect_time_seen_at', 'other', false],
    ['collect_text_notes', 'text', false],
    ['collect_integer_elevation', 'number', true], // from the plot file (collectearth:fromcsv)
    ['collect_entity_stand.integer_age', 'number', false], // single entity
    ['collect_entity_cover[trees].code_element', 'choice', true], // key of an enumerated entity
    ['collect_entity_cover[trees].real_pct', 'number', false], // first key a code: [code of the key]
    ['collect_entity_cover[grass].code_element', 'choice', true],
    ['collect_entity_cover[grass].real_pct', 'number', false],
    ['collect_entity_patch[1].text_label', 'text', true], // first key a text: [1..10]
    ['collect_entity_patch[1].code_kind', 'choice', true],
    ['collect_entity_sample[1].code_source', 'choice', true], // key list external (lookup): [1..10]
    ['collect_entity_tree[1].real_height', 'number', false], // no key: [1..10]
    ['collect_entity_tree[10].real_height', 'number', false],
  ];

  it.each(table)('%s is %s (excluded: %s)', (key, kind, excluded) => {
    const q = outline.get(key);
    expect(q, key).toBeDefined();
    expect(q!.key).toBe(key);
    expect(q!.kind).toBe(kind);
    expect(q!.excluded).toBe(excluded);
  });

  it('has exactly the keys of the table: taxon, file and entities inside entities have none', () => {
    const expected = new Set(table.map(([k]) => k));
    for (let i = 2; i <= 9; i++) {
      expected.add(`collect_entity_tree[${i}].real_height`);
      expected.add(`collect_entity_patch[${i}].text_label`).add(`collect_entity_patch[${i}].code_kind`);
      expected.add(`collect_entity_sample[${i}].code_source`);
    }
    expected.add('collect_entity_patch[10].text_label').add('collect_entity_patch[10].code_kind');
    expected.add('collect_entity_sample[10].code_source');
    expect(new Set(outline.keys())).toEqual(expected);
  });

  it('keeps the order of the survey', () => {
    expect([...outline.keys()].slice(0, 4)).toEqual([
      'collect_text_id',
      'collect_code_round',
      'collect_text_operator',
      'collect_text_operator_notes',
    ]);
  });

  it('labels: the instance label in the default language, else the reporting one, else the name', () => {
    expect(outline.get('collect_code_land_use')!.label).toBe('Land use');
    expect(outline.get('collect_code_sub_use')!.label).toBe('Sub use');
    expect(outline.get('collect_code_other_uses')!.label).toBe('Other uses');
    expect(outline.get('collect_boolean_changed')!.label).toBe('changed');
  });

  it('labels of entity questions name the entity, and the enumerated item or the index', () => {
    expect(outline.get('collect_entity_stand.integer_age')!.label).toBe('Stand: Age');
    expect(outline.get('collect_entity_cover[grass].real_pct')!.label).toBe('Cover (Grass): Percent');
    expect(outline.get('collect_entity_tree[2].real_height')!.label).toBe('Tree 2: Height');
  });

  it('help is the description in the default language, with character references decoded', () => {
    expect(outline.get('collect_code_land_use')!.help).toBe('Pick the “main” use');
    expect(outline.get('collect_code_sub_use')!.help).toBeNull();
  });

  it('options: the code list items at the level of the attribute, true/false for a boolean', () => {
    expect(outline.get('collect_code_land_use')!.options).toEqual([
      { code: 'F', label: 'Forest' },
      { code: 'G', label: 'Grassland' },
    ]);
    expect(outline.get('collect_code_sub_use')!.options).toEqual([
      { code: 'FP', label: 'Plantation' },
      { code: 'GM', label: 'Meadow' },
    ]);
    expect(outline.get('collect_code_round')!.options).toEqual([]); // the list does not exist
    expect(outline.get('collect_boolean_changed')!.options).toEqual([
      { code: 'true', label: 'Yes' },
      { code: 'false', label: 'No' },
    ]);
    expect(outline.get('collect_integer_trees')!.options).toBeNull();
    expect(outline.get('collect_text_notes')!.options).toBeNull();
  });

  it("optionLabels: an option's labels in the survey's other languages, by code, only when there are some", () => {
    expect(outline.get('collect_code_land_use')!.optionLabels).toEqual({ F: ['Bosque'] });
    expect(outline.get('collect_code_other_uses')!.optionLabels).toEqual({ F: ['Bosque'] });
    expect(outline.get('collect_code_sub_use')!.optionLabels).toBeUndefined();
    expect(outline.get('collect_boolean_changed')!.optionLabels).toBeUndefined();
  });

  it('multiple and calculated', () => {
    expect(outline.get('collect_code_other_uses')!.multiple).toBe(true);
    expect(outline.get('collect_code_land_use')!.multiple).toBe(false);
    expect(outline.get('collect_real_height')!.calculated).toBe(true);
    expect(outline.get('collect_integer_trees')!.calculated).toBe(false);
  });

  it('conditional: relevant or requiredIf on the attribute or on the entity holding it', () => {
    const survey = SURVEY.replace('<number id="18" name="trees" type="integer"/>', '<number id="18" name="trees" type="integer" relevant="changed"/>')
      .replace('<number id="20" name="area"/>', '<number id="20" name="area" requiredIf="changed"/>')
      .replace('<entity id="30" name="stand">', '<entity id="30" name="stand" relevant="changed">');
    const o = surveyOutline(survey);
    expect(o.get('collect_integer_trees')!.conditional).toBe(true);
    expect(o.get('collect_real_area')!.conditional).toBe(true);
    expect(o.get('collect_entity_stand.integer_age')!.conditional).toBe(true);
    expect(o.get('collect_code_land_use')!.conditional).toBeUndefined();
    expect(o.get('collect_entity_cover[trees].real_pct')!.conditional).toBeUndefined();
  });

  it('required: only a root attribute required without condition (required="true" or minCount 1, no relevant, no requiredIf)', () => {
    const survey = SURVEY.replace('<boolean id="17" name="changed"/>', '<boolean id="17" name="changed" required="true"/>')
      .replace('<number id="18" name="trees" type="integer"/>', '<number id="18" name="trees" type="integer" required="true" relevant="changed"/>')
      .replace('<number id="20" name="area"/>', '<number id="20" name="area" requiredIf="changed"/>')
      .replace('<code id="16" name="other_uses" list="uses" multiple="true">', '<code id="16" name="other_uses" list="uses" multiple="true" minCount="1">')
      .replace('<number id="19" name="height" type="real" calculated="true"/>', '<number id="19" name="height" type="real" calculated="true" required="true"/>')
      .replace('<text id="28" name="notes" type="memo"/>', '<text id="28" name="notes" type="memo" required="false"/>')
      .replace('<number id="31" name="age" type="integer">', '<number id="31" name="age" type="integer" required="true">');
    const o = surveyOutline(survey);
    expect(o.get('collect_boolean_changed')!.required).toBe(true);
    expect(o.get('collect_code_other_uses')!.required).toBe(true);
    // Shown only under a condition, or required under one: cannot be judged on the server.
    expect(o.get('collect_integer_trees')!.required).toBe(false);
    expect(o.get('collect_real_area')!.required).toBe(false);
    // Calculated by Collect, written false, keys, and entity children (blanks are left out of the summary).
    expect(o.get('collect_real_height')!.required).toBe(false);
    expect(o.get('collect_text_notes')!.required).toBe(false);
    expect(o.get('collect_text_id')!.required).toBe(false);
    expect(o.get('collect_entity_stand.integer_age')!.required).toBe(false);
    expect(o.get('collect_code_land_use')!.required).toBe(false);
  });

  it('excludes a root attribute named round even when it is not a key, whatever its type', () => {
    const own = surveyOutline(SURVEY.replace('<code id="12" name="round" key="true" list="phases"/>', '<text id="12" name="round"/>'));
    expect(own.get('collect_text_round')!.excluded).toBe(true);
    // ...but not an entity child named round.
    const child = surveyOutline(SURVEY.replace('<number id="31" name="age"', '<number id="31" name="round"'));
    expect(child.get('collect_entity_stand.integer_round')!.excluded).toBe(false);
  });

  it('exports the exact bookkeeping keys the desktop app adds', () => {
    expect([...BOOKKEEPING_KEYS].sort()).toEqual([
      'collect_boolean_actively_saved',
      'collect_coord_location',
      'collect_date_actively_saved_on',
      'collect_text_actively_saved_on',
      'collect_text_operator',
      'collect_text_plot_file',
    ]);
  });

  it('refuses a DOCTYPE, like surveyInfo', () => {
    const evil = SURVEY.replace('<survey ', '<!DOCTYPE survey [<!ENTITY x "y">]>\n<survey ');
    expect(() => surveyOutline(evil)).toThrow(CepError);
  });
});

describe('surveyOutline on the demo survey', () => {
  const outline = surveyOutline(demoSurvey());

  it('land use questions are choices with their code labels', () => {
    const q = outline.get('collect_code_land_use_category')!;
    expect(q.kind).toBe('choice');
    expect(q.label).toBe('Land Use 2025');
    expect(q.options!.map((o) => o.code)).toEqual(['F', 'C', 'G', 'S', 'W', 'O']);
    expect(q.options!.find((o) => o.code === 'F')!.label).toBe('Forest');
    expect(q.help).toMatch(/^Calculated automatically by Collect/);
    expect(q.excluded).toBe(false);
  });

  it('a real question is a number', () => {
    expect(outline.get('collect_real_slope')!.kind).toBe('number');
    expect(outline.get('collect_integer_forest_percentage')!.kind).toBe('number');
  });

  it('keys and metadata are excluded', () => {
    expect(outline.get('collect_text_id')!.excluded).toBe(true);
    expect(outline.get('collect_code_round')!.excluded).toBe(true);
    expect(outline.get('collect_text_operator')!.excluded).toBe(true);
    expect(outline.get('collect_boolean_actively_saved')!.excluded).toBe(true);
    expect(outline.get('collect_date_actively_saved_on')!.excluded).toBe(true);
  });

  it('enumerated entities have one question per root code, as the desktop app sends them', () => {
    // Keys seen in the desktop app's tests: collect_entity_land_use[F].code_coverage...
    for (const lu of ['F', 'C', 'G', 'S', 'W', 'O']) {
      expect(outline.get(`collect_entity_land_use[${lu}].code_coverage`)!.kind).toBe('choice');
      expect(outline.get(`collect_entity_land_use[${lu}].integer_percentage`)!.kind).toBe('number');
      expect(outline.get(`collect_entity_land_use[${lu}].code_lu`)!.excluded).toBe(true);
    }
    // ...and collect_entity_land_cover[trees].code_coverage.
    expect(outline.get('collect_entity_land_cover[trees].code_coverage')!.kind).toBe('choice');
  });
});
