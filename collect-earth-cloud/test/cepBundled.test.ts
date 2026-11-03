import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCep } from '../src/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { idOnlyCep } from './fixtures/cep.js';

// The rewrite of the project file's own plot file failing its read-back (a bug, or a file it cannot handle).
vi.mock('../src/routes/assignments.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/routes/assignments.js')>();
  return {
    ...real,
    servedBundledPlotFile: () => {
      throw new Error('servedBundledPlotFile: does not read back');
    },
  };
});

describe("the project file's own plot file cannot be given the columns (Task 22 review)", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('the upload is still taken, with round and the note in the survey, and that plot file served as it came', async () => {
    const project = await createProject(ctx.app, 'Bundled');
    const upload = idOnlyCep();
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${project.projectId}/cep`,
      headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' },
      payload: upload,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().round.state).toBe('added');
    const served = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}/cep`, headers: bearer(project.projectToken) })).rawPayload;
    const path = 'grid/showcase_plots.csv';
    expect(Buffer.from(readCep(served).entries.get(path)!).equals(Buffer.from(readCep(upload).entries.get(path)!))).toBe(true);
  });
});
