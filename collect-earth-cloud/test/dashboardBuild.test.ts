import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dashboardBuildOf } from '../src/server.js';
import { makeContext, type TestContext } from './helpers.js';

// server-info's dashboardBuild: which build of the dashboard the server serves, so a page left open
// across an upgrade can offer to reload (web/src/newVersion.ts).
describe('the dashboard build in server-info', () => {
  let ctx: TestContext | null = null;
  const dirs: string[] = [];
  const webDir = (html: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'ce-build-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'index.html'), html);
    return dir;
  };
  afterEach(async () => {
    await ctx?.app.close();
    ctx = null;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('is a hash of the served index.html, which changes with each build', async () => {
    const first = webDir('<script src="/assets/index-aaa.js"></script>');
    ctx = await makeContext({}, { webDir: first });
    const build = (await ctx.app.inject({ method: 'GET', url: '/v1/server-info' })).json().dashboardBuild;
    expect(build).toMatch(/^[0-9a-f]{16}$/);
    expect(build).toBe(dashboardBuildOf(first));
    expect(dashboardBuildOf(webDir('<script src="/assets/index-bbb.js"></script>'))).not.toBe(build);
  });

  it('is null when the server serves no dashboard', async () => {
    ctx = await makeContext({}, { webDir: null });
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/server-info' })).json().dashboardBuild).toBeNull();
    expect(dashboardBuildOf(join(tmpdir(), 'no-such-dashboard-dir'))).toBeNull();
  });
});
