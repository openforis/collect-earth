// Test project files (CEPs) built in memory from the demo survey of the desktop app.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

const DEMO_PATH = fileURLToPath(
  new URL('../../../collect-earth/collect-earth-app/resources/demo_survey.cep', import.meta.url),
);

let demoEntries: Record<string, Uint8Array> | null = null;

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

function zip(files: Record<string, Uint8Array>): Buffer {
  // Level 1: real deflated entries, as in an uploaded CEP, but quick to build.
  return Buffer.from(zipSync(files as Zippable, { level: 1 }));
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

/** A zip of the given entries, for small hand-made cases. */
export function cepWith(files: Record<string, string | Buffer>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === 'string' ? strToU8(content) : new Uint8Array(content);
  }
  return zip(entries);
}
