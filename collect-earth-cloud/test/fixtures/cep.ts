// Test project files (CEPs) built in memory from the demo survey of the desktop app.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { zipCep } from '../../src/cep.js';

const DEMO_PATH = fileURLToPath(
  new URL('../../../collect-earth/collect-earth-app/resources/demo_survey.cep', import.meta.url),
);

/** The entry date of every fixture zip, so a fixture always has the same bytes. */
export const FIXTURE_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

let demoEntries:Record<string, Uint8Array> | null = null;

/** The demo CEP's entries, read once, without the 8 MB survey guide. */
function demoFiles(): Record<string, Uint8Array> {
  if (!demoEntries) {
    const all = unzipSync(readFileSync(DEMO_PATH));
    delete all['survey_guide.pdf'];
    demoEntries = all;
  }
  // A fresh copy of the map, so callers can change entries without touching the cache.
  return { ...demoEntries };
}

/** The demo CEP exactly as the desktop app ships it (made by Java), survey guide included. */
export function realDemoCep(): Buffer {
  return readFileSync(DEMO_PATH);
}

/**
 * Zips entries in exactly the given order (zipSync would put names like "1" first), with
 * the server's own writer. The fixture tests unzip with fflate, which checks its output.
 */
function zip(files: Record<string, Uint8Array> | Array<[string, Uint8Array]>): Buffer {
  return zipCep(new Map(Array.isArray(files) ? files : Object.entries(files)), FIXTURE_DATE);
}

/** Replaces one match of `pattern`, failing loudly when the demo survey no longer matches. */
function mustReplace(text: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(text)) throw new Error(`demo survey fixture: ${what} not found`);
  return text.replace(pattern, replacement);
}

/** The demo CEP, without `survey_guide.pdf`. Its survey has two keys: `id` and `round`. */
export function demoCep(): Buffer {
  return zip(demoFiles());
}

/** The demo CEP with the `round` key removed everywhere, so `id` is the only key. */
export function idOnlyCep(): Buffer {
  const files = demoFiles();
  const edit = (path: string, change: (text: string) => string) => {
    files[path] = strToU8(change(strFromU8(files[path])));
  };

  // The round attribute; the assessment_phases list stays (it tests "list name already used").
  edit('placemark.idm.xml', (t) =>
    mustReplace(t, /[ \t]*<code id="4614"[\s\S]*?<\/code>[ \t]*\r?\n/, '', 'round attribute'),
  );
  for (const balloon of ['balloon.html', 'balloon_web.html']) {
    edit(balloon, (t) => {
      let out = mustReplace(
        t,
        /^[ \t]*<input[^\n]*id="collect_code_round"[^\n]*\n/m,
        '',
        `${balloon} round input`,
      );
      out = mustReplace(
        out,
        /(EXTRA_ID_ATTRIBUTES = \['collect_text_id'),\s*'collect_code_round'\]/,
        '$1]',
        `${balloon} EXTRA_ID_ATTRIBUTES`,
      );
      return out;
    });
  }
  edit('kml_template.fmt', (t) =>
    mustReplace(t, /<Data name="EXTRA_round">[\s\S]*?<\/Data>\r?\n/, '', 'EXTRA_round data'),
  );
  return zip(files);
}

/** idOnlyCep with its key `id` an integer, not text (plot ids must then be numbers). */
export function integerIdCep(): Buffer {
  const files = unzipSync(idOnlyCep());
  files['placemark.idm.xml'] = strToU8(
    mustReplace(strFromU8(files['placemark.idm.xml']), /<text id="2" name="id"([^>]*?) type="short">([\s\S]*?)<\/text>/, '<integer id="2" name="id"$1>$2</integer>', 'id key'),
  );
  return zip(Object.entries(files));
}

/**
 * The CEP with an attribute of its own named coordinator_note (not filled from the plot file), so
 * the server adds no coordinator's note to it (Task 16, refusal note_name_taken) and serves its plot
 * files without the note column: for the tests of what the round column alone does.
 */
export function noNote(cep: Buffer): Buffer {
  const files = unzipSync(cep);
  files['placemark.idm.xml'] = strToU8(
    mustReplace(
      strFromU8(files['placemark.idm.xml']),
      /(<entity id="1" name="plot"[^>]*>)/,
      '$1\n      <text id="9999990" name="coordinator_note" type="short"/>',
      'root entity',
    ),
  );
  return zip(files);
}

/**
 * A zip of the given entries, for small hand-made cases. Pairs keep their order exactly,
 * even for names like "1" or "__proto__" that a plain object would reorder or swallow.
 */
export function cepWith(files: Record<string, string | Buffer> | Array<[string, string | Buffer]>): Buffer {
  const pairs = Array.isArray(files) ? files : Object.entries(files);
  return zip(
    pairs.map(([path, content]): [string, Uint8Array] => [
      path,
      typeof content === 'string' ? strToU8(content) : new Uint8Array(content),
    ]),
  );
}
