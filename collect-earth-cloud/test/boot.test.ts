import { describe, expect, it } from 'vitest';
import { forgetMigrationUrl, rowLevelSecurityAtBoot } from '../src/boot.js';
import { loadConfig } from '../src/config.js';

describe('forgetMigrationUrl', () => {
  it('drops the owner URL from the environment and the config once the migrations are done', () => {
    const env: NodeJS.ProcessEnv = {
      STORE_BACKEND: 'postgres',
      DATABASE_URL: 'postgres://ce_app:a@/db',
      MIGRATION_DATABASE_URL: 'postgres://ce:owner-secret@/db',
    };
    const config = loadConfig(env);
    expect(forgetMigrationUrl(config, env)).toBe(true);
    expect(env.MIGRATION_DATABASE_URL).toBeUndefined();
    expect('migrationDatabaseUrl' in config).toBe(false);
    expect(JSON.stringify(config)).not.toContain('owner-secret');
    expect(env.DATABASE_URL).toBe('postgres://ce_app:a@/db');
  });

  it('says false when there was no owner URL', () => {
    const env: NodeJS.ProcessEnv = { STORE_BACKEND: 'postgres', DATABASE_URL: 'postgres://ce:a@/db' };
    expect(forgetMigrationUrl(loadConfig(env), env)).toBe(false);
  });
});

describe('rowLevelSecurityAtBoot', () => {
  it('says that RLS binds the role', () => {
    expect(rowLevelSecurityAtBoot({ role: 'ce_app', enforced: true, reason: null }, true)).toEqual({
      level: 'info',
      message: 'Row-Level Security binds the database role ce_app',
    });
  });

  it('warns with one role for everything, as before', () => {
    const r = rowLevelSecurityAtBoot({ role: 'ce', enforced: false, reason: 'it owns the tables' }, false);
    expect(r.level).toBe('warn');
    expect(r.message).toMatch(/does not bind the database role ce \(it owns the tables\)/);
  });

  it('refuses to start when a separate app role was asked for but RLS does not bind it', () => {
    expect(() => rowLevelSecurityAtBoot({ role: 'ce_app', enforced: false, reason: 'it has CREATEROLE' }, true)).toThrow(
      /MIGRATION_DATABASE_URL is set, but Row-Level Security does not bind the database role ce_app \(it has CREATEROLE\)/,
    );
  });
});
