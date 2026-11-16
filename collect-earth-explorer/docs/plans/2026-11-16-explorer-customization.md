# Explorer Customization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Explorer draws its imagery layers and chart cards from a per-survey configuration document passed in the address, falling back to a standard configuration equal to today's screen.

**Architecture:** One JSON file, `functions/catalogue.json`, lists the layer and chart types, their parameters and the standard configuration. The API validates request parameters against it and serves it at `GET /api/catalogue`; the web app imports the same file at build time, parses `config` from the address, and renders `LayersPanel` and the chart area from the resulting list. The API stays stateless: it only ever sees the parameters of one request, which become part of the cache key.

**Tech Stack:** Node 22 CommonJS + Express + `node:test` (`functions/`); React 19 + TypeScript + Vite + vitest (`web/`); Earth Engine JS client.

**Design:** `docs/plans/2026-11-16-explorer-customization-design.md` (read its "Amendments after review" section first).

**Scope:** the Explorer only (design build steps 1 and 2). The dashboard editor and the desktop pass-through are outlined at the end and get their own plans.

**Rules for every task**
- Read `CLAUDE.md` first. Commands run from `collect-earth-explorer/`.
- TDD: write the test, see it fail, implement, see it pass, commit. One commit per task.
- With no `config` in the address the screen and every API response must be identical to today. The existing tests are the proof: do not weaken them.
- `functions/ee/vendor/` is not touched.
- Unit tests: `npm --prefix functions test`, `npm --prefix web test`, `npm --prefix web run lint`, `npm --prefix web run build`. Live Earth Engine tests (`EE_LIVE=1 npm --prefix functions run test:live`) need `functions/.secret.local`; two of them fail today for unrelated reasons ("no Landsat scenes for 1990", a CCDC value of 1.0005), so compare against that baseline.

---

## Phase 1: configuration drives the screen (no new parameters yet)

### Task 1: The catalogue file and its API endpoint

**Files:**
- Create: `functions/catalogue.json`
- Create: `functions/lib/catalogue.js`, `functions/lib/catalogue.test.js`
- Modify: `functions/routes.js` (register `GET /api/catalogue`)
- Test: `functions/test/routes.test.js`

**Step 1: Write `functions/catalogue.json`**

```json
{
  "v": 1,
  "layers": {
    "sentinel2": {
      "title": "Sentinel-2 composite",
      "params": {
        "label": { "type": "text", "max": 60 },
        "start": { "type": "date" },
        "end": { "type": "date" },
        "bands": { "type": "choice", "values": ["false-colour", "true-colour"], "default": "false-colour" },
        "maxCloud": { "type": "int", "min": 1, "max": 100, "default": 70 }
      }
    },
    "landsat": {
      "title": "Landsat yearly composite",
      "params": {
        "label": { "type": "text", "max": 60 },
        "years": { "type": "yearRange", "min": 1984 },
        "year": { "type": "year", "min": 1984 },
        "bands": { "type": "choice", "values": ["false-colour", "true-colour"], "default": "false-colour" },
        "maxCloud": { "type": "int", "min": 1, "max": 100, "default": 50 }
      }
    }
  },
  "charts": {
    "ccdc": {
      "title": "CCDC temporal segmentation",
      "params": {
        "band": { "type": "choice", "values": ["NDFI", "NDVI"], "default": "NDFI" },
        "collapsed": { "type": "bool", "default": false }
      }
    },
    "landsat-series": {
      "title": "Landsat index series",
      "params": {
        "index": { "type": "choice", "values": ["NDVI", "NDMI", "NBR", "EVI"], "default": "NDVI" },
        "collapsed": { "type": "bool", "default": false }
      }
    },
    "sentinel2-series": {
      "title": "Sentinel-2 index series",
      "params": {
        "index": { "type": "choice", "values": ["NDVI", "NDMI", "NBR", "EVI"], "default": "NDVI" },
        "collapsed": { "type": "bool", "default": false }
      }
    },
    "modis": {
      "title": "MODIS 16-day index and burned area",
      "params": {
        "index": { "type": "choice", "values": ["NDVI", "EVI"], "default": "NDVI" },
        "collapsed": { "type": "bool", "default": false }
      }
    }
  },
  "standard": {
    "v": 1,
    "layers": [{ "type": "sentinel2" }, { "type": "landsat" }],
    "charts": [{ "type": "ccdc" }, { "type": "landsat-series" }, { "type": "sentinel2-series" }, { "type": "modis" }]
  }
}
```

