// A made-up Collect Earth backup (the zip of "Export data to XML (ZIP)"): a survey with every kind of attribute Collect
// Earth summarizes (text, code with a qualifier, integer, real, boolean, date, time, both ranges, a coordinate, a
// multiple code, an enumerated table, a table the collector adds rows to, a single entity) and records that fill
// them, leave them empty, or leave rows out. Its records are read by Collect in CeoRecordsXmlTest (the folder
// backup-sample), which checks that the summary the cloud makes of each is the one Collect Earth makes.
import { zipCep } from '../src/cep.js';

const list = (name: string, items: [string, string, boolean?][]) =>
  `    <list id="${name.length + 900}" name="${name}">
      <label type="item">${name}</label>
      <items>
${items.map(([code, label, qualifiable], i) => `        <item id="${1000 + name.length * 10 + i}"${qualifiable ? ' qualifiable="true"' : ''}>\n          <code>${code}</code>\n          <label>${label}</label>\n        </item>`).join('\n')}
      </items>
    </list>`;

export const SAMPLE_SURVEY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<survey lastId="100" collect:target="CE" collectearth:plotarea="1.0" collectearth:samplepoints="25" xmlns="http://www.openforis.org/idml/3.0" xmlns:collect="http://www.openforis.org/collect/3.0/collect" xmlns:ui="http://www.openforis.org/collect/3.0/ui" xmlns:collectearth="http://www.openforis.org/collect/3.0/collectearth">
  <project xml:lang="es">Muestra de copia de seguridad</project>
  <project>Backup sample</project>
  <uri>http://www.openforis.org/idm/backup_sample</uri>
  <language>en</language>
  <language>es</language>
  <codeLists>
${list('round', [['1', 'First assessment'], ['2', 'Check']])}
${list('land_use', [['F', 'Forest'], ['C', 'Cropland'], ['other', 'Other', true]])}
${list('species', [['pine', 'Pine'], ['oak', 'Oak'], ['fir', 'Fir']])}
${list('element', [['trees', 'Trees'], ['shrubs', 'Shrubs'], ['grass', 'Grass']])}
  </codeLists>
  <spatialReferenceSystems>
    <spatialReferenceSystem srid="EPSG:4326">
      <label xml:lang="en">EPSG:4326</label>
      <wkt><![CDATA[GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.01745329251994328,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]]]></wkt>
    </spatialReferenceSystem>
  </spatialReferenceSystems>
  <schema>
    <entity id="1" name="plot">
      <label type="instance">Plot</label>
      <text id="2" name="id" key="true" required="true" type="short"><label type="instance">Plot - ID</label></text>
      <code id="3" name="round" key="true" list="round"><label type="instance">Round</label></code>
      <coordinate id="4" name="location"><label type="instance">Location</label></coordinate>
      <text id="5" name="operator" type="short"><label type="instance">Operator</label></text>
      <boolean id="6" name="actively_saved"><label type="instance">Actively saved</label></boolean>
      <date id="7" name="actively_saved_on"><label type="instance">Saved on</label></date>
      <text id="8" name="plot_file" type="short"><label type="instance">Plot file</label></text>
      <number id="9" name="elevation" collectearth:fromcsv="true" type="integer"><label type="instance">Elevation</label></number>
      <number id="10" name="slope" collectearth:fromcsv="true" type="real"><label type="instance">Slope</label></number>
      <text id="11" name="region" collectearth:fromcsv="true" type="short"><label type="instance">Region</label></text>
      <code id="12" name="land_use" list="land_use"><label type="instance">Land use</label></code>
      <number id="13" name="canopy" type="real"><label type="instance">Canopy</label></number>
      <time id="14" name="survey_time"><label type="instance">Time</label></time>
      <range id="15" name="height" type="real"><label type="instance">Height</label></range>
      <range id="16" name="years" type="integer"><label type="instance">Years</label></range>
      <text id="17" name="notes" type="memo"><label type="instance">Notes</label></text>
      <code id="18" name="species" multiple="true" list="species"><label type="instance">Species</label></code>
      <date id="19" name="observed_on"><label type="instance">Observed on</label></date>
      <coordinate id="20" name="landmark"><label type="instance">Landmark</label></coordinate>
      <boolean id="21" name="disturbed"><label type="instance">Disturbed</label></boolean>
      <entity id="30" name="trees" multiple="true" ui:layout="table">
        <label type="instance">Trees</label>
        <code id="31" name="tree_species" list="species"><label type="instance">Species</label></code>
        <number id="32" name="dbh" type="real"><label type="instance">DBH</label></number>
        <text id="33" name="tree_note" type="short"><label type="instance">Note</label></text>
      </entity>
      <entity id="40" name="cover" multiple="true" ui:layout="table" collect:enumerate="true">
        <label type="instance">Cover</label>
        <code id="41" name="element" key="true" list="element"><label type="instance">Element</label></code>
        <number id="42" name="percent" type="integer"><label type="instance">Percent</label></number>
      </entity>
      <entity id="50" name="visit">
        <label type="instance">Visit</label>
        <date id="51" name="visit_date"><label type="instance">Date</label></date>
        <text id="52" name="inspector" type="short"><label type="instance">Inspector</label></text>
      </entity>
    </entity>
  </schema>
