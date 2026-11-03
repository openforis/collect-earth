// The local bundle's stand-in for src/store/postgres.ts (no `pg`): see notInLocalBuild.ts.
import type * as real from '../store/postgres.js';
import { notInLocalBuild } from './notInLocalBuild.js';

export const PostgresStore = class {
  constructor() {
    throw notInLocalBuild('The Postgres store');
  }
} as unknown as typeof real.PostgresStore;