The defaults are today's hard-coded values (`maxCloudyPercent = 70` in `ee/sentinel2.js`, `MAX_CLOUD_COVER = 50` in `ee/landsatComposite.js`, `NDFI` in `CcdcCard.tsx`).

**Step 2: Write the failing tests** in `functions/lib/catalogue.test.js` for a pure helper `paramOf(kind, type, name, value, { maxYear })`:

- returns the default when `value` is `undefined` (`paramOf("layers","sentinel2","maxCloud")` is `70`; a parameter without a default returns `undefined`);
- `choice`: accepts a listed value, throws `BadRequest` naming the allowed values otherwise;
- `int`: accepts an integer inside `[min, max]`; rejects `"70"`-like non-integers after `Number()` coercion fails, floats, out of range;
- `date`: accepts a real `YYYY-MM-DD`; rejects `2021-02-30` and `2021-13-01`;
- `year`: integer in `[min, maxYear]`; `yearRange`: array of two such years with from ≤ to;
- `bool`: only `true`/`false`; `text`: string no longer than `max`;
- unknown type or unknown parameter name throws `BadRequest`;
- one structural test: every entry of `catalogue.standard.layers` / `.charts` names a type present in the catalogue.

**Step 3:** Run `node --test functions/lib/catalogue.test.js`. Expected: FAIL, module not found.

**Step 4: Implement `functions/lib/catalogue.js`** (EE-free): `const catalogue = require("../catalogue.json")`, `paramOf` as specified, using `BadRequest` from `./errors`. Export `{ catalogue, paramOf }`. Keep it under about 50 lines; one `switch` on `spec.type`.

**Step 5: Route.** In `functions/routes.js` `registerRoutes`, add `app.get("/api/catalogue", (req, res) => res.json(catalogue));`. Add a supertest case in `functions/test/routes.test.js`: `GET /api/catalogue` answers 200 with `standard.layers[0].type === "sentinel2"`.

**Step 6:** `npm --prefix functions test`. Expected: all pass (140 before, plus the new ones).

**Step 7: Commit** `collect-earth-explorer: catalogue of layer and chart types, served at /api/catalogue`.

---

### Task 2: Read the address fragment as well as the query

Collect Earth builds `#geoJson=…;plotId=…;survey=…;startTime=…;endTime=…;` (see `BrowserService.geeAppUrl` in the desktop). The Explorer reads only `?geoJson=…&plot_id=…` today.

**Files:**
- Modify: `web/src/lib/urlParams.ts`, `web/src/lib/urlParams.test.ts`
- Modify: `web/src/App.tsx` (pass the hash), `web/src/App.test.tsx`

**Step 1: Failing tests** in `urlParams.test.ts`:
- `parsePlotUrl("", now, "#geoJson=<encoded>;plotId=101;survey=s;startTime=2020-01-01;endTime=2024-01-01;")` gives the polygon, `plotId` `"101"`, both dates;
- a value in the fragment wins over the same key in the query;
- `plot_id` (query spelling) and `plotId` (fragment spelling) are both accepted;
- `config` is returned raw and decoded as `configText` (`undefined` when absent);
- a trailing `;` and empty segments are ignored.

**Step 2:** `cd web && npx vitest run src/lib/urlParams.test.ts`. Expected: FAIL.

**Step 3: Implement.** `parsePlotUrl(search, now = new Date(), hash = "")`. Build one `Map` of parameters: first from `new URLSearchParams(search)`, then from the fragment (`hash.replace(/^#/, "").split(";")`, each segment split at its first `=`, value through `decodeURIComponent` inside a try/catch that skips a bad segment). Add `configText?: string` to `PlotParams`. In `App.tsx` pass `window.location.hash` and add it to the `useMemo` dependencies.

