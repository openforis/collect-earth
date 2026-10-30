import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('MIGRATION_DATABASE_URL', () => {
  it('is the owner connection for the migrations, unset when blank', () => {
    const env = { STORE_BACKEND: 'postgres', DATABASE_URL: 'postgres://ce_app:a@/db' };
    expect(loadConfig({ ...env, MIGRATION_DATABASE_URL: ' postgres://ce:b@/db ' }).migrationDatabaseUrl).toBe('postgres://ce:b@/db');
    expect(loadConfig({ ...env, MIGRATION_DATABASE_URL: ' ' }).migrationDatabaseUrl).toBeUndefined();
    expect(loadConfig(env).migrationDatabaseUrl).toBeUndefined();
  });
});
