import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { idsNotFittingKeys } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { areaContains, areaFromGeoJson, areaFromShapefileZip, DesignError, MAX_DESIGN_PLOTS, plotFileCsv, type AreaOfInterest } from '../plotDesign.js';
import { fileKeyCount } from '../rounds.js';
import { SIGRID_COUNTRIES } from '../sigridCountries.js';
import { selects, SIGRID_SPACINGS, sigridCountry, sigridCounts, SigridError, sigridPlots, type SigridSelection } from '../sigrid.js';
import type { Store } from '../store/store.js';
import type { SigridCountries, SigridFacts } from '../wire/plotFiles.js';
import { extraColumns } from './plotDesign.js';
import type { PlotPlaceReader } from './plotPlaces.js';

interface SigridBody {
  country?: unknown;
  spacingKm?: unknown;
  provinces?: unknown;
  districts?: unknown;
  geojson?: unknown;
  shapefile?: unknown;
  generate?: unknown;
}

const stem = (zip: string) => zip.replace(/_grids(_no_districts)?\.zip$/, '');

/**
 * SIGRID plots (coordinators):
 * - GET /v1/projects/:pid/sigrid/countries: `{countries: [{name, file}], spacings}`.
 * - POST /v1/projects/:pid/sigrid with `{country, spacingKm?, provinces?, districts?: [{province, district}],
 *   geojson? | shapefile? (the area to clip to), generate?}`. Without `generate`: the country's provinces
 *   and districts with their plots per spacing, `selected` (the plots per spacing of the provinces and
 *   districts asked for, before any clip) and, with a spacing, `{plots, tooMany}` for the whole choice.
 *   With `generate: true`: the plot file (text/csv, `x-plot-count`), its ids SIGRID's CE_ID.
 * 400 with a `code` (`unknown_country`, `bad_spacing`, `bad_name`, `bad_area`, `too_many`, `no_plots`,
 * `several_keys`, `id_not_text`); 502 `sigrid_unreachable` when openforis.org cannot be read.
 */