**Step 4:** `npm --prefix web test`. Expected: all pass; the sample-plot links of `App.tsx` still work (they use the query).

**Step 5: Commit** `collect-earth-explorer: read plot parameters from the address fragment Collect Earth builds`.

---

### Task 3: Parse the configuration document with its fallbacks

**Files:**
- Create: `web/src/lib/config.ts`, `web/src/lib/config.test.ts`
- Modify: `web/tsconfig.app.json`, `web/vite.config.ts` only if the JSON import needs it (see Step 3)

**Step 1: Failing tests** in `config.test.ts`, one per row of the design's fallback table, for `resolveConfig(text: string | undefined, maxYear: number): { layers: LayerEntry[]; charts: ChartEntry[]; notices: string[] }`:

| Input | Expected |
|---|---|
| `undefined` | standard layers and charts, no notices |
| `"{not json"` | standard both, one notice |
| `{"v":1,"charts":[{"type":"modis"}]}` | standard layers, one chart, no notices |
| `{"v":1,"layers":[{"type":"landsat"}]}` | one layer, standard charts |
| a layer of type `"sentinel1"` among valid ones | that entry skipped, one notice naming `sentinel1` |
| a chart with `"index":"XYZ"` | that entry skipped, one notice |
| `layers` given but no valid entry | standard layers, notices kept |
| `"charts": []` | no charts (an explicit empty list is honoured) |
| `"layers": []` | standard layers (a map needs imagery) |
| two `sentinel2` entries with different `label` | both kept, in order |
| `"v": 2` | standard both, one notice |
| defaults | a `sentinel2` entry without `bands` resolves to `bands: "false-colour"`, `maxCloud: 70` |

Each resolved entry is `{ type, params }` with every catalogue default filled in, so components never look defaults up.

**Step 2:** `cd web && npx vitest run src/lib/config.test.ts`. Expected: FAIL.

**Step 3: Implement `web/src/lib/config.ts`.** `import catalogue from "../../../functions/catalogue.json";`. Validate each parameter with a small `check(spec, value, maxYear)` that mirrors `paramOf` in `functions/lib/catalogue.js` (same rules, returns `undefined` for invalid instead of throwing). Add this comment above it: `// Mirrors functions/lib/catalogue.js paramOf: the server is the authority, this only decides what to draw.` Export the types `LayerEntry`, `ChartEntry` and `resolveConfig`.

Then run `npm --prefix web run build`. If `tsc` rejects the import from outside `src` (TS6307), add `"../functions/catalogue.json"` to `include` in `web/tsconfig.app.json` and set `resolveJsonModule: true`; if the Vite dev server refuses the file, add `server.fs.allow: [".."]` in `web/vite.config.ts`. Change nothing that is not needed.

**Step 4:** `npm --prefix web test && npm --prefix web run build`. Expected: pass, build succeeds.

**Step 5: Commit** `collect-earth-explorer: parse a survey's configuration document, with the standard one as fallback`.

---

### Task 4: Plot state holds layer entries instead of fixed names

**Files:**
- Modify: `web/src/state/PlotContext.tsx`
- Modify: `web/src/components/LayerSources.ts`, `web/src/App.tsx`
- Test: `web/src/state/*.test.tsx` if present, `web/src/App.test.tsx`

