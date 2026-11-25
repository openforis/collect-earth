/** Pure shaping of the forest loss answer (ee/forestLoss.js): Hansen's yearly loss and the RADD and GLAD alerts. */

/** Square metres to hectares, to 0.001 ha (10 m²): a RADD pixel is about 100 m². */
const ha = (m2) => Math.round(m2 / 10) / 1000;

/** RADD's `Date` and the code ee/forestLoss.js builds from GLAD's day of year: YYDOY (2-digit year, day of year). */
const yydoyToMs = (code) => Date.UTC(2000 + Math.floor(code / 1000), 0, code % 1000);

/**
 * Grouped pixel areas `[{ code, sum }]`, code = YYDOY * 10 + confidence (2 unconfirmed, 3 confirmed), sum in m², as
 * alerts `{ date, ha, source, confirmed }` sorted by date, unconfirmed first, one per date and confidence.
 */
function alertsOf(groups, source) {
  const byCode = new Map();
  for (const { code, sum } of groups ?? []) byCode.set(code, (byCode.get(code) ?? 0) + sum);
  return [...byCode]
    .sort(([a], [b]) => a - b)
    .map(([code, sum]) => ({ date: yydoyToMs(Math.floor(code / 10)), ha: ha(sum), source, confirmed: code % 10 === 3 }));
}

/** Hansen's `lossyear` groups (years since 2000) as `[{ year, ha }]` sorted by year. */
const hansenOf = (groups) => (groups ?? []).map(({ code, sum }) => ({ year: 2000 + code, ha: ha(sum) })).sort((a, b) => a.year - b.year);

/** The endpoint's answer from what ee/forestLoss.js evaluated. */
function shapeForestLoss({ plotHa, treeCover2000, loss, radd, glad }) {
  return {
    plotHa: Math.round(plotHa * 100) / 100,
    treeCover2000: treeCover2000 === null || treeCover2000 === undefined ? null : Math.round(treeCover2000 * 10) / 10,
    hansen: hansenOf(loss),
    alerts: [...alertsOf(radd.groups, "RADD"), ...alertsOf(glad.groups, "GLAD")].sort((a, b) => a.date - b.date),
    coverage: { radd: radd.covered, glad: glad.covered },
  };
}

module.exports = { yydoyToMs, alertsOf, hansenOf, shapeForestLoss };
