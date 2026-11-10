// The planned survey written as a Collect survey (IDML 3.0, placemark.idm.xml), on the skeleton Collect Earth expects
// (as its demo survey has it): the `plot` root entity with its `id` key and `location`, the attributes Collect Earth
// fills itself (operator, actively_saved, actively_saved_on, plot_file), the plot file's columns read into the record
// (elevation, slope, aspect, then the extra ones), then the questions on a tab of their own. Read back by Collect's
// own parser in the desktop's tests (CeoSurveyIdmlTest).
import type { PlannedCheck } from './rules.js';
import type { PlannedAttribute, SurveyPlan } from './survey.js';

export interface SurveyMeta {
  /** the project's name, the survey's label */
  project: string;
  /** a unique identifier of the survey (Collect's uri) */
  uri: string;
  description: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const SURVEY_TAB = 'survey_tab';
const DATA_TAB = 'plot_data_tab';

const WGS84 = `GEOGCS["WGS 84",
      DATUM["World Geodetic System 1984",
        SPHEROID["WGS 84", 6378137.0, 298.257223563, AUTHORITY["EPSG","7030"]],
        AUTHORITY["EPSG","6326"]],
      PRIMEM["Greenwich", 0.0, AUTHORITY["EPSG","8901"]],
      UNIT["degree", 0.017453292519943295],
      AXIS["Geodetic longitude", EAST],
      AXIS["Geodetic latitude", NORTH],
      AUTHORITY["EPSG","4326"]]`;

/** The survey as IDML text. */
export function writeIdml(meta: SurveyMeta, plan: SurveyPlan, checks: readonly PlannedCheck[]): string {
  let lastId = 0;
  const next = () => ++lastId;
  const label = (text: string, type = 'instance') => `<label type="${type}">${escape(text)}</label>`;

  const lists: string[] = [];
  for (const a of plan.attributes) {
    if (a.kind !== 'code') continue;
    const items = a.items.map((i) => `        <item id="${next()}">\n          <code>${escape(i.code)}</code>\n          ${label(i.label).replace(' type="instance"', '')}\n        </item>`);
    lists.push(`    <list id="${next()}" name="${a.name}">\n      ${label(a.label, 'item')}\n      <codingScheme scope="local" />\n      <items>\n${items.join('\n')}\n      </items>\n    </list>`);
  }

  const checksOf = (name: string): string[] =>
    checks.filter((c) => c.attribute === name).map((c) => {
      const message = `<message>${escape(c.message)}</message>`;
      switch (c.kind) {
        case 'pattern':
          return `<pattern flag="error" regex="${escape(c.regex)}">${message}</pattern>`;
        case 'compare':
          return `<compare flag="error"${c.gte !== null ? ` gte="${c.gte}"` : ''}${c.lte !== null ? ` lte="${c.lte}"` : ''}>${message}</compare>`;
        case 'custom':
          return `<check flag="error"${c.when ? ` if="${escape(c.when)}"` : ''} expr="${escape(c.expr)}">${message}</check>`;
      }
    });

  const question = (a: PlannedAttribute): string => {
    const attrs = [
      `id="${next()}"`,
      `name="${a.name}"`,
      a.required ? 'required="true"' : null,
      a.relevant ? `relevant="${escape(a.relevant)}"` : null,
      a.relevant ? 'ui:hideWhenNotRelevant="true"' : null,
      `ui:tab="${SURVEY_TAB}"`,
      a.kind === 'code' && a.layout === 'dropdown' ? 'ui:layoutType="dropdown"' : null,
      a.kind === 'code' ? `list="${a.name}"` : null,
      a.kind === 'number' ? 'type="real"' : a.kind === 'text' ? 'type="short"' : null,
    ].filter(Boolean).join(' ');
    const tag = a.kind === 'code' ? 'code' : a.kind === 'number' ? 'number' : 'text';
    const body = [label(a.label), a.description ? `<description>${escape(a.description)}</description>` : null, ...checksOf(a.name)].filter(Boolean);
    return `      <${tag} ${attrs}>\n${body.map((b) => `        ${b}`).join('\n')}\n      </${tag}>`;
  };

  const builtIn = [
    `      <text id="${next()}" name="id" required="true" ui:tab="${DATA_TAB}" key="true" type="short">\n        ${label('Plot - ID')}\n      </text>`,
    `      <coordinate id="${next()}" name="location" ui:tab="${DATA_TAB}">\n        ${label('Plot - Central point coordinates')}\n      </coordinate>`,
    `      <text id="${next()}" name="operator" required="true" ui:tab="${DATA_TAB}" type="short">\n        ${label('Plot - Operator')}\n      </text>`,
    `      <boolean id="${next()}" name="actively_saved" ui:tab="${DATA_TAB}">\n        ${label('Plot - Actively saved by user')}\n      </boolean>`,
    `      <date id="${next()}" name="actively_saved_on" relevant="false()" ui:tab="${DATA_TAB}">\n        ${label('Plot - Date of last saved')}\n      </date>`,
    `      <text id="${next()}" name="plot_file" relevant="false()" ui:tab="${DATA_TAB}" type="short">\n        ${label('Plot - CSV file that contains the plot')}\n      </text>`,
    `      <number id="${next()}" name="elevation" ui:tab="${DATA_TAB}" collectearth:fromcsv="true" type="integer">\n        ${label('Plot - Elevation')}\n      </number>`,
    `      <number id="${next()}" name="slope" ui:tab="${DATA_TAB}" collectearth:fromcsv="true" type="real">\n        ${label('Plot - Slope')}\n      </number>`,
    `      <number id="${next()}" name="aspect" ui:tab="${DATA_TAB}" collectearth:fromcsv="true" type="real">\n        ${label('Plot - Aspect')}\n      </number>`,
    ...plan.columns.map((c) => `      <text id="${next()}" name="${c.name}" ui:tab="${DATA_TAB}" collectearth:fromcsv="true" type="short">\n        ${label(c.column)}\n      </text>`),
  ];
  const entityId = next();
  const questions = plan.attributes.map(question);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<survey lastId="${lastId}" xmlns="http://www.openforis.org/idml/3.0" xmlns:collect="http://www.openforis.org/collect/3.0/collect" xmlns:ui="http://www.openforis.org/collect/3.0/ui" xmlns:collectearth="http://www.openforis.org/collect/3.0/collectearth">
  <project>${escape(meta.project)}</project>
  <uri>${escape(meta.uri)}</uri>
${meta.description ? `  <description>${escape(meta.description)}</description>\n` : ''}  <language>en</language>
  <applicationOptions>
    <options type="ui">
      <n0:tabSet name="plot_tab_set" xmlns:n0="http://www.openforis.org/collect/3.0/ui">
        <n0:tab name="${SURVEY_TAB}">
          <n0:label>${escape(meta.project) || 'Survey'}</n0:label>
        </n0:tab>
        <n0:tab name="${DATA_TAB}">
          <n0:label>Plot data</n0:label>
        </n0:tab>
      </n0:tabSet>
    </options>
  </applicationOptions>
  <codeLists>
${lists.join('\n')}
  </codeLists>
  <spatialReferenceSystems>
    <spatialReferenceSystem srid="EPSG:4326">
      <label xml:lang="en">EPSG:4326</label>
      <wkt><![CDATA[${WGS84}]]></wkt>
    </spatialReferenceSystem>
  </spatialReferenceSystems>
  <schema>
    <entity id="${entityId}" name="plot" ui:tab="${SURVEY_TAB}" ui:tabSet="plot_tab_set">
      ${label('Plot')}
${builtIn.join('\n')}
${questions.join('\n')}
    </entity>
  </schema>
</survey>
`;
}