**What changes**
- `LayerId` becomes `number | "scene"`: the position of an entry in `layers`, or the implicit scene layer.
- `PlotProvider` takes `config` (the result of `resolveConfig`) next to `params` and exposes `layers`, `charts`, `notices`.
- `activeLayer` starts at `0`. `compareLayer` starts at `1` when there are two or more entries, else `0`.
- `landsatYear` becomes `years: Record<number, number>` with `yearOf(i)`, `setYear(i, y)` and `selectYear(i, y)` (sets the year and activates entry `i`). The initial year of a Landsat entry is its `year` parameter, else the last year of its `years`, else the year before `params.end` (today's rule), clamped into `years`.
- `useLayerTiles(layer)` builds its request from the entry: `tiles/sentinel2` or `tiles/landsat` chosen by `entry.type`; the body is `{ plot, start, end }` plus, for Landsat, `year`. No new parameters are sent in this task. The `useApi` dependency key is the entry position plus that entry's year.
- `App.tsx`: `const config = useMemo(() => resolveConfig(parsed.params.configText, new Date().getUTCFullYear()), [...])`, passed to `PlotProvider`. The `sameLayer` logic in `Viewer` keeps working on the new ids.

**Steps:** update the existing tests' setup to the new provider props first and add: (a) with no `config`, the first tile request is `tiles/sentinel2` and the compare layer requests `tiles/landsat` (today's behaviour); (b) with `layers: [landsat, sentinel2]` the first request is `tiles/landsat`; (c) two Landsat entries keep separate years. Run, see them fail, implement, run `npm --prefix web test`, commit `collect-earth-explorer: layer state follows the configuration's entries`.

---

### Task 5: The layers panel renders from the entries

**Files:**
- Modify: `web/src/components/LayersPanel.tsx`, `web/src/components/LayersPanel.test.tsx`

