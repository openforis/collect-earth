// Small steps of the server's start (src/index.ts), kept here so they can be tested.
import type { Config } from './config.js';

/**
 * Once the migrations are done the owner's URL (MIGRATION_DATABASE_URL, with the owner's
 * password) is not needed any more: it is taken out of the environment and of the
 * config, so nothing the server runs afterwards can read it or log it. Returns whether
 * it was set (the server is then meant to run as a separate app role).
 */
export function forgetMigrationUrl(config: Config, env: NodeJS.ProcessEnv = process.env): boolean {
  const wasSet = config.migrationDatabaseUrl !== undefined;
  delete env.MIGRATION_DATABASE_URL;
  delete config.migrationDatabaseUrl;
  return wasSet;
}

/**
 * What to log about Row-Level Security at start. With a separate app role asked for
 * (MIGRATION_DATABASE_URL set) RLS must bind it, or the server refuses to start; with
 * one role for everything it only warns, as before.
 */
export function rowLevelSecurityAtBoot(
  rls: { role: string; enforced: boolean; reason: string | null },
  separateRole: boolean,
): { level: 'info' | 'warn'; message: string } {
  if (rls.enforced) {
    return { level: 'info', message: `Row-Level Security binds the database role ${rls.role}` };
  }
  if (separateRole) {
    throw new Error(
      `MIGRATION_DATABASE_URL is set, but Row-Level Security does not bind the database role ${rls.role} (${rls.reason}). ` +
        'DATABASE_URL must name a plain role. See "Row-Level Security and the database role" in DEPLOY.md',
    );
  }
  return {
    level: 'warn',
    message: `Row-Level Security does not bind the database role ${rls.role} (${rls.reason}); only the route checks keep projects apart. See "Row-Level Security and the database role" in DEPLOY.md`,
  };
}
