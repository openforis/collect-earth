import type { Store } from './store/store.js';
import { totalStorageBytes, type ServerSettings } from './types.js';

const MB = 1024 * 1024;

/** The per-project storage limit in bytes, or null when there is none (0 MB). */
export function storageLimitBytes(settings: ServerSettings): number | null {
  return settings.maxProjectStorageMb > 0 ? settings.maxProjectStorageMb * MB : null;
}

/** What the overview reports: bytes used and the limit (null = no limit). */
export async function storageSummary(
  store: Store,
  projectId: string,
): Promise<{ usedBytes: number; limitBytes: number | null }> {
  const [storage, settings] = await Promise.all([store.getProjectStorage(projectId), store.getSettings()]);
  return { usedBytes: totalStorageBytes(storage), limitBytes: storageLimitBytes(settings) };
}

/**
 * Checks a coordinator upload against the storage limit. The upload replaces
 * what it overwrites (the CEP, or the plot file of the same name), so that part
 * is not counted twice. Returns the 413 body when it would go over, else null.
 *
 * Collectors' record uploads never come through here: field data is never
 * refused because of the limit; the overview warns instead.
 */
export async function checkUploadFits(
  store: Store,
  projectId: string,
  upload: { kind: 'cep' } | { kind: 'csv'; filename: string },
  newBytes: number,
): Promise<{ error: 'storage_limit_reached'; usedBytes: number; limitBytes: number } | null> {
  const limitBytes = storageLimitBytes(await store.getSettings());
  if (limitBytes === null) {
    return null;
  }
  const storage = await store.getProjectStorage(projectId);
  const usedBytes = totalStorageBytes(storage);
  const replaced = upload.kind === 'cep' ? storage.cepBytes : storage.csvBytesByFilename[upload.filename] ?? 0;
  if (usedBytes - replaced + newBytes > limitBytes) {
    return { error: 'storage_limit_reached', usedBytes, limitBytes };
  }
  return null;
}