**What changes**
- One radio row per entry, in order, then the scene row (unchanged), then Compare.
- Row label: the entry's `label` parameter; otherwise today's texts, `Sentinel-2, last 12 months` for a `sentinel2` entry without dates, `Sentinel-2 <start> to <end>` with dates, and `Landsat <year>` for Landsat.
- A Landsat entry gets its own year slider under its row. Its range is the entry's `years`, else `1984` to the plot's end year (today's range). The debounce and the compare rule (while comparing, the slider changes the year without activating the layer) stay exactly as they are, per entry. Extract the row plus slider into a small `LandsatRow` component in the same file so each entry owns its `pendingYear`.
- A Landsat entry whose `years` is a single year shows no slider.
- The Compare `<select>` lists the same entries plus the scene.

**Steps:** the existing `LayersPanel.test.tsx` cases must pass unchanged in meaning with the standard configuration (adjust only the provider setup). Add cases for: order follows the document; a `label`; two Landsat entries with independent sliders; a slider limited to `years`; single-year entry without slider. Fail, implement, `npm --prefix web test`, commit `collect-earth-explorer: layers panel built from the configuration`.

---

### Task 6: The chart area renders from the entries, with a notice

**Files:**
- Modify: `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/index.css`
- Modify: the four cards in `web/src/components/charts/` (accept `params`)

**What changes**
- A map from chart type to its lazy component: `ccdc` → `CcdcCard`, `landsat-series` → `LandsatNdviCard`, `sentinel2-series` → `Sentinel2NdviCard`, `modis` → `ModisCard`. `Viewer` renders `charts.map((c, i) => <Card key={i} params={c.params} />)` inside the existing `Suspense`.
- Each card takes `params`. In this task only `CcdcCard` uses it: its initial `band` is `params.band`. The others ignore it until Phase 2.
- With `charts` empty the side pane shows the plot heading and dates only.
- When `notices` is not empty, one line above the charts: `This survey's Explorer settings were partly ignored:` followed by the notices, in a `.config-notice` block (small, muted, wraps).

**Steps:** tests first: no `config` renders the four cards in today's order and requests the same four endpoints; `charts: [{type:"modis"}]` requests only `series/modis`; a `ccdc` entry with `band: "NDVI"` posts `band: "NDVI"`; a bad entry shows the notice. Fail, implement, run `npm --prefix web test && npm --prefix web run lint && npm --prefix web run build`, commit `collect-earth-explorer: chart cards built from the configuration`.

**Checkpoint (manual):** `npm run emulate`, open `http://localhost:5000/?geoJson=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B-88.75%2C17.25%5D%7D`: identical to before. Then append `&config=` with the URL-encoded form of `{"v":1,"layers":[{"type":"landsat","years":[2000,2010],"label":"Landsat 2000s"},{"type":"sentinel2"}],"charts":[{"type":"modis"}]}` and confirm the order, the slider range and the single chart. Also try the fragment form `#geoJson=…;config=…;`.

---

## Phase 2: the new parameters

Each task follows the same pattern: validator and cache-key test in `functions/test/routes.test.js` (a bad value is a 400 before the cache or Earth Engine; two different values give two cache keys; an absent value gives the same key as before the change only if `extras` is unchanged, see the note below), the Earth Engine change, one live test per new value in `functions/test/live/`, then the web side sends the parameter.

**Cache note:** `extras` is part of the cache key. Build `extras` so that default values are omitted (`bands: "false-colour"` is not stored in `extras`), otherwise every existing cache entry is orphaned and a default request and an explicit-default request are cached twice.

### Task 7: Sentinel-2 composite: `bands`, `maxCloud`, `start`/`end`

**Files:** `functions/ee/sentinel2Composite.js`, `functions/ee/sentinel2.js`, `functions/routes.js`, `functions/test/routes.test.js`, `functions/test/live/sentinel2Composite.test.js`, `web/src/components/LayerSources.ts`

- Request body gains optional `bands`, `maxCloud`, `compositeStart`, `compositeEnd` (the plot's own `start`/`end` keep their meaning). Validate with `paramOf("layers", "sentinel2", …)`; `compositeStart` must be before `compositeEnd`, and giving only one of them is a 400.
- `sentinel2CompositeTiles(plot, end, { bands, maxCloud, start })`: window is `[start, end)` when given, else the 12 months before `end` (today). `maxCloud` goes to `sentinel2Images`' `maxCloudyPercent`. Add `SENTINEL_TRUE_COLOUR_RENAMED = { bands: ["red", "green", "blue"], min: 0, max: 3000 }` in `ee/sentinel2.js` and select by `bands`.
- The label stays `Sentinel-2 composite <start> to <end>`.
- Web: `useLayerTiles` sends the entry's non-default parameters.
- Live tests: true colour returns a tile URL; an explicit window is reflected in `dateRange`.

Commit `collect-earth-explorer: Sentinel-2 composite takes band combination, cloud limit and dates`.

### Task 8: Landsat composite: `bands`, `maxCloud`

**Files:** `functions/lib/sensors.js` (+ test), `functions/ee/landsatComposite.js`, `functions/routes.js`, route and live tests, `web/src/components/LayerSources.ts`

- `SENSORS` gains `trueColour` per sensor in red, green, blue order: `["SR_B3","SR_B2","SR_B1"]` for L5 and L7, `["SR_B4","SR_B3","SR_B2"]` for L8 and L9.
- `sensorImages(id, plot, year, { bands, maxCloud })` selects `s.trueColour` renamed to `["red","green","blue"]` for true colour; the cloud filter uses `maxCloud`.
- `LANDSAT_TRUE_VIZ = { bands: ["red","green","blue"], min: 0, max: 0.3, gamma: [1.3, 1.3, 1.3] }`. `LANDSAT_VIZ` and the scene view are untouched.
- Live test: 2020 true colour returns a tile URL.

Commit `collect-earth-explorer: Landsat composite takes band combination and cloud limit`.

### Task 9: Index series for Landsat and Sentinel-2: `index`

**Files:** create `functions/ee/indices.js`; modify `functions/ee/landsat.js`, `functions/ee/landsatSeries.js`, `functions/ee/sentinel2Series.js`, `functions/routes.js`, route and live tests; web `LandsatNdviCard.tsx`, `Sentinel2NdviCard.tsx`

- `prepared()` in `ee/landsat.js` selects `["SR_B1","SR_B4","SR_B5","SR_B7","SR_B3"]` as `["blue","nir","swir","swir2","red"]` instead of three bands. After `harmonizeOli` every sensor carries those TM names, so one selection serves all (as the existing comment explains). `swir` keeps its name: the composite and scene code depend on it.
- `functions/ee/indices.js`: `indexImage(img, index, names)` where `names` maps the roles to band names (`{ nir, red, swir1, swir2, blue }`: Landsat passes `swir1: "swir"`, Sentinel-2 passes its own renamed bands). NDVI = nd(nir, red); NDMI = nd(nir, swir1); NBR = nd(nir, swir2); EVI = `2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)` on 0..1 reflectance. Sentinel-2 values are 0..10000, so divide by 10000 before EVI. The result band is named after the index and keeps `SCENE_PROPS`. `ndvi()` in `landsat.js` stays for existing callers.
- `landsatSeries(plot, start, end, index = "NDVI")` and `sentinel2Series(…, index = "NDVI")` pass the index name to `meanSeries` as the band.
- Routes: `extrasOf` validates `index` with `paramOf("charts", "landsat-series", "index", b.index)`; omitted from `extras` when NDVI.
- Web: both cards send `index` from `params`, and use it in the title (`Landsat NDMI (click a point to view that scene)`), the series name and the CSV file name. The NDVI texts are unchanged.
- Live tests: each of NDMI, NBR, EVI returns points with finite values, for both sensors, on the Belize plot of the existing live tests.

Commit `collect-earth-explorer: Landsat and Sentinel-2 series for NDVI, NDMI, NBR and EVI`.

### Task 10: MODIS `index`, and collapsed charts

**Files:** `functions/ee/modisSeries.js`, `functions/routes.js`, tests; web `ModisCard.tsx`, `ChartCard.tsx`, the four cards, `web/src/index.css`

- `modisSeries(plot, start, end, index = "NDVI")`: MOD13Q1 has an `EVI` band with the same 0.0001 scale; select by `index`. The response key stays `ndvi` (the web type and the CSV depend on it); document that in a comment.
- `ChartCard` gets `collapsed?: boolean` and `onExpand?: () => void`: collapsed, it shows only the header with a "Show" button. Each card keeps `const [open, setOpen] = useState(!params.collapsed)` and passes `{ enabled: open }` to `useApi`, so a collapsed chart costs no request until it is opened.
- Tests: a collapsed chart makes no request; pressing Show makes one; MODIS EVI posts `index: "EVI"`.

Commit `collect-earth-explorer: MODIS EVI, and charts that start collapsed`.

### Task 11: Documentation and deploy

- `CLAUDE.md`: replace the "the code does not do that yet" paragraph with how it works now (catalogue file, `config` in the address, standard fallback, where to add a type). Add `catalogue` to the endpoint list.
- `README.md`: a short "Customizing per survey" section with one example document and the fragment address format.
- Run everything: `npm test`, `npm --prefix web run lint`, the live tests against the baseline.
- Deploy only when the user asks (`npm run deploy -- --project collectearth`; never `--force`, it would drop the cache TTL policy).

Commit `collect-earth-explorer: document per-survey customization`.

---

## Adding a catalogue type later (reference)

1. An entry in `functions/catalogue.json`.
2. An Earth Engine function in `functions/ee/` and a route in `functions/routes.js`.
3. For a layer: a branch in `useLayerTiles` and a label in `LayersPanel`. For a chart: a card component and a line in the type-to-card map.

## Follow-on plans (not in this plan)

- **Dashboard** (`collect-earth-cloud`): add `explorer_config` to `IMAGERY_KEYS` in `src/imagery.ts` with a JSON-and-size check (2,000 characters); an "Explorer" section in `web/src/project/ImageryCard.tsx` that loads `GET <explorer>/api/catalogue` (needs the dashboard's origin in the Explorer's `ALLOWED_ORIGINS`, or the catalogue route answering any origin since it is public and read-only); list editors for layers and charts; Reset; Preview on a sample plot; texts in en/es/fr/pt/tr.
- **Desktop** (`collect-earth-app`): `BrowserService.geeAppUrl` appends `config=<URL-encoded explorer_config>;` when the property is set; the default GEE app address changes to `https://explorer.collectearth.org/`; `AuxiliaryWindowUrlTest` covers both. Needs a desktop release.
