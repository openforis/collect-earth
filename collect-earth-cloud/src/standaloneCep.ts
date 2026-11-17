// The project file for working alone (docs/plans/2026-11-16-plots-from-the-server.md, stage 4): the project file as the
// server serves it (the survey with the round and the coordinator's note it added), with plots in it, so Collect Earth
// opens them with no server, as a project file of before. For someone going where there is no internet, or a project
// leaving the cloud. Every plot file of the project file is emptied to its header row (as a collector's is,
// collectorCep.ts), then the one its properties name (`csv`) gets the plots: one person's, or all the project's. A
// project file that names none gets grid/plots.csv, named in its properties.
import { CEP_PROPERTIES_PATH, namedPlotPath, readCep, zipCep } from './cep.js';
import { propertiesWithoutSecrets } from './cepSecrets.js';
import { headerOnly, isPlotFilePath } from './collectorCep.js';
import { rewriteProperties } from './plotLayout.js';

/**
 * The setting that marks a project file made for working alone: Collect Earth refuses it on a computer that has the
 * cloud project already (an import into a cloud project's folder keeps it the cloud project, so the file's plots would
 * be ignored), and says why (EarthProjectsService.loadCompressedProjectFile).
 */
export const STANDALONE_SETTING = 'cloud_standalone';

/** Where the plots go when the project file names no plot file of its own */
export const STANDALONE_PLOT_PATH = 'grid/plots.csv';

export function standaloneCep(served: Buffer, plots: Buffer, date: Date): Buffer {
  const files = readCep(served);
  const entries = new Map<string, Uint8Array>(files.entries);
  // A file stored before uploads were cleaned of them (cepSecrets): it is handed to someone, so no key or password
  // travels in it, as in the one a collector downloads
  const stored = entries.get(CEP_PROPERTIES_PATH);
  const clean = stored ? propertiesWithoutSecrets(Buffer.from(stored)) : null;
  if (clean) entries.set(CEP_PROPERTIES_PATH, clean);
  const properties = entries.get(CEP_PROPERTIES_PATH);
  const named = namedPlotPath(properties);
  for (const [path, data] of entries) {
    if (isPlotFilePath(path, named)) entries.set(path, headerOnly(Buffer.from(data)));
  }
  if (named !== null && entries.has(named)) {
    entries.set(named, plots);
  } else {
    entries.set(STANDALONE_PLOT_PATH, plots);
    // The properties name it (any csv line of before replaced)
    const text = properties ? Buffer.from(properties).toString('latin1') : ''; // a properties file: one byte a character
    const lines = text.split(/\r?\n/).filter((l) => !/^\s*csv\s*[=:]/.test(l) && l !== '');
    lines.push(`csv=\${project_path}/${STANDALONE_PLOT_PATH}`);
    entries.set(CEP_PROPERTIES_PATH, Buffer.from(`${lines.join('\n')}\n`, 'latin1'));
  }
  entries.set(CEP_PROPERTIES_PATH, rewriteProperties(Buffer.from(entries.get(CEP_PROPERTIES_PATH) ?? new Uint8Array()), { [STANDALONE_SETTING]: 'true' }));
  return zipCep(entries, date);
}
