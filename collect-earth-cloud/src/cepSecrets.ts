import { createHash } from 'node:crypto';
import { CEP_PROPERTIES_PATH, CepError, DEFAULT_CEP_LIMITS, packEntry, writeZip, zipEntryList, type PackedZipEntry } from './cep.js';
import { rewriteProperties } from './plotLayout.js';

/**
 * The settings of a project file (project_definition.properties) that are somebody's key or password, by Collect
 * Earth's property names (LocalPropertiesService.EarthProperty): keys of imagery accounts, the database's credentials of
 * the computer the file was made on, a cloud server's token. A project file is handed to every person of the project
 * (GET /cep), so none of them may travel in it: each person enters their own Planet key in Collect Earth's settings.
 */
export const SECRET_SETTINGS = [
  'planet_maps_key',
  'planet_maps_ce_key',
  'google_maps_api_key',
  'ga_api_secret',
  'db_username',
  'db_password',
  'cloud_sync_token',
  'cloud_token',
] as const;

/** Parameters of a web address that carry a key, by their usual names */
const KEY_PARAMETER = /[?&#](api[_-]?key|apikey|key|token|access[_-]?token|secret|password|sig|signature)=[^&#\s]{6,}/i;

/** Whether a web address seems to carry a key (the extra map's, say, which every collector's Collect Earth opens). */
export const hasKeyParameter = (url: string): boolean => KEY_PARAMETER.test(url);

export interface WithoutSecrets {
  /** The project file with those settings blank; the same buffer when it had none */
  cep: Buffer;
  /** The settings that had a value, by name: never their values */
  removed: string[];
  /** A web address among the settings (the extra map's, say) seems to carry a key: left as it is, the map would not open without it */
  keyInExtraMap: boolean;
}

/**
 * The settings file (project_definition.properties) with its keys and passwords blank, or null when it has none: for
 * the project file a collector downloads, which may have been stored before uploads were cleaned.
 */
export function propertiesWithoutSecrets(data: Buffer): Buffer | null {
  const text = data.toString('latin1');
  const present = SECRET_SETTINGS.filter((key) => new RegExp(`^[ \\t\\f]*${key}[ \\t\\f]*[=:][ \\t\\f]*\\S`, 'm').test(text));
  return present.length === 0 ? null : rewriteProperties(data, Object.fromEntries(present.map((key) => [key, ''])));
}

/** The settings that are web addresses carrying a key: `name=https://…?key=…` lines (the `:` and `=` of a value may be escaped). */
function keyInAnAddress(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const m = /^[ \t\f]*([\w.-]+)[ \t\f]*[=:][ \t\f]*(.*)$/.exec(line);
    if (!m || (SECRET_SETTINGS as readonly string[]).includes(m[1])) continue;
    const value = m[2].replace(/\\([:=#!\\])/g, '$1');
    if (/^https?:\/\//i.test(value) && hasKeyParameter(value)) return true;
  }
  return false;
}

/**
 * The project file without the keys and passwords its settings carried. Read as a zip only, so a file whose survey the
 * server cannot read is cleaned too; every other file is copied as it is packed. Throws CepError for what is no zip the
 * server reads.
 */
export function withoutSecrets(cep: Buffer): WithoutSecrets {
  const list = zipEntryList(cep, DEFAULT_CEP_LIMITS.maxEntries, DEFAULT_CEP_LIMITS.maxTotalBytes * 2);
  const entry = list.find((e) => e.name === CEP_PROPERTIES_PATH);
  if (!entry) return { cep, removed: [], keyInExtraMap: false };
  const data = Buffer.from(entry.read());
  const text = data.toString('latin1');
  const keyInExtraMap = keyInAnAddress(text);
  const removed = SECRET_SETTINGS.filter((key) => new RegExp(`^[ \\t\\f]*${key}[ \\t\\f]*[=:][ \\t\\f]*\\S`, 'm').test(text));
  if (removed.length === 0) return { cep, removed: [], keyInExtraMap };
  const clean = rewriteProperties(data, Object.fromEntries(removed.map((key) => [key, ''])));
  const packed: PackedZipEntry[] = list.map((e) =>
    e === entry ? { ...packEntry(e.name, clean, e.packed.dosTime, e.packed.dosDate), nameBytes: e.packed.nameBytes, flags: e.packed.flags } : e.packed,
  );
  return { cep: writeZip(packed), removed: [...removed], keyInExtraMap };
}

/** Cleaned stored files by their sha256 (the same buffer when there was nothing to clean), least recently used first. */
const cleaned = new Map<string, Buffer>();
const MAX_CLEANED = 16;

/**
 * A stored project file as anybody downloads it or as it is copied into another project: one stored before uploads were
 * cleaned still has its keys and passwords. Built once per stored file. A file the server cannot read as a zip comes
 * back as it is (`onUnreadable` is told): uploads of such files are refused now.
 */
export function storedWithoutSecrets(stored: Buffer, onUnreadable?: (e: CepError) => void): Buffer {
  const key = createHash('sha256').update(stored).digest('hex');
  let clean = cleaned.get(key);
  if (clean) {
    cleaned.delete(key);
  } else {
    try {
      clean = withoutSecrets(stored).cep;
    } catch (e) {
      if (!(e instanceof CepError)) throw e;
      onUnreadable?.(e);
      return stored;
    }
  }
  cleaned.set(key, clean);
  if (cleaned.size > MAX_CLEANED) cleaned.delete(cleaned.keys().next().value!);
  return clean;
}
