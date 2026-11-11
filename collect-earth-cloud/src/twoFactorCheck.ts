// At start, the server reads a sample of the two-step sign-in secrets with its keys (src/twoFactor.ts). A secret none of
// them reads belongs to someone who can no longer sign in but with a recovery code: their key was lost (another
// TWO_FACTOR_KEY, or one of the settings the keys came from before it). Said at once, in the log and to the owner
// (src/ownerAlerts.ts), rather than by the first person locked out, hours later.
import type { Store } from './store/store.js';
import { readSecret, type TwoFactorKeys } from './twoFactor.js';

/** How many secrets are read at start: the latest, which show a key lost recently; enough, and quick. */
export const SAMPLE = 50;

export interface TwoFactorCheck {
  checked: number;
  unreadable: number;
  /** The ids of the keys the unreadable secrets name, to know which key to put back */
  missingKeys: string[];
}

export async function checkTwoFactorKeys(store: Store, keys: TwoFactorKeys, sample = SAMPLE): Promise<TwoFactorCheck> {
  const secrets = await store.sampleTwoFactorSecrets(sample);
  const missing = new Set<string>();
  let unreadable = 0;
  for (const stored of secrets) {
    const read = readSecret(stored, keys);
    if (read.secret === null) {
      unreadable++;
      missing.add(read.missingKey);
    }
  }
  return { checked: secrets.length, unreadable, missingKeys: [...missing] };
}