export async function registerSigridRoutes(app: FastifyInstance, store: Store, places: PlotPlaceReader): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  app.get('/v1/projects/:pid/sigrid/countries', admin, async (): Promise<SigridCountries> => ({
    countries: SIGRID_COUNTRIES.map((c) => ({ name: c.name, file: stem(c.zip) })),
    spacings: SIGRID_SPACINGS,
    max: MAX_DESIGN_PLOTS,
  }));

  app.post('/v1/projects/:pid/sigrid', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as SigridBody;
    const refuse = (code: string, reason: string) => reply.code(400).send({ error: 'bad_request', code, reason });
    const country = sigridCountry(body.country);
    if (!country) return refuse('unknown_country', 'country must be one of the SIGRID countries.');
    const spacing = body.spacingKm;
    if (spacing !== undefined && !SIGRID_SPACINGS.includes(spacing as number)) return refuse('bad_spacing', `spacingKm must be one of ${SIGRID_SPACINGS.join(', ')}.`);
    let clip: AreaOfInterest | null = null;
    try {
      if (typeof body.geojson === 'string') clip = areaFromGeoJson(body.geojson);
      else if (typeof body.shapefile === 'string') clip = areaFromShapefileZip(Buffer.from(body.shapefile, 'base64'));
    } catch (err) {
      if (err instanceof DesignError) return refuse(err.code, err.message);
      throw err;
    }
    const projectId = request.membership!.projectId;
    try {
      const counts = await sigridCounts(country.zip);
      // Names as the package's own.
      const known = new Set(counts.rows.map((r) => `${r.province}\u0000${r.district}`));
      const provinceNames = new Set(counts.rows.map((r) => r.province));
      const provinces = body.provinces ?? [];
      const districts = body.districts ?? [];
      if (!Array.isArray(provinces) || !provinces.every((p) => typeof p === 'string' && provinceNames.has(p))) {
        return refuse('bad_name', 'provinces must be province names (ADM1NM) of the country.');
      }
      if (!Array.isArray(districts) || !districts.every((d) => typeof d?.province === 'string' && typeof d?.district === 'string' && known.has(`${d.province}\u0000${d.district}`))) {
        return refuse('bad_name', 'districts must be {province, district} names (ADM1NM, ADM2NM) of the country.');
      }
      const selection: SigridSelection = { provinces, districts: districts.map((d: { province: string; district: string }) => ({ province: d.province, district: d.district })) };
      const inSelection = selects(selection);
      const selected = counts.spacings.map((_, i) => counts.rows.reduce((s, r) => s + (inSelection(r.province, r.district) ? r.plots[i] : 0), 0));
      const at = spacing === undefined ? -1 : counts.spacings.indexOf(spacing as number);
      if (spacing !== undefined && at < 0) return refuse('bad_spacing', `${country.name} has no plots ${spacing} km apart: choose a smaller spacing.`);

      const tooMany = `That makes more than ${MAX_DESIGN_PLOTS.toLocaleString('en')} plots. Choose a larger spacing, or fewer provinces or districts.`;
      if (body.generate !== true) {
        const byProvince = new Map<string, { name: string; plots: number[]; districts: { name: string; plots: number[] }[] }>();
        for (const r of counts.rows) {
          const p = byProvince.get(r.province) ?? { name: r.province, plots: counts.spacings.map(() => 0), districts: [] };
          p.plots = p.plots.map((n, i) => n + r.plots[i]);
          p.districts.push({ name: r.district, plots: r.plots });
          byProvince.set(r.province, p);
        }
        const facts: SigridFacts = {
          country: country.name,
          spacings: counts.spacings,
          // A package without district names has one row of empty names.
          provinces: [...byProvince.values()].filter((p) => p.name !== ''),
          selected,
          max: MAX_DESIGN_PLOTS,
        };
        if (at < 0) return reply.send(facts);
        // Without a clip the counts file says it; with one, the grid is read and its plots tested.
        const plots = clip && selected[at] > 0 ? (await sigridPlots(country.zip, spacing as number, selection, areaContains(clip), 0)).count : selected[at];
        return reply.send({ ...facts, spacingKm: spacing as number, plots, tooMany: plots > MAX_DESIGN_PLOTS } satisfies SigridFacts);
      }

      if (at < 0) return refuse('bad_spacing', 'spacingKm is needed to make the plot file.');
      // The plot file's key columns as plot design makes them; the id is SIGRID's text CE_ID.
      const info = await store.getRoundInfo(projectId);
      const keyCount = fileKeyCount(info);
      const roundIndex = info?.state === 'own' && info.roundIndex !== null && info.roundIndex < keyCount ? info.roundIndex : null;
      if (keyCount > (roundIndex === null ? 1 : 2)) {
        return refuse('several_keys', 'The survey identifies a plot by several keys: SIGRID gives one id. Make the plot file in another tool.');
      }
      const roundCode = info?.roundCodes.find((c) => c.code !== info.reassessmentCode)?.code ?? '1';
      const { keys } = await places.surveyFacts(projectId, request.log);
      const sample = Array.from({ length: keyCount }, (_, i) => (i === roundIndex ? roundCode : '8344_20552')).join(',');
      if (keys && idsNotFittingKeys([sample], keys, keyCount).length > 0) {
        return refuse(
          'id_not_text',
          "SIGRID plot ids are text, like 8344_20552, but the survey's plot id is a number. Change the id attribute to text in the survey, or use Plot design instead.",
        );
      }
      if (!clip && selected[at] > MAX_DESIGN_PLOTS) return refuse('too_many', tooMany);
      const { count, plots } = await sigridPlots(country.zip, spacing as number, selection, clip && areaContains(clip), MAX_DESIGN_PLOTS);
      if (count > MAX_DESIGN_PLOTS) return refuse('too_many', tooMany);
      if (count === 0) return refuse('no_plots', 'No SIGRID plot is in the provinces, districts and area chosen.');
      const extra = await extraColumns(store, projectId, info, request.log);
      const designed = plots.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, columns: { adm1nm: p.province, adm2nm: p.district } }));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('x-plot-count', String(count))
        .send(plotFileCsv(designed, { count: keyCount, roundIndex, roundCode }, extra));
    } catch (err) {
      if (err instanceof SigridError && err.code === 'unreachable') return reply.code(502).send({ error: 'sigrid_unreachable', code: 'sigrid_unreachable', reason: err.message });
      if (err instanceof SigridError) return reply.code(502).send({ error: 'sigrid_bad_package', code: 'sigrid_bad_package', reason: err.message });
      throw err;
    }
  });
}
