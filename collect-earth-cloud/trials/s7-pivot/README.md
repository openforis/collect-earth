# Trial S7: a pivot table generated from any survey (DuckDB-WASM + Perspective)

The trial of `docs/plans/2026-11-05-node-and-arena.md`, "Presenting the data": does a pivot table built from a
survey's definition replace Saiku, for any survey, inside a browser page? Run on 5 November 2026 on the demo survey;
the results are in the plan ("S7 results").

What is here:

| File | What |
| --- | --- |
| `model.mjs` | The **view model** of a survey, generated from its IDML (`placemark.idm.xml`): entities, dimensions (every exported attribute, code attributes with their lists and levels), measures (plot count, area, plot weight, min/max/avg of numbers); compared with the `.cep`'s `collectEarthCubes.xml.fmt` |
| `data.mjs` | Synthetic records for the demo survey, laid out as the RDB export does (one CSV per entity, the code tables), with expansion factors from a `region_areas.csv` |
| `main.js`, `index.html` | The page: DuckDB-WASM holds the tables and builds the cube (labels joined for every code attribute, the parent level of 2-level lists); Perspective shows the pivot and the charts |
| `check.mjs` | Serves the page, opens it in Chromium (Playwright), reads the pivot's figures and DuckDB's for the same questions, times the steps, measures memory, takes screenshots |
| `compare.py` | The same figures from the CSVs in plain Python, compared with the page's |
| `standalone.mjs`, `standalone-check.mjs` | One HTML file with everything inside (the stand-alone tool), and its test from the disk (`file://`) |

To run it again:

```bash
npm install
mkdir -p demo && (cd demo && unzip -o ../../../../collect-earth/collect-earth-app/resources/demo_survey.cep)
node model.mjs demo out && node data.mjs demo out 55 && node data.mjs demo out 100000
mkdir -p site && cp out/*.csv out/model.json index.html site/
cp node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js site/
mkdir -p site/pd && for p in client server viewer viewer-datagrid viewer-charts; do mkdir -p site/pd/$p && cp -r node_modules/@perspective-dev/$p/dist site/pd/$p/; done
npx esbuild main.js --bundle --format=esm --minify --outfile=site/main.bundle.js
node check.mjs 55 plot && node check.mjs 55 land_cover && python3 compare.py 55
node check.mjs 100000 plot && python3 compare.py 100000
node standalone.mjs 55 && node standalone-check.mjs 55
```

`check.mjs` and `standalone-check.mjs` need Playwright with Chromium (`npm install playwright && npx playwright install chromium`).

Things learnt, kept here so the stage does not learn them again:

- The cube generator of Collect skips the attributes marked `collect:includeInDataExport="false"` and keeps the
  bookkeeping ones; a 2-level code list gives two dimensions (the level and its parent).
- `@finos/perspective*` is deprecated: use `@perspective-dev/client`, `server`, `viewer`, `viewer-datagrid`,
  `viewer-charts`, with the viewer's theme stylesheet (`viewer/dist/css/pro.css`).
- A `<perspective-viewer>` written in the HTML before the library loads crashes (a wasm "unreachable") as soon as a plugin
  other than Debug is chosen: create the element from script after the imports.
- DuckDB-WASM and the page must use one version of `apache-arrow` (DuckDB's, 17), or the Arrow bytes handed to
  Perspective are empty; Perspective takes an `ArrayBuffer`, not a `Uint8Array`.
- DuckDB-WASM fetches extensions (Parquet, JSON) from `extensions.duckdb.org` on first use: an offline tool must serve
  them itself or avoid them.
- From a page opened from the disk (`file://`), DuckDB's worker cannot fetch a `blob:` URL; a `data:` URL works.
- A JavaScript `String.replace` with a replacement string reads `$\`` and `$&` in it: inlining a minified bundle needs a
  function replacement.
