// The local bundle's stand-in for src/store/migrate.ts (no `pg`): see notInLocalBuild.ts.
import type * as real from '../store/migrate.js';
import { notInLocalBuild } from './notInLocalBuild.js';

export const runMigrations: typeof real.runMigrations = async () => {
  throw notInLocalBuild('The database migrations');
};

/** No migrations ship with the local build (the server owner's panel, off in the local mode, lists them). */
export const migrationFiles: typeof real.migrationFiles = () => [];
