import { cepProperties, readCep, withProperties } from './cep.js';
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

/** Whether a web address seems to carry a key (the extra map's, which every collector's Collect Earth opens). */
export const hasKeyParameter = (url: string): boolean => KEY_PARAMETER.test(url);

export interface WithoutSecrets {
  /** The project file with those settings blank; the same buffer when it had none */
  cep: Buffer;
  /** The settings that had a value, by name: never their values */
  removed: string[];
  /** The extra map's address seems to carry a key (left as it is: the map would not open without it) */
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

/** The project file without the keys and passwords its settings carried. Throws what readCep throws. */
export function withoutSecrets(cep: Buffer, date: Date): WithoutSecrets {
  const properties = cepProperties(readCep(cep));
  const removed = SECRET_SETTINGS.filter((key) => (properties.get(key) ?? '').trim() !== '');
  const keyInExtraMap = hasKeyParameter(properties.get('extra_map_url') ?? '');
  if (removed.length === 0) return { cep, removed, keyInExtraMap };
  const blank = Object.fromEntries(removed.map((key) => [key, '']));
  return { cep: withProperties(cep, (data) => rewriteProperties(data, blank), date), removed: [...removed], keyInExtraMap };
}
