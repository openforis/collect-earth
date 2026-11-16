import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCep, zipCep } from '../src/cep.js';
import { hasKeyParameter, propertiesWithoutSecrets, storedWithoutSecrets, withoutSecrets } from '../src/cepSecrets.js';
import { cepForCollector } from '../src/collectorCep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { FIXTURE_DATE, idOnlyCep } from './fixtures/cep.js';

/** The demo project file with these lines added to its settings. */
function cepWithSettings(lines: string): Buffer {
  const entries = new Map(readCep(idOnlyCep()).entries);
  const path = 'project_definition.properties';
  entries.set(path, strToU8(`${strFromU8(entries.get(path)!)}\n${lines}\n`));
  return zipCep(entries, FIXTURE_DATE);
}
const settingsOf = (cep: Uint8Array) => strFromU8(unzipSync(cep)['project_definition.properties']);
const SECRETS = 'planet_maps_key=PLAK-coordinator-secret\ngoogle_maps_api_key = AIzaSy-secret\ndb_password=hunter2\ndb_username=ce\nextra_map_url=https\\://maps.example.org/?lat\\=LATITUDE&key\\=abcdef123456';

describe('keys and passwords in a project file', () => {
  it('are left out of its settings, the other settings kept as they were', () => {
    const { cep, removed, keyInExtraMap } = withoutSecrets(cepWithSettings(SECRETS));
    expect(removed.sort()).toEqual(['db_password', 'db_username', 'google_maps_api_key', 'planet_maps_key']);
    expect(keyInExtraMap).toBe(true);
    const settings = settingsOf(cep);
    expect(settings).not.toMatch(/PLAK-coordinator-secret|AIzaSy-secret|hunter2/);
    expect(settings).toMatch(/^planet_maps_key=$/m);
    expect(settings).toContain('sample_shape=');
    expect(settings).toContain('maps.example.org');
    // A file without any comes back as it is
    const plain = idOnlyCep();
    expect(withoutSecrets(plain)).toEqual({ cep: plain, removed: [], keyInExtraMap: false });
    expect(propertiesWithoutSecrets(Buffer.from('sample_shape=SQUARE\nplanet_maps_key=\n'))).toBeNull();
  });

  it('knows a web address that carries a key', () => {
    expect(hasKeyParameter('https://x.org/map?lat=LATITUDE&lon=LONGITUDE')).toBe(false);
    expect(hasKeyParameter('https://x.org/map?token=abcdef123&lat=LATITUDE')).toBe(true);
    expect(hasKeyParameter('https://x.org/map?api_key=abcdef123')).toBe(true);
    expect(hasKeyParameter('https://x.org/map?key=ab')).toBe(false);
  });

  it('never reach a collector, even from a file stored before uploads were cleaned', () => {
    const forCollector = cepForCollector(cepWithSettings(SECRETS));
    expect(settingsOf(forCollector)).not.toMatch(/PLAK-coordinator-secret|AIzaSy-secret|hunter2/);
  });

  it('are left out of a file whose survey the server cannot read, and of a stored file as anybody gets it', () => {
    const noSurvey = Buffer.from(zipSync({ 'project_definition.properties': strToU8('planet_maps_key=PLAK-coordinator-secret\nsample_shape=SQUARE\nearth_map_url=https\\://earthmap.org/?token\\=abcdef123456\n') }));
    const clean = withoutSecrets(noSurvey);
    expect(clean.removed).toEqual(['planet_maps_key']);
    expect(clean.keyInExtraMap).toBe(true);
    expect(settingsOf(clean.cep)).not.toContain('PLAK-coordinator-secret');
    expect(settingsOf(clean.cep)).toContain('sample_shape=SQUARE');
    // a file stored before uploads were cleaned: the same clean file each time, and one without secrets as it is
    const stored = cepWithSettings(SECRETS);
    expect(settingsOf(storedWithoutSecrets(stored))).not.toMatch(/PLAK-coordinator-secret|AIzaSy-secret|hunter2/);
    expect(storedWithoutSecrets(stored)).toBe(storedWithoutSecrets(stored));
    const plain = idOnlyCep();
    expect(storedWithoutSecrets(plain)).toBe(plain);
    // what is no zip cannot be cleaned: said, and left
    const junk = Buffer.from('not a zip at all, just some text');
    let told = 0;
    expect(storedWithoutSecrets(junk, () => (told += 1))).toBe(junk);
    expect(told).toBe(1);
  });

  describe('through the routes', () => {
    it('a file stored before uploads were cleaned reaches nobody with its keys, and takes none into a copy', async () => {
      const project = await createProject(ctx.app, 'Stored before');
      const stored = cepWithSettings(SECRETS);
      await ctx.store.putCep(project.projectId, stored, { state: 'none', refusal: 'no_survey', keyCount: 0, roundIndex: null, roundCodes: [], reassessmentCode: null } as never, stored);
      for (const path of ['/cep', '/cep/original']) {
        const got = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${project.projectId}${path}`, headers: bearer(project.adminToken) });
        expect(got.statusCode, path).toBe(200);
        expect(settingsOf(got.rawPayload), path).not.toMatch(/PLAK-coordinator-secret|AIzaSy-secret|hunter2/);
      }
    });

    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await makeContext();
    });
    afterEach(async () => {
      await ctx.app.close();
    });

    it('the upload says which were left out, and nobody downloads them', async () => {
      const project = await createProject(ctx.app, 'Secrets');
      const url = `/v1/projects/${project.projectId}/cep`;
      const put = await ctx.app.inject({ method: 'PUT', url, headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: cepWithSettings(SECRETS) });
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json().removedSettings.sort()).toEqual(['db_password', 'db_username', 'google_maps_api_key', 'planet_maps_key']);
      expect(put.json().keyInExtraMap).toBe(true);
      for (const [token, path] of [[project.projectToken, url], [project.adminToken, url], [project.adminToken, `${url}/original`]]) {
        const got = await ctx.app.inject({ method: 'GET', url: path, headers: bearer(token) });
        expect(got.statusCode, path).toBe(200);
        expect(settingsOf(got.rawPayload), path).not.toMatch(/PLAK-coordinator-secret|AIzaSy-secret|hunter2/);
      }
      // A file without any: nothing said
      const plain = await ctx.app.inject({ method: 'PUT', url, headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: idOnlyCep() });
      expect(plain.json().removedSettings).toBeUndefined();
      expect(plain.json().keyInExtraMap).toBeUndefined();
    });
  });
});