</survey>
`;

const v = (name: string, value: string | null, field = 'value') => (value === null ? `  <${name} />` : `  <${name}>\n    <${field}>${value}</${field}>\n  </${name}>`);

/** One record, as Collect's DataMarshaller writes it. */
function record(r: {
  id: string;
  round?: string;
  step?: number;
  lat: number | null;
  lon: number;
  operator: string;
  saved: boolean;
  modified: string;
  elevation: string;
  slope: string;
  region: string;
  body: string[];
}): string {
  return [
    `<?xml version='1.0' standalone='yes' ?>`,
    `<plot step="${r.step ?? 1}" created="2025-09-24T13:09:19.124+02:00" modified="${r.modified}">`,
    v('id', r.id),
    v('round', r.round ?? '1', 'code'),
    r.lat === null ? '  <location />' : `  <location>\n    <x>${r.lon}</x>\n    <y>${r.lat}</y>\n    <srs>EPSG:4326</srs>\n  </location>`,
    v('operator', r.operator),
    v('actively_saved', r.saved ? 'true' : 'false'),
    '  <actively_saved_on>\n    <year>2025</year>\n    <month>9</month>\n    <day>24</day>\n  </actively_saved_on>',
    v('plot_file', 'grid/sample_plots.csv'),
    v('elevation', r.elevation),
    v('slope', r.slope),
    v('region', r.region),
    ...r.body,
    '</plot>',
    '',
  ].join('\n');
}

const cover = (element: string, percent: string | null) =>
  `  <cover>\n    <element>\n      <code>${element}</code>\n    </element>\n${percent === null ? '    <percent />' : `    <percent>\n      <value>${percent}</value>\n    </percent>`}\n  </cover>`;
const tree = (species: string | null, dbh: string | null, note: string | null) =>
  `  <trees>\n${species === null ? '    <tree_species />' : `    <tree_species>\n      <code>${species}</code>\n    </tree_species>`}\n${dbh === null ? '    <dbh />' : `    <dbh>\n      <value>${dbh}</value>\n    </dbh>`}\n${note === null ? '    <tree_note />' : `    <tree_note>\n      <value>${note}</value>\n    </tree_note>`}\n  </trees>`;

/** The records of the sample backup, by their path in the zip. */
export const SAMPLE_RECORDS: Record<string, string> = {
  // Everything answered: a qualifier, both ranges, two species, two trees, every cover row, the visit
  '1/101.xml': record({
    id: 'P1', lat: 42.4842216299026, lon: 1.42032362698269, operator: 'Marta', saved: true, modified: '2025-09-24T13:09:26.160+02:00',
    elevation: '2149', slope: '11.0', region: 'North',
    body: [
      '  <land_use>\n    <code>other</code>\n    <qualifier>orchard &amp; vines</qualifier>\n  </land_use>',
      v('canopy', '0.0001'),
      '  <survey_time>\n    <hour>9</hour>\n    <minute>5</minute>\n  </survey_time>',
      '  <height>\n    <from>2.5</from>\n    <to>12.0</to>\n  </height>',
      '  <years>\n    <from>2001</from>\n    <to>2001</to>\n  </years>',
      v('notes', 'Burnt in 2019, regrowing'),
      v('species', 'pine', 'code'),
      v('species', 'oak', 'code'),
      '  <observed_on>\n    <year>2024</year>\n    <month>12</month>\n    <day>31</day>\n  </observed_on>',
      '  <landmark>\n    <x>1.5</x>\n    <y>42.0</y>\n    <srs>EPSG:4326</srs>\n  </landmark>',
      v('disturbed', 'true'),
      tree('pine', '35.5', 'tallest'),
      tree('oak', '12345678.9', null),
      cover('trees', '60'),
      cover('shrubs', '30'),
      cover('grass', '10'),
      '  <visit>\n    <visit_date>\n      <year>2025</year>\n      <month>1</month>\n      <day>7</day>\n    </visit_date>\n    <inspector>\n      <value>R. Ortega</value>\n    </inspector>\n  </visit>',
    ],
  }),
  // Little answered: empty elements, no species, one empty tree row, one cover row (the others added when loaded)
  '1/102.xml': record({
    id: 'P2', lat: 42.51, lon: 1.53, operator: 'Collect Earth User', saved: false, modified: '2025-09-25T08:00:00.000+02:00',
    elevation: '1740', slope: '27.5', region: 'South',
    body: [
      v('land_use', 'F', 'code'),
      '  <canopy />',
      '  <survey_time />',
      '  <height>\n    <from>3</from>\n  </height>',
      '  <notes />',
      '  <observed_on />',
      '  <landmark />',
      tree(null, null, null),
      cover('grass', null),
    ],
  }),
  // A checked record (step 2), no location, a large and a negative real
  '2/103.xml': record({
    id: 'P3', lat: null, lon: 0, step: 2, operator: 'Rosa Vidal', saved: true, modified: '2025-10-01T17:45:00.000+00:00',
    elevation: '2428', slope: '-0.5', region: '',
    body: [
      v('land_use', 'C', 'code'),
      v('canopy', '25000000.0'),
      v('species', 'fir', 'code'),
      v('disturbed', 'false'),
      cover('trees', '100'),
    ],
  }),
  // The same plot's check round, by another person
  '1/104.xml': record({
    id: 'P1', round: '2', lat: 42.4842216299026, lon: 1.42032362698269, operator: 'Marta P', saved: true, modified: '2025-10-02T10:00:00.000+02:00',
    elevation: '2149', slope: '11.0', region: 'North',
    body: [v('land_use', 'F', 'code'), cover('shrubs', '45')],
  }),
};

/** The sample backup as Collect Earth zips it: idml.xml, then the records. */
export function sampleBackupZip(records: Record<string, string> = SAMPLE_RECORDS, survey = SAMPLE_SURVEY): Buffer {
  const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
  return zipCep(new Map<string, Uint8Array>([['idml.xml', utf8(survey)], ...Object.entries(records).map(([path, xml]) => [path, utf8(xml)] as [string, Uint8Array])]), new Date('2025-10-03T00:00:00Z'));
}
