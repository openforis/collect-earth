# CE Earth Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `ce-earth-viewer`, a Firebase-hosted site that Collect Earth opens for a plot and that reproduces the `frames_landsat_v4_tempSegmentation` GEE app (maps, NDVI charts, CCDC) without requiring an Earth Engine login.

**Architecture:** React + Vite static frontend on Firebase Hosting calls `POST /api/*` JSON endpoints served by one Firebase Cloud Function (2nd gen, Express). The function authenticates to Earth Engine with a service account and ports the recipes from `ce_scripts/common/*` and `WiellTemporalSegmentation/*`. Firestore caches results per plot.

**Tech Stack:** Node 22 Cloud Functions in plain JavaScript (CommonJS, same conventions as `earth-map-cloud-functions`, so the Wiell CCDC library copies verbatim), `@google/earthengine`, Express 5, `firebase-functions` v2 API, Node's built-in test runner. Frontend: Vite, React 19, TypeScript, `maplibre-gl`, `@maplibre/maplibre-gl-compare`, `plotly.js-dist-min` + `react-plotly.js`, Vitest.

**Design doc:** `ce_scripts/docs/plans/2026-11-01-ce-earth-viewer-design.md`. Deviations from it, decided while planning:

- Backend is JavaScript, not TypeScript, so `temporalSegmentation` (1300 lines of ES5) and the `common/*` recipes port without a type pass. Frontend stays TypeScript.
- Landsat sensor per year: 1984 to 1998 Landsat 5, 1999 to 2012 Landsat 7, 2013 onward Landsat 8 merged with Landsat 9. Landsat 4 is dropped (Landsat 5 covers the same years with more scenes).
- MODIS NDVI uses `MODIS/061/MOD13Q1` (250 m) instead of `MOD13A2` (1 km); the GEE chart title already claimed 250 m.

**Reference sources** (read these when a task says "port"): `ce_scripts/common/SentinelLandsatImagery`, `common/sentinel2`, `common/utils`, `common/charts_v2`, `WiellTemporalSegmentation/uiChart`, `WiellTemporalSegmentation/temporalSegmentation`. Earth Map's EE auth pattern: `earth-map-cloud-functions/functions/EarthEngine/auth/eeAuth.js`.

**Conventions for every task**

- Repo root: `C:\Users\sanch\code\ce-earth-viewer`. Run commands from there unless a task says otherwise. On Windows use Git Bash for the commands below.
- Commit after every green step with the message shown. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Unit tests must not touch Earth Engine. Live EE tests live in `functions/test/live/` and run only with `EE_LIVE=1`.
- Never commit `functions/.secret.local` or any service-account JSON.

---

## Phase 0: Repository and cloud setup

### Task 0.1: Create the repo and workspace layout

**Files:**
- Create: `.gitignore`, `README.md`, `firebase.json`, `.firebaserc`

**Step 1: Create the repo**

```bash
mkdir -p /c/Users/sanch/code/ce-earth-viewer && cd /c/Users/sanch/code/ce-earth-viewer
git init -b main
mkdir -p functions web docs/plans
cp /c/Users/sanch/code/ce_scripts/docs/plans/2026-11-01-ce-earth-viewer-design.md docs/plans/
cp /c/Users/sanch/code/ce_scripts/docs/plans/2026-11-01-ce-earth-viewer-implementation.md docs/plans/
```

**Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
.firebase/
*.log
functions/.secret.local
functions/keys/
.env*
!.env.example
```

**Step 3: Write `firebase.json`**

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs22",
      "ignore": ["node_modules", ".git", "test", "*.log"]
    }
  ],
  "hosting": {
    "public": "web/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/api/**", "function": "api" },
      { "source": "**", "destination": "/index.html" }
    ]
  },
  "emulators": {
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": true }
  }
}
```

**Step 4: Write `.firebaserc`** (project id filled in Task 0.2)

```json
{ "projects": { "default": "ce-earth-viewer" } }
```

**Step 5: Write `README.md`**

```markdown
# CE Earth Viewer

Firebase-hosted viewer that Collect Earth opens for a plot. Replaces the GEE app
`users/collectearth/ce_scripts:frames_landsat_v4_tempSegmentation`.

## Run locally
    cd functions && npm install && cd ../web && npm install && cd ..
    # put the EE service-account key in functions/.secret.local (see docs/plans)
    npm --prefix web run build && firebase emulators:start
    # open http://localhost:5000/?geoJson=...&startTime=2000-01-01&endTime=2026-11-01&plot_id=test

## Tests
    npm --prefix functions test            # fast unit tests
    EE_LIVE=1 npm --prefix functions run test:live   # real Earth Engine
    npm --prefix web test
```

**Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold repo layout and firebase config"
```

### Task 0.2: Create the Firebase project and Earth Engine service account

This task is run by the user (needs browser logins). The engineer provides the commands and waits.

**Step 1: Create the project** (pick a globally unique id, e.g. `ce-earth-viewer`)

```bash
firebase login
firebase projects:create ce-earth-viewer --display-name "CE Earth Viewer"
firebase use ce-earth-viewer
gcloud config set project ce-earth-viewer
```

**Step 2: Upgrade to Blaze** in the Firebase console (Functions 2nd gen requires it). Then enable APIs:

```bash
gcloud services enable earthengine.googleapis.com cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com
gcloud firestore databases create --location=europe-west1
```

**Step 3: Register the project for Earth Engine** at https://code.earthengine.google.com/register (choose the Cloud project `ce-earth-viewer`, non-commercial or commercial as appropriate for FAO).

**Step 4: Create and register the service account**

```bash
gcloud iam service-accounts create ee-viewer --display-name "EE viewer backend"
gcloud projects add-iam-policy-binding ce-earth-viewer --member="serviceAccount:ee-viewer@ce-earth-viewer.iam.gserviceaccount.com" --role="roles/earthengine.writer"
gcloud projects add-iam-policy-binding ce-earth-viewer --member="serviceAccount:ee-viewer@ce-earth-viewer.iam.gserviceaccount.com" --role="roles/serviceusage.serviceUsageConsumer"
gcloud iam service-accounts keys create /c/Users/sanch/ee-viewer-key.json --iam-account=ee-viewer@ce-earth-viewer.iam.gserviceaccount.com
```

Then register the service account email at https://signup.earthengine.google.com/#!/service_accounts (only needed if the project registration did not already cover service accounts).

**Step 5: Store the key as a Functions secret and as the emulator secret**

```bash
firebase functions:secrets:set EE_KEY --data-file /c/Users/sanch/ee-viewer-key.json
printf 'EE_KEY=%s\n' "$(tr -d '\n' < /c/Users/sanch/ee-viewer-key.json)" > functions/.secret.local
```

Expected: `functions/.secret.local` is one line starting with `EE_KEY={"type":"service_account"`. It is gitignored.

---

## Phase 1: Backend skeleton

### Task 1.1: Functions package, Express app, health route

**Files:**
- Create: `functions/package.json`, `functions/index.js`, `functions/app.js`, `functions/test/app.test.js`

**Step 1: Write `functions/package.json`**

```json
{
  "name": "ce-earth-viewer-functions",
  "private": true,
  "version": "0.1.0",
  "engines": { "node": "22" },
  "main": "index.js",
  "scripts": {
    "test": "node --test \"test/*.test.js\" \"lib/**/*.test.js\"",
    "test:live": "node --test \"test/live/*.test.js\"",
    "serve": "firebase emulators:start --only functions,firestore",
    "logs": "firebase functions:log"
  },
  "dependencies": {
    "@google/earthengine": "^1.7.37",
    "@turf/area": "^7.2.0",
    "express": "^5.2.1",
    "firebase-admin": "^14.2.0",
    "firebase-functions": "^7.3.2"
  },
  "devDependencies": {
    "supertest": "^7.1.0"
  }
}
```

**Step 2: Write the failing test `functions/test/app.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../app");

test("GET /api/health returns ok", async () => {
  const res = await request(createApp()).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("unknown route returns JSON 404", async () => {
  const res = await request(createApp()).get("/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "not_found");
});
```

**Step 3: Run it to verify it fails**

```bash
cd functions && npm install && npm test
```
Expected: FAIL, `Cannot find module '../app'`.

**Step 4: Write `functions/app.js`**

```js
const express = require("express");

/** Maps any thrown error to the single JSON error shape of the API. */
function errorToResponse(err) {
  if (err && err.status && err.code) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, retryable: !!err.retryable } } };
  }
  const message = String((err && err.message) || err);
  const retryable = /timed out|too many concurrent|user memory limit|deadline/i.test(message);
  return {
    status: retryable ? 503 : 500,
    body: { error: { code: retryable ? "ee_busy" : "internal", message, retryable } },
  };
}

function createApp(registerRoutes) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  if (registerRoutes) registerRoutes(app);
  app.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found", retryable: false } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const { status, body } = errorToResponse(err);
    if (status >= 500) console.error(err);
    res.status(status).json(body);
  });
  return app;
}

/** Wraps an async handler so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { createApp, asyncHandler, errorToResponse };
```

**Step 5: Write `functions/index.js`**

```js
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { createApp } = require("./app");

const EE_KEY = defineSecret("EE_KEY");

let app;
function getApp() {
  if (!app) {
    const { registerRoutes } = require("./routes");
    app = createApp(registerRoutes);
  }
  return app;
}

exports.api = onRequest(
  { region: "europe-west1", secrets: [EE_KEY], timeoutSeconds: 300, memory: "1GiB", concurrency: 10 },
  (req, res) => getApp()(req, res)
);
```

`./routes` does not exist yet; it is created in Task 1.4. Until then `getApp` is only reached by the emulator, not by tests.

**Step 6: Run tests**

```bash
npm test
```
Expected: 2 passing.

**Step 7: Commit**

```bash
cd .. && git add functions && git commit -m "feat(functions): express app skeleton with health route"
```

### Task 1.2: Request parsing and plot validation

**Files:**
- Create: `functions/lib/plotRequest.js`, `functions/lib/plotRequest.test.js`

**Step 1: Write the failing tests**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePlotRequest, toPolygon } = require("./plotRequest");

const ring = [[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]];

test("converts Collect Earth MultiLineString to Polygon", () => {
  const poly = toPolygon({ type: "MultiLineString", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("accepts Polygon unchanged", () => {
  const poly = toPolygon({ type: "Polygon", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("parses a full request and clamps dates", () => {
  const r = parsePlotRequest({ plot: { type: "Polygon", coordinates: [ring] }, start: "1970-01-01", end: "2099-01-01" }, new Date("2026-11-01"));
  assert.equal(r.start, "1984-01-01");
  assert.equal(r.end, "2026-11-01");
  assert.equal(r.plot.type, "Polygon");
});

test("rejects missing plot", () => {
  assert.throws(() => parsePlotRequest({}), /plot/);
});

test("rejects plots larger than 100 ha", () => {
  const big = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]; // ~490 ha
  assert.throws(() => parsePlotRequest({ plot: { type: "Polygon", coordinates: [big] } }), /100 ha/);
});
```

**Step 2: Run to verify failure**

```bash
cd functions && npm test
```
Expected: FAIL, cannot find module `./plotRequest`.

**Step 3: Write `functions/lib/plotRequest.js`**

```js
const area = require("@turf/area").default;

const MIN_DATE = "1984-01-01";
const MAX_AREA_HA = 100;

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; this.code = "bad_request"; }
}

function toPolygon(geometry) {
  if (!geometry || typeof geometry !== "object") throw new BadRequest("plot geometry is required");
  if (geometry.type === "Polygon") return geometry;
  if (geometry.type === "MultiLineString" || geometry.type === "LineString") {
    const ring = geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates[0];
    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring : [...ring, ring[0]];
    return { type: "Polygon", coordinates: [closed] };
  }
  if (geometry.type === "Point") {
    const d = 0.0005; // ~55 m half-side square
    const [x, y] = geometry.coordinates;
    return { type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] };
  }
  throw new BadRequest(`unsupported plot geometry type ${geometry.type}`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function clampDate(value, fallback, min, max) {
  const s = typeof value === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) ? value : fallback;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequest(`invalid date ${value}`);
  if (d < new Date(min)) return min;
  if (d > new Date(max)) return max;
  return isoDate(d);
}

/** Validates and normalises the body shared by every endpoint. */
function parsePlotRequest(body, now = new Date()) {
  if (!body || !body.plot) throw new BadRequest("plot is required");
  const plot = toPolygon(body.plot);
  const ha = area(plot) / 10000;
  if (ha > MAX_AREA_HA) throw new BadRequest(`plot is ${ha.toFixed(0)} ha; maximum is ${MAX_AREA_HA} ha`);
  const today = isoDate(now);
  const start = clampDate(body.start, MIN_DATE, MIN_DATE, today);
  const end = clampDate(body.end, today, MIN_DATE, today);
  if (start > end) throw new BadRequest("start must be before end");
  return { plot, start, end, areaHa: ha };
}

module.exports = { parsePlotRequest, toPolygon, BadRequest, MIN_DATE };
```

**Step 4: Run tests**

```bash
npm test
```
Expected: all passing.

**Step 5: Commit**

```bash
cd .. && git add functions && git commit -m "feat(functions): plot request parsing and validation"
```

### Task 1.3: Earth Engine auth and promise helpers

**Files:**
- Create: `functions/ee/auth.js`, `functions/ee/promise.js`, `functions/test/live/auth.test.js`

**Step 1: Write `functions/ee/auth.js`** (pattern from Earth Map's `eeAuth.js`, single key from the secret)

```js
const ee = require("@google/earthengine");

let initialised = null;

function loadKey() {
  const raw = process.env.EE_KEY;
  if (!raw) throw new Error("EE_KEY secret is not set (functions/.secret.local for the emulator)");
  return JSON.parse(raw);
}

/** Authenticates once per process; later calls reuse the promise. */
function eeAuth() {
  if (!initialised) {
    initialised = new Promise((resolve, reject) => {
      ee.data.authenticateViaPrivateKey(
        loadKey(),
        () => ee.initialize(null, null, resolve, reject),
        reject
      );
    }).catch((err) => { initialised = null; throw err; });
  }
  return initialised;
}

module.exports = { eeAuth, ee };
```

**Step 2: Write `functions/ee/promise.js`**

```js
/** Promisified ee.ComputedObject.evaluate */
function evaluate(obj) {
  return new Promise((resolve, reject) => obj.evaluate((result, err) => (err ? reject(new Error(err)) : resolve(result))));
}

/** Promisified ee.Image.getMap; returns the XYZ tile URL template. */
function getTileUrl(image, visParams) {
  return new Promise((resolve, reject) =>
    image.getMap(visParams || {}, (map, err) => (err ? reject(new Error(err)) : resolve(map.urlFormat)))
  );
}

module.exports = { evaluate, getTileUrl };
```

**Step 3: Write the live test `functions/test/live/auth.test.js`**

```js
const { test, skip } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { evaluate } = require("../../ee/promise");

test("authenticates and evaluates a constant", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  assert.equal(await evaluate(ee.Number(2).add(3)), 5);
});
```

And `functions/test/live/loadSecret.js`, which reads `.secret.local` into `process.env` when running outside the emulator:

```js
const fs = require("node:fs");
const path = require("node:path");
if (!process.env.EE_KEY) {
  const file = path.join(__dirname, "..", "..", ".secret.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).trim();
    }
  }
}
```

**Step 4: Run the live test**

```bash
cd functions && EE_LIVE=1 npm run test:live
```
Expected: 1 passing (takes 2 to 5 s). If it fails with "not registered", finish Task 0.2 step 3/4.

**Step 5: Commit**

```bash
cd .. && git add functions && git commit -m "feat(functions): earth engine auth and promise helpers"
```

### Task 1.4: Routes module and the Sentinel-2 composite tile endpoint

**Files:**
- Create: `functions/ee/sentinel2.js`, `functions/ee/sentinel2Composite.js`, `functions/routes.js`, `functions/test/live/sentinel2Composite.test.js`, `functions/test/fixtures.js`

**Step 1: Write `functions/test/fixtures.js`** (the Belize rectangle from `charts_v2`)

```js
module.exports.belize = {
  type: "Polygon",
  coordinates: [[[-88.62590212565178, 16.783084290938486], [-88.62590212565178, 16.78260151389142], [-88.62554807406181, 16.78260151389142], [-88.62554807406181, 16.783084290938486], [-88.62590212565178, 16.783084290938486]]],
};
```

**Step 2: Write `functions/ee/sentinel2.js`** (port of `common/sentinel2`)

```js
const { ee } = require("./auth");

const CLOUD_SCORE_THRESHOLD = 0.6;
const CLOUD_PROBABILITY_THRESHOLD = 65;
const COMMON_BANDS = ["B2", "B3", "B4", "B6", "B8", "B8A", "B9", "B11", "B12", "QA60"];
const RENAMED = ["blue", "green", "red", "red2", "nir", "red4", "h2o", "swir1", "swir2", "QA60"];

function rename(img) { return img.select(COMMON_BANDS, RENAMED); }

function cloudScoreMask(image) {
  const cloudScore = ee.Image(image.get("cloudScore"));
  return cloudScore.gt(CLOUD_SCORE_THRESHOLD).reduce(ee.Reducer.min());
}

function maskWithCloudScore(collection) {
  return ee.ImageCollection(
    ee.Join.saveFirst({ matchKey: "cloudScore", outer: true }).apply({
      primary: collection.linkCollection({ imageCollection: ee.ImageCollection("COPERNICUS/S2_CLOUD_PROBABILITY"), linkedBands: ["probability"] }),
      secondary: ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"),
      condition: ee.Filter.equals({ leftField: "system:index", rightField: "system:index" }),
    })
  ).map((image) => {
    const mask = ee.Image(ee.Algorithms.If(image.get("cloudScore"), cloudScoreMask(image), image.select("probability").lt(CLOUD_PROBABILITY_THRESHOLD)));
    return rename(image).updateMask(mask);
  });
}

/** Sentinel-2 L1C harmonized scenes over the plot, bands renamed, optionally cloud-masked. */
function sentinel2Images(plot, start, end, { maxCloudyPercent = 70, mask = true } = {}) {
  let filter = ee.Filter.and(ee.Filter.date(start, end), ee.Filter.bounds(plot), ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", maxCloudyPercent));
  let col = ee.ImageCollection("COPERNICUS/S2_HARMONIZED").filter(filter).select(COMMON_BANDS);
  return mask ? maskWithCloudScore(col) : col.map(rename);
}

/** One scene by system:time_start, preferring the SR product when it exists. Port of getImageTimeStart. */
function sentinel2Scene(plot, timeStart) {
  const filter = ee.Filter.and(ee.Filter.bounds(plot), ee.Filter.equals("system:time_start", timeStart));
  const sr = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filter(filter);
  const toa = ee.ImageCollection(ee.Join.inverted().apply({
    primary: ee.ImageCollection("COPERNICUS/S2_HARMONIZED").filter(filter),
    secondary: sr,
    condition: ee.Filter.equals({ leftField: "system:index", rightField: "system:index" }),
  }));
  return ee.Image(sr.merge(toa).first());
}

const SENTINEL_FALSE_COLOUR = { bands: ["B8", "B11", "B4"], min: 0, max: 3000 };
const SENTINEL_FALSE_COLOUR_RENAMED = { bands: ["nir", "swir1", "red"], min: 0, max: 3000 };

module.exports = { sentinel2Images, sentinel2Scene, SENTINEL_FALSE_COLOUR, SENTINEL_FALSE_COLOUR_RENAMED };
```

**Step 3: Write `functions/ee/sentinel2Composite.js`** (port of the composite block in `frames_landsat_v4_tempSegmentation` plus `utils.sharpenSentinel`)

```js
const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { sentinel2Images, SENTINEL_FALSE_COLOUR_RENAMED } = require("./sentinel2");

function sharpen(image) {
  const log = image.convolve(ee.Kernel.gaussian(10, 7, "meters")).convolve(ee.Kernel.laplacian8(0.5));
  return image.subtract(log);
}

function monthsBefore(isoDate, months) {
  const d = new Date(isoDate);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Cloud-masked median of the 12 months ending at `end`, sharpened, false colour. */
async function sentinel2CompositeTiles(plot, end) {
  const start = monthsBefore(end, 12);
  const composite = sharpen(sentinel2Images(plot, start, end).median());
  const tileUrl = await getTileUrl(composite.visualize(SENTINEL_FALSE_COLOUR_RENAMED));
  return { tileUrl, label: `Sentinel-2 composite ${start} to ${end}`, dateRange: { start, end } };
}

module.exports = { sentinel2CompositeTiles, monthsBefore };
```

**Step 4: Write `functions/routes.js`**

```js
const { asyncHandler } = require("./app");
const { parsePlotRequest } = require("./lib/plotRequest");
const { eeAuth, ee } = require("./ee/auth");
const { sentinel2CompositeTiles } = require("./ee/sentinel2Composite");

/** Builds a POST handler: parse body, auth EE, run `compute(parsed, eeGeometry, body)`. */
function plotRoute(compute) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    await eeAuth();
    const geometry = ee.Geometry(parsed.plot);
    res.json(await compute(parsed, geometry, req.body));
  });
}

function registerRoutes(app) {
  app.post("/api/tiles/sentinel2", plotRoute((p, g) => sentinel2CompositeTiles(g, p.end)));
}

module.exports = { registerRoutes, plotRoute };
```

**Step 5: Write the live test `functions/test/live/sentinel2Composite.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { sentinel2CompositeTiles } = require("../../ee/sentinel2Composite");
const { belize } = require("../fixtures");

test("sentinel2 composite returns a tile url", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const r = await sentinel2CompositeTiles(ee.Geometry(belize), "2025-06-01");
  assert.match(r.tileUrl, /^https:\/\/earthengine\.googleapis\.com\/.*\{z\}\/\{x\}\/\{y\}/);
  assert.equal(r.dateRange.start, "2024-06-01");
});
```

**Step 6: Run live test and a manual emulator check**

```bash
cd functions && EE_LIVE=1 npm run test:live
```
Expected: 2 passing.

```bash
cd .. && firebase emulators:start --only functions &
sleep 15
curl -s -X POST http://127.0.0.1:5001/ce-earth-viewer/europe-west1/api/api/tiles/sentinel2 -H 'content-type: application/json' -d '{"plot":{"type":"Polygon","coordinates":[[[-88.6259,16.7831],[-88.6259,16.7826],[-88.6255,16.7826],[-88.6255,16.7831],[-88.6259,16.7831]]]},"end":"2025-06-01"}'
```
Expected: JSON with `tileUrl`. Note the doubled `/api/api/` path when calling the function directly; through Hosting the rewrite makes it `/api/...`.

**Step 7: Commit**

```bash
git add functions && git commit -m "feat(functions): sentinel-2 composite tiles endpoint"
```

---

## Phase 2: Frontend skeleton and first map

### Task 2.1: Vite React app with URL parsing

**Files:**
- Create: `web/` via Vite, `web/src/lib/urlParams.ts`, `web/src/lib/urlParams.test.ts`

**Step 1: Scaffold**

```bash
cd /c/Users/sanch/code/ce-earth-viewer
npm create vite@latest web -- --template react-ts
cd web && npm install
npm install maplibre-gl @maplibre/maplibre-gl-compare plotly.js-dist-min react-plotly.js
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/react-plotly.js @types/plotly.js
```

Add to `web/package.json` scripts: `"test": "vitest run"`, and to `web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:5000" } },
  test: { environment: "jsdom", globals: true },
});
```
(Add `/// <reference types="vitest" />` at the top of the file so `test` type-checks.)

**Step 2: Write the failing test `web/src/lib/urlParams.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parsePlotUrl, toPolygon } from "./urlParams";

const ring = [[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]];
const geoJson = JSON.stringify({ type: "MultiLineString", coordinates: [ring] });

describe("parsePlotUrl", () => {
  it("reads Collect Earth parameters", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}&startTime=2000-01-01&endTime=2026-11-01&plot_id=P42`, new Date("2026-11-01"));
    expect(p.plot.type).toBe("Polygon");
    expect(p.start).toBe("2000-01-01");
    expect(p.end).toBe("2026-11-01");
    expect(p.plotId).toBe("P42");
  });
  it("defaults dates and plot id", () => {
    const p = parsePlotUrl(`?geoJson=${encodeURIComponent(geoJson)}`, new Date("2026-11-01"));
    expect(p.start).toBe("1984-01-01");
    expect(p.end).toBe("2026-11-01");
    expect(p.plotId).toBe("");
  });
  it("throws when geoJson is missing", () => {
    expect(() => parsePlotUrl("?", new Date())).toThrow(/geoJson/);
  });
  it("closes an open ring", () => {
    const poly = toPolygon({ type: "MultiLineString", coordinates: [ring.slice(0, 4)] });
    expect(poly.coordinates[0].length).toBe(5);
  });
});
```

**Step 3: Run to verify failure**

```bash
npm test
```
Expected: FAIL, cannot resolve `./urlParams`.

**Step 4: Write `web/src/lib/urlParams.ts`**

```ts
export type Polygon = { type: "Polygon"; coordinates: number[][][] };
type AnyGeometry = { type: string; coordinates: any };

export interface PlotParams {
  plot: Polygon;
  start: string;
  end: string;
  plotId: string;
}

export function toPolygon(g: AnyGeometry): Polygon {
  if (g.type === "Polygon") return g as Polygon;
  if (g.type === "MultiLineString" || g.type === "LineString") {
    const ring: number[][] = g.type === "LineString" ? g.coordinates : g.coordinates[0];
    const first = ring[0], last = ring[ring.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    return { type: "Polygon", coordinates: [closed] };
  }
  throw new Error(`unsupported geometry ${g.type}`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function parsePlotUrl(search: string, now: Date = new Date()): PlotParams {
  const q = new URLSearchParams(search);
  const geoJson = q.get("geoJson");
  if (!geoJson) throw new Error("geoJson URL parameter is required");
  return {
    plot: toPolygon(JSON.parse(geoJson)),
    start: q.get("startTime") || "1984-01-01",
    end: q.get("endTime") || iso(now),
    plotId: q.get("plot_id") || "",
  };
}

export function polygonBounds(p: Polygon): [[number, number], [number, number]] {
  const xs = p.coordinates[0].map((c) => c[0]), ys = p.coordinates[0].map((c) => c[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}
```

**Step 5: Run tests**

```bash
npm test
```
Expected: 4 passing.

**Step 6: Commit**

```bash
cd .. && git add web && git commit -m "feat(web): vite react scaffold and collect earth url parsing"
```

### Task 2.2: API client and per-request status hook

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/hooks/useApi.ts`, `web/src/hooks/useApi.test.tsx`

**Step 1: Write `web/src/lib/api.ts`**

```ts
import type { Polygon } from "./urlParams";

export interface ApiError { code: string; message: string; retryable: boolean }
export class ApiFailure extends Error {
  constructor(public err: ApiError, public status: number) { super(err.message); }
}

export interface PlotBody { plot: Polygon; start: string; end: string }

export async function postApi<T>(path: string, body: PlotBody & Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({ error: { code: "bad_json", message: res.statusText, retryable: true } }));
  if (!res.ok) throw new ApiFailure(json.error, res.status);
  return json as T;
}

export interface TileResponse { tileUrl: string; label: string; dateRange?: { start: string; end: string }; sensor?: string }
```

**Step 2: Write the failing test `web/src/hooks/useApi.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useApi } from "./useApi";

describe("useApi", () => {
  it("goes loading -> done and retries on error", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: 1 });
    const { result } = renderHook(() => useApi(fn, ["k"]));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

**Step 3: Run to verify failure**

```bash
npm test
```
Expected: FAIL, cannot resolve `./useApi`.

**Step 4: Write `web/src/hooks/useApi.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

export type Status = "idle" | "loading" | "done" | "error";

export interface ApiState<T> { status: Status; data?: T; error?: Error; retry: () => void }

/** Runs `fn` when `deps` change; exposes status and a retry. Aborts stale runs. */
export function useApi<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<{ status: Status; data?: T; error?: Error }>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const ctrl = useRef<AbortController>();

  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ status: "loading" });
    fn(c.signal).then(
      (data) => !c.signal.aborted && setState({ status: "done", data }),
      (error) => !c.signal.aborted && setState({ status: "error", error })
    );
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry };
}
```

**Step 5: Run tests**

```bash
npm test
```
Expected: passing.

**Step 6: Commit**

```bash
cd .. && git add web && git commit -m "feat(web): api client and useApi status hook"
```

### Task 2.3: Plot context, map with outline and Sentinel-2 layer

**Files:**
- Create: `web/src/state/PlotContext.tsx`, `web/src/components/MapView.tsx`, `web/src/components/LayerSources.ts`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`, `web/src/index.css`

**Step 1: Write `web/src/state/PlotContext.tsx`**

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { parsePlotUrl, type PlotParams } from "../lib/urlParams";

export type LayerId = "sentinel2" | "landsat" | "scene";
export interface Scene { sensor: "landsat" | "sentinel2"; timeStart: number; label: string }

export interface PlotState extends PlotParams {
  activeLayer: LayerId;
  setActiveLayer: (l: LayerId) => void;
  landsatYear: number;
  setLandsatYear: (y: number) => void;
  scene?: Scene;
  setScene: (s: Scene) => void;
  compare: boolean;
  setCompare: (c: boolean) => void;
  compareLayer: LayerId;
  setCompareLayer: (l: LayerId) => void;
}

const Ctx = createContext<PlotState | null>(null);

export function PlotProvider({ children }: { children: ReactNode }) {
  const params = useMemo(() => parsePlotUrl(window.location.search), []);
  const [activeLayer, setActiveLayer] = useState<LayerId>("sentinel2");
  const [landsatYear, setLandsatYear] = useState(new Date(params.end).getUTCFullYear() - 1);
  const [scene, setSceneState] = useState<Scene>();
  const [compare, setCompare] = useState(false);
  const [compareLayer, setCompareLayer] = useState<LayerId>("landsat");
  const setScene = (s: Scene) => { setSceneState(s); setActiveLayer("scene"); };
  const value = { ...params, activeLayer, setActiveLayer, landsatYear, setLandsatYear, scene, setScene, compare, setCompare, compareLayer, setCompareLayer };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlot(): PlotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlot outside PlotProvider");
  return v;
}
```

**Step 2: Write `web/src/components/LayerSources.ts`** (one hook per imagery layer, returning a tile URL or status)

```ts
import { useApi } from "../hooks/useApi";
import { postApi, type TileResponse } from "../lib/api";
import { usePlot, type LayerId } from "../state/PlotContext";

export function useLayerTiles(layer: LayerId) {
  const { plot, start, end, landsatYear, scene } = usePlot();
  const key = layer === "landsat" ? landsatYear : layer === "scene" ? scene?.timeStart : "fixed";
  return useApi<TileResponse>((signal) => {
    if (layer === "sentinel2") return postApi("tiles/sentinel2", { plot, start, end }, signal);
    if (layer === "landsat") return postApi("tiles/landsat", { plot, start, end, year: landsatYear }, signal);
    if (!scene) return Promise.reject(new Error("no scene selected"));
    return postApi("tiles/scene", { plot, start, end, sensor: scene.sensor, timeStart: scene.timeStart }, signal);
  }, [layer, key, plot]);
}
```

**Step 3: Write `web/src/components/MapView.tsx`**

```tsx
import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { polygonBounds, type Polygon } from "../lib/urlParams";

export const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri", type: "raster", source: "esri" }],
};

export const IMAGERY_SOURCE = "imagery";

/** Replaces the imagery raster layer with a new tile URL, keeping the plot outline on top. */
export function setImagery(map: MlMap, tileUrl: string | undefined) {
  if (map.getLayer(IMAGERY_SOURCE)) map.removeLayer(IMAGERY_SOURCE);
  if (map.getSource(IMAGERY_SOURCE)) map.removeSource(IMAGERY_SOURCE);
  if (!tileUrl) return;
  map.addSource(IMAGERY_SOURCE, { type: "raster", tiles: [tileUrl], tileSize: 256 });
  map.addLayer({ id: IMAGERY_SOURCE, type: "raster", source: IMAGERY_SOURCE }, "plot-outline");
}

export function addPlotOutline(map: MlMap, plot: Polygon) {
  map.addSource("plot", { type: "geojson", data: { type: "Feature", geometry: plot, properties: {} } });
  map.addLayer({ id: "plot-outline", type: "line", source: "plot", paint: { "line-color": "#ffeb3b", "line-width": 2 } });
}

interface Props { plot: Polygon; tileUrl?: string; onMap?: (m: MlMap) => void }

export default function MapView({ plot, tileUrl, onMap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap>();

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: BASE_STYLE, bounds: polygonBounds(plot), fitBoundsOptions: { padding: 80, maxZoom: 16 } });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl(), "bottom-right");
    map.on("load", () => { addPlotOutline(map, plot); mapRef.current = map; onMap?.(map); setImagery(map, tileUrl); });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (mapRef.current?.isStyleLoaded()) setImagery(mapRef.current, tileUrl); }, [tileUrl]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
```

**Step 4: Write `web/src/App.tsx`**

```tsx
import { PlotProvider, usePlot } from "./state/PlotContext";
import MapView from "./components/MapView";
import { useLayerTiles } from "./components/LayerSources";

function Viewer() {
  const { plot, plotId, activeLayer } = usePlot();
  const tiles = useLayerTiles(activeLayer);
  return (
    <div className="viewer">
      <div className="map-pane">
        <MapView plot={plot} tileUrl={tiles.data?.tileUrl} />
        <div className="map-status">{tiles.status === "loading" ? "Loading imagery…" : tiles.status === "error" ? `Imagery failed: ${tiles.error?.message}` : tiles.data?.label}</div>
      </div>
      <aside className="side-pane"><h2>Plot {plotId || "(no id)"}</h2></aside>
    </div>
  );
}

export default function App() {
  try {
    return <PlotProvider><Viewer /></PlotProvider>;
  } catch (e) {
    return <p style={{ padding: 16 }}>{(e as Error).message}. Open this page from Collect Earth.</p>;
  }
}
```

Replace `web/src/index.css` with:

```css
html, body, #root { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
.viewer { display: flex; height: 100%; }
.map-pane { position: relative; flex: 1; min-width: 0; }
.side-pane { width: 420px; overflow-y: auto; padding: 12px 16px; border-left: 1px solid #ddd; box-sizing: border-box; }
.map-status { position: absolute; left: 8px; bottom: 8px; background: rgba(255,255,255,.9); padding: 4px 8px; border-radius: 4px; font-size: 12px; }
@media (max-width: 900px) {
  .viewer { flex-direction: column; }
  .map-pane { height: 50vh; flex: none; }
  .side-pane { width: auto; border-left: 0; border-top: 1px solid #ddd; }
}
```

Delete `web/src/App.css` and its import in `App.tsx` if Vite generated it.

**Step 5: Manual verification**

```bash
cd /c/Users/sanch/code/ce-earth-viewer
npm --prefix web run build && firebase emulators:start
```
Open `http://localhost:5000/?geoJson=%7B%22type%22%3A%22MultiLineString%22%2C%22coordinates%22%3A%5B%5B%5B30.169231%2C-2.066067%5D%2C%5B30.16986%2C-2.066067%5D%2C%5B30.16986%2C-2.0667%5D%2C%5B30.169231%2C-2.0667%5D%2C%5B30.169231%2C-2.066067%5D%5D%5D%7D&startTime=2000-01-01&plot_id=demo`

Expected: Esri basemap centred on the yellow plot outline in Rwanda, then within a few seconds a Sentinel-2 false-colour layer under the outline and the label "Sentinel-2 composite ... to ...".

For a dev loop with hot reload use `npm --prefix web run dev` (port 5173, proxied to the emulator at 5000).

**Step 6: Commit**

```bash
git add web && git commit -m "feat(web): map with plot outline and sentinel-2 composite layer"
```

---

## Phase 3: Landsat layer and layer switcher

### Task 3.1: Sensor-by-year lookup and Landsat composite tiles

**Files:**
- Create: `functions/lib/sensors.js`, `functions/lib/sensors.test.js`, `functions/ee/landsat.js`, `functions/ee/landsatComposite.js`, `functions/test/live/landsatComposite.test.js`
- Modify: `functions/routes.js`

**Step 1: Write the failing test `functions/lib/sensors.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sensorsForYear } = require("./sensors");

test("picks Landsat 5 before 1999", () => assert.deepEqual(sensorsForYear(1990), ["L5"]));
test("picks Landsat 7 from 1999 to 2012", () => { assert.deepEqual(sensorsForYear(1999), ["L7"]); assert.deepEqual(sensorsForYear(2012), ["L7"]); });
test("picks Landsat 8 from 2013, plus 9 from 2022", () => { assert.deepEqual(sensorsForYear(2013), ["L8"]); assert.deepEqual(sensorsForYear(2023), ["L8", "L9"]); });
test("rejects years before 1984", () => assert.throws(() => sensorsForYear(1983), /1984/));
```

**Step 2: Run to verify failure**

```bash
cd functions && npm test
```
Expected: FAIL, cannot find `./sensors`.

**Step 3: Write `functions/lib/sensors.js`**

```js
const SENSORS = {
  L5: { collection: "LANDSAT/LT05/C02/T1_L2", falseColour: ["SR_B4", "SR_B5", "SR_B3"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 5" },
  L7: { collection: "LANDSAT/LE07/C02/T1_L2", falseColour: ["SR_B4", "SR_B5", "SR_B3"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 7" },
  L8: { collection: "LANDSAT/LC08/C02/T1_L2", falseColour: ["SR_B5", "SR_B6", "SR_B4"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 8" },
  L9: { collection: "LANDSAT/LC09/C02/T1_L2", falseColour: ["SR_B5", "SR_B6", "SR_B4"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 9" },
};

/** Sensors used for the yearly composite of `year`. */
function sensorsForYear(year) {
  if (!Number.isInteger(year) || year < 1984) throw Object.assign(new Error("year must be 1984 or later"), { status: 400, code: "bad_request" });
  if (year < 1999) return ["L5"];
  if (year < 2013) return ["L7"];
  if (year < 2022) return ["L8"];
  return ["L8", "L9"];
}

module.exports = { SENSORS, sensorsForYear };
```

**Step 4: Write `functions/ee/landsat.js`** (shared masking/scaling, port of `maskLandsatSR` and `applyScaleFactors`)

```js
const { ee } = require("./auth");

/** QA_PIXEL bits 3 (shadow) and 5 (cloud) clear. */
function clearMask(image) {
  const qa = image.select("QA_PIXEL");
  return qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0));
}

/** Collection 2 Level 2 surface reflectance scaling. */
function scaleSr(image) {
  return image.select("SR_B.").multiply(0.0000275).add(-0.2).copyProperties(image, image.propertyNames());
}

function maskAndScale(image) {
  return ee.Image(scaleSr(image.updateMask(clearMask(image))));
}

module.exports = { clearMask, scaleSr, maskAndScale };
```

**Step 5: Write `functions/ee/landsatComposite.js`** (port of `getImageForCollection` default branch)

```js
const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { SENSORS, sensorsForYear } = require("../lib/sensors");
const { maskAndScale } = require("./landsat");

const MAX_CLOUD_COVER = 50;

function yearlyComposite(plot, year) {
  const ids = sensorsForYear(year);
  const cols = ids.map((id) => {
    const s = SENSORS[id];
    return ee.ImageCollection(s.collection)
      .filterBounds(plot)
      .filterDate(`${year}-01-01`, `${year}-12-31`)
      .filter(ee.Filter.lt(s.cloudProperty, MAX_CLOUD_COVER))
      .map(maskAndScale)
      .select(SENSORS[id].falseColour, ["nir", "swir", "red"]);
  });
  const merged = cols.slice(1).reduce((acc, c) => acc.merge(c), cols[0]);
  return { image: merged.median(), sensorNames: ids.map((id) => SENSORS[id].name) };
}

const LANDSAT_VIZ = { bands: ["nir", "swir", "red"], min: 0, max: 0.3 };

async function landsatCompositeTiles(plot, year) {
  const { image, sensorNames } = yearlyComposite(plot, year);
  const tileUrl = await getTileUrl(image.visualize(LANDSAT_VIZ));
  return { tileUrl, sensor: sensorNames.join(" + "), label: `${sensorNames.join("/")} ${year} composite` };
}

module.exports = { landsatCompositeTiles, yearlyComposite, LANDSAT_VIZ };
```

**Step 6: Register the route in `functions/routes.js`**

```js
const { landsatCompositeTiles } = require("./ee/landsatComposite");
// inside registerRoutes:
app.post("/api/tiles/landsat", plotRoute((p, g, body) => landsatCompositeTiles(g, Number(body.year))));
```

**Step 7: Live test `functions/test/live/landsatComposite.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { landsatCompositeTiles } = require("../../ee/landsatComposite");
const { belize } = require("../fixtures");

for (const year of [1990, 2005, 2023]) {
  test(`landsat composite ${year}`, { skip: !process.env.EE_LIVE }, async () => {
    await eeAuth();
    const r = await landsatCompositeTiles(ee.Geometry(belize), year);
    assert.match(r.tileUrl, /\{z\}\/\{x\}\/\{y\}/);
    assert.ok(r.label.includes(String(year)));
  });
}
```

**Step 8: Run tests**

```bash
npm test && EE_LIVE=1 npm run test:live
```
Expected: all passing.

**Step 9: Commit**

```bash
cd .. && git add functions && git commit -m "feat(functions): landsat yearly composite tiles with sensor-by-year"
```

### Task 3.2: Layers panel with radio group and year slider

**Files:**
- Create: `web/src/components/LayersPanel.tsx`
- Modify: `web/src/App.tsx`, `web/src/index.css`

**Step 1: Write `web/src/components/LayersPanel.tsx`**

```tsx
import { usePlot, type LayerId } from "../state/PlotContext";
import { useState, useEffect } from "react";

const MIN_YEAR = 1984;

export default function LayersPanel() {
  const p = usePlot();
  const maxYear = new Date(p.end).getUTCFullYear();
  const [draftYear, setDraftYear] = useState(p.landsatYear);
  useEffect(() => { const t = setTimeout(() => p.setLandsatYear(draftYear), 400); return () => clearTimeout(t); }, [draftYear]); // debounce slider

  const Radio = ({ id, label, disabled }: { id: LayerId; label: string; disabled?: boolean }) => (
    <label className="layer-row">
      <input type="radio" name="layer" checked={p.activeLayer === id} disabled={disabled} onChange={() => p.setActiveLayer(id)} /> {label}
    </label>
  );

  return (
    <div className="layers-panel">
      <strong>Layers</strong>
      <Radio id="sentinel2" label="Sentinel-2, last 12 months" />
      <Radio id="landsat" label={`Landsat ${draftYear}`} />
      <input type="range" min={MIN_YEAR} max={maxYear} value={draftYear} onChange={(e) => { setDraftYear(Number(e.target.value)); p.setActiveLayer("landsat"); }} style={{ width: "100%" }} />
      <Radio id="scene" label={p.scene ? `Scene: ${p.scene.label}` : "Scene (click a chart point)"} disabled={!p.scene} />
    </div>
  );
}
```

**Step 2: Mount it in `App.tsx`** inside `.map-pane` after `MapView`:

```tsx
import LayersPanel from "./components/LayersPanel";
// ...
<LayersPanel />
```

Add CSS:

```css
.layers-panel { position: absolute; top: 8px; left: 8px; background: rgba(255,255,255,.95); padding: 8px 10px; border-radius: 6px; font-size: 13px; width: 240px; display: flex; flex-direction: column; gap: 4px; }
.layer-row { display: flex; gap: 6px; align-items: center; }
```

**Step 3: Manual verification**

Rebuild and open the demo URL. Expected: switching to Landsat loads a composite for the year before `endTime`; moving the slider changes it after a short pause; the label at the bottom names the sensor.

**Step 4: Commit**

```bash
git add web && git commit -m "feat(web): layers panel with landsat year slider"
```

---

## Phase 4: Time series endpoints

### Task 4.1: Shared series helper and MODIS endpoint

**Files:**
- Create: `functions/ee/series.js`, `functions/lib/series.test.js`, `functions/ee/modisSeries.js`, `functions/test/live/modisSeries.test.js`
- Modify: `functions/routes.js`

**Step 1: Write the failing test `functions/lib/series.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { featuresToPoints } = require("../ee/series");

test("featuresToPoints drops nulls and sorts by date", () => {
  const fc = { features: [
    { properties: { date: 200, value: 0.5, id: "b" } },
    { properties: { date: 100, value: null, id: "a" } },
    { properties: { date: 50, value: 0.1, id: "c" } },
  ] };
  assert.deepEqual(featuresToPoints(fc), [{ date: 50, value: 0.1, id: "c" }, { date: 200, value: 0.5, id: "b" }]);
});
```

**Step 2: Run to verify failure**

```bash
cd functions && npm test
```
Expected: FAIL.

**Step 3: Write `functions/ee/series.js`**

```js
const { ee } = require("./auth");
const { evaluate } = require("./promise");

/**
 * Reduces one band of every image to its mean over `plot` and returns an
 * ee.FeatureCollection with properties {date, value, id, ...extra(image)}.
 */
function meanSeries(collection, band, plot, scale, extra) {
  return ee.FeatureCollection(collection.map((img) => {
    const mean = img.select(band).reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot, scale, maxPixels: 1e8 }).get(band);
    const props = Object.assign({ date: img.get("system:time_start"), value: mean, id: img.get("system:index") }, extra ? extra(img) : {});
    return ee.Feature(null, props);
  }));
}

/** Client-side reshaping of an evaluated FeatureCollection into sorted points. */
function featuresToPoints(fc) {
  return fc.features
    .map((f) => f.properties)
    .filter((p) => p.value !== null && p.value !== undefined && Number.isFinite(p.value))
    .sort((a, b) => a.date - b.date);
}

async function evaluateSeries(fc) {
  return featuresToPoints(await evaluate(fc));
}

module.exports = { meanSeries, featuresToPoints, evaluateSeries };
```

**Step 4: Write `functions/ee/modisSeries.js`** (port of `getModis16DayNDVI` and `getBurnedArea`)

```js
const { ee } = require("./auth");
const { meanSeries, evaluateSeries } = require("./series");
const { evaluate } = require("./promise");

async function modisSeries(plot, start, end) {
  const ndviCol = ee.ImageCollection("MODIS/061/MOD13Q1").filterDate(start, end).select("NDVI").map((img) => img.multiply(0.0001).copyProperties(img, ["system:time_start", "system:index"]));
  const ndvi = evaluateSeries(meanSeries(ndviCol, "NDVI", plot, 250));

  // MCD64A1: monthly images, BurnDate = day of year of the burn, 0 = no burn.
  const burned = ee.ImageCollection("MODIS/061/MCD64A1").filterDate(start, end).select("BurnDate");
  const fireFc = ee.FeatureCollection(burned.map((img) => {
    const maxBurn = img.unmask().reduceRegion({ reducer: ee.Reducer.max(), geometry: plot, scale: 500 }).get("BurnDate");
    return ee.Feature(null, { month: img.get("system:time_start"), burnDoy: maxBurn });
  })).filter(ee.Filter.gt("burnDoy", 0));
  const fires = evaluate(fireFc).then((fc) => fc.features.map((f) => {
    const monthDate = new Date(f.properties.month);
    const burnDate = Date.UTC(monthDate.getUTCFullYear(), 0, f.properties.burnDoy);
    return { month: f.properties.month, date: burnDate };
  }));

  const [ndviPoints, firePoints] = await Promise.all([ndvi, fires]);
  return { ndvi: ndviPoints, fires: firePoints };
}

module.exports = { modisSeries };
```

**Step 5: Route**

```js
const { modisSeries } = require("./ee/modisSeries");
app.post("/api/series/modis", plotRoute((p, g) => modisSeries(g, p.start, p.end)));
```

**Step 6: Live test `functions/test/live/modisSeries.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { modisSeries } = require("../../ee/modisSeries");
const { belize } = require("../fixtures");

test("modis series has ndvi points in range", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const r = await modisSeries(ee.Geometry(belize), "2020-01-01", "2021-01-01");
  assert.ok(r.ndvi.length >= 20, `got ${r.ndvi.length} points`);
  for (const p of r.ndvi) { assert.ok(p.value >= -1 && p.value <= 1); }
  assert.ok(r.ndvi.every((p, i) => i === 0 || p.date > r.ndvi[i - 1].date));
  assert.ok(Array.isArray(r.fires));
});
```

**Step 7: Run tests, commit**

```bash
npm test && EE_LIVE=1 npm run test:live
cd .. && git add functions && git commit -m "feat(functions): modis ndvi and burned area series"
```

### Task 4.2: Landsat NDVI series and scene lookup

**Files:**
- Create: `functions/ee/landsatSeries.js`, `functions/test/live/landsatSeries.test.js`
- Modify: `functions/ee/landsat.js`, `functions/routes.js`

**Step 1: Add the merged collection to `functions/ee/landsat.js`** (port of `getLandsatImagery`, `getMergedLandsat`, `harmonizationRoy`)

```js
const L7_THRESHOLD = "2015-01-01";   // L7 used before, L8 after (same cut as charts_v2)
const L5_THRESHOLD = "1999-12-31";
const L9_START = "2023-11-01";

/** Roy et al. 2016 RMA coefficients, OLI to ETM+ (expects scaled reflectance). */
function harmonizeOli(oli) {
  const slopes = ee.Image.constant([0.9785, 0.9542, 0.9825, 1.0073, 1.0171, 0.9949]);
  const itcp = ee.Image.constant([-0.0095, -0.0016, -0.0022, -0.0021, -0.0030, 0.0029]);
  return oli.select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"], ["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7"]).subtract(itcp).divide(slopes);
}

function prepared(collectionId, plot, start, end, { mask, harmonize }) {
  return ee.ImageCollection(collectionId).filterBounds(plot).filterDate(start, end).map((img) => {
    let sr = img.select("SR_B.").multiply(0.0000275).add(-0.2);
    if (harmonize) sr = harmonizeOli(sr);
    let out = sr.select(["SR_B4", "SR_B5", "SR_B3"], ["nir", "swir", "red"]);
    if (mask) out = out.updateMask(clearMask(img));
    return out.copyProperties(img, ["system:time_start", "system:index", "SPACECRAFT_ID"]);
  });
}

/** Landsat 5/7/8/9 scenes over the plot for [start, end], one sensor per period. */
function mergedLandsat(plot, start, end, mask) {
  const parts = [];
  if (end > L9_START) parts.push(prepared("LANDSAT/LC09/C02/T1_L2", plot, L9_START, end, { mask, harmonize: true }));
  if (end > L7_THRESHOLD) parts.push(prepared("LANDSAT/LC08/C02/T1_L2", plot, start > L7_THRESHOLD ? start : L7_THRESHOLD, end, { mask, harmonize: true }));
  if (start < L7_THRESHOLD) parts.push(prepared("LANDSAT/LE07/C02/T1_L2", plot, start, end > L7_THRESHOLD ? L7_THRESHOLD : end, { mask, harmonize: false }));
  if (start < L5_THRESHOLD) parts.push(prepared("LANDSAT/LT05/C02/T1_L2", plot, start, end > L5_THRESHOLD ? L5_THRESHOLD : end, { mask, harmonize: false }));
  return parts.slice(1).reduce((acc, c) => acc.merge(c), parts[0]);
}

function ndvi(img) {
  return img.normalizedDifference(["nir", "red"]).rename("NDVI").copyProperties(img, ["system:time_start", "system:index", "SPACECRAFT_ID"]);
}

module.exports = { clearMask, scaleSr, maskAndScale, mergedLandsat, ndvi, harmonizeOli };
```

**Step 2: Write `functions/ee/landsatSeries.js`**

```js
const { ee } = require("./auth");
const { mergedLandsat, ndvi } = require("./landsat");
const { meanSeries, evaluateSeries } = require("./series");

async function landsatSeries(plot, start, end) {
  const col = mergedLandsat(plot, start, end, true).map(ndvi);
  const points = await evaluateSeries(meanSeries(col, "NDVI", plot, 30, (img) => ({ sensor: img.get("SPACECRAFT_ID") })));
  return { points };
}

module.exports = { landsatSeries };
```

**Step 3: Route**

```js
const { landsatSeries } = require("./ee/landsatSeries");
app.post("/api/series/landsat", plotRoute((p, g) => landsatSeries(g, p.start, p.end)));
```

**Step 4: Live test `functions/test/live/landsatSeries.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { landsatSeries } = require("../../ee/landsatSeries");
const { belize } = require("../fixtures");

test("landsat series spans sensors", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const { points } = await landsatSeries(ee.Geometry(belize), "2012-01-01", "2016-01-01");
  assert.ok(points.length >= 20, `got ${points.length}`);
  const sensors = new Set(points.map((p) => p.sensor));
  assert.ok(sensors.has("LANDSAT_7") && sensors.has("LANDSAT_8"), [...sensors].join());
  for (const p of points) assert.ok(p.value >= -1 && p.value <= 1 && Number.isInteger(p.date));
});
```

**Step 5: Run, commit**

```bash
cd functions && npm test && EE_LIVE=1 npm run test:live
cd .. && git add functions && git commit -m "feat(functions): landsat ndvi series across sensors"
```

### Task 4.3: Sentinel-2 NDVI series and scene tiles endpoint

**Files:**
- Create: `functions/ee/sentinel2Series.js`, `functions/ee/scene.js`, `functions/test/live/scene.test.js`
- Modify: `functions/routes.js`

**Step 1: Write `functions/ee/sentinel2Series.js`**

```js
const { sentinel2Images } = require("./sentinel2");
const { ndvi } = require("./landsat");
const { meanSeries, evaluateSeries } = require("./series");

async function sentinel2Series(plot, start, end) {
  const col = sentinel2Images(plot, start < "2015-06-23" ? "2015-06-23" : start, end).map(ndvi);
  const points = await evaluateSeries(meanSeries(col, "NDVI", plot, 10));
  return { points };
}

module.exports = { sentinel2Series };
```

(`ndvi` from `landsat.js` works because both collections use `nir`/`red` band names; `copyProperties` of a missing `SPACECRAFT_ID` is harmless.)

**Step 2: Write `functions/ee/scene.js`**

```js
const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { mergedLandsat } = require("./landsat");
const { LANDSAT_VIZ } = require("./landsatComposite");
const { sentinel2Scene, SENTINEL_FALSE_COLOUR } = require("./sentinel2");
const { BadRequest } = require("../lib/plotRequest");

async function sceneTiles(plot, start, end, sensor, timeStart) {
  if (!Number.isFinite(timeStart)) throw new BadRequest("timeStart (ms since epoch) is required");
  const date = new Date(timeStart).toISOString().slice(0, 10);
  let image, label;
  if (sensor === "landsat") {
    image = ee.Image(mergedLandsat(plot, start, end, false).filter(ee.Filter.equals("system:time_start", timeStart)).first()).visualize(LANDSAT_VIZ);
    label = `Landsat ${date}`;
  } else if (sensor === "sentinel2") {
    image = sentinel2Scene(plot, timeStart).visualize(SENTINEL_FALSE_COLOUR);
    label = `Sentinel-2 ${date}`;
  } else {
    throw new BadRequest("sensor must be landsat or sentinel2");
  }
  return { tileUrl: await getTileUrl(image), label, sensor };
}

module.exports = { sceneTiles };
```

**Step 3: Routes**

```js
const { sentinel2Series } = require("./ee/sentinel2Series");
const { sceneTiles } = require("./ee/scene");
app.post("/api/series/sentinel2", plotRoute((p, g) => sentinel2Series(g, p.start, p.end)));
app.post("/api/tiles/scene", plotRoute((p, g, body) => sceneTiles(g, p.start, p.end, body.sensor, Number(body.timeStart))));
```

**Step 4: Live test `functions/test/live/scene.test.js`** (uses the series to find a real timeStart, then fetches its tiles)

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { sentinel2Series } = require("../../ee/sentinel2Series");
const { landsatSeries } = require("../../ee/landsatSeries");
const { sceneTiles } = require("../../ee/scene");
const { belize } = require("../fixtures");

test("sentinel2 series then scene tiles", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  const { points } = await sentinel2Series(g, "2022-01-01", "2022-07-01");
  assert.ok(points.length >= 5);
  const r = await sceneTiles(g, "2022-01-01", "2022-07-01", "sentinel2", points[0].date);
  assert.match(r.tileUrl, /\{z\}/);
  assert.equal(r.label, `Sentinel-2 ${new Date(points[0].date).toISOString().slice(0, 10)}`);
});

test("landsat scene tiles", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  const g = ee.Geometry(belize);
  const { points } = await landsatSeries(g, "2021-01-01", "2021-07-01");
  const r = await sceneTiles(g, "2021-01-01", "2021-07-01", "landsat", points[0].date);
  assert.match(r.tileUrl, /\{z\}/);
});
```

**Step 5: Run, commit**

```bash
cd functions && npm test && EE_LIVE=1 npm run test:live
cd .. && git add functions && git commit -m "feat(functions): sentinel-2 ndvi series and single scene tiles"
```

---

## Phase 5: Chart cards in the frontend

### Task 5.1: ChartCard shell and Plotly wrapper

**Files:**
- Create: `web/src/components/ChartCard.tsx`, `web/src/components/Plot.tsx`, `web/src/lib/csv.ts`, `web/src/lib/csv.test.ts`

**Step 1: Write the failing test `web/src/lib/csv.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { pointsToCsv } from "./csv";

describe("pointsToCsv", () => {
  it("writes ISO dates and values", () => {
    const csv = pointsToCsv([{ date: Date.UTC(2020, 0, 2), value: 0.5, sensor: "LANDSAT_8" }], ["sensor"]);
    expect(csv).toBe("date,value,sensor\n2020-01-02,0.5,LANDSAT_8\n");
  });
});
```

**Step 2: Run to verify failure, then write `web/src/lib/csv.ts`**

```ts
export interface Point { date: number; value: number; [k: string]: unknown }

export function pointsToCsv(points: Point[], extraCols: string[] = []): string {
  const header = ["date", "value", ...extraCols].join(",");
  const rows = points.map((p) => [new Date(p.date).toISOString().slice(0, 10), p.value, ...extraCols.map((c) => p[c] ?? "")].join(","));
  return header + "\n" + rows.join("\n") + "\n";
}

export function downloadText(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

**Step 3: Write `web/src/components/Plot.tsx`**

```tsx
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";
const Plot = createPlotlyComponent(Plotly);
export default Plot;
```

If TypeScript complains about `plotly.js-dist-min` types, add `web/src/plotly-dist.d.ts` with `declare module "plotly.js-dist-min";`.

**Step 4: Write `web/src/components/ChartCard.tsx`**

```tsx
import type { ReactNode } from "react";
import type { ApiState } from "../hooks/useApi";

interface Props<T> { title: string; state: ApiState<T>; onDownload?: () => void; controls?: ReactNode; children: (data: T) => ReactNode }

export default function ChartCard<T>({ title, state, onDownload, controls, children }: Props<T>) {
  return (
    <section className="chart-card">
      <header className="chart-card-header">
        <h3>{title}</h3>
        <div className="chart-card-actions">{controls}{state.status === "done" && onDownload && <button onClick={onDownload}>CSV</button>}</div>
      </header>
      {state.status === "loading" && <div className="chart-placeholder"><span className="spinner" /> Computing…</div>}
      {state.status === "error" && (
        <div className="chart-placeholder chart-error">
          {state.error?.message}
          <button onClick={state.retry}>Retry</button>
        </div>
      )}
      {state.status === "done" && state.data && children(state.data)}
    </section>
  );
}
```

CSS to append:

```css
.chart-card { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 12px; background: #fff; }
.chart-card-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid #eee; }
.chart-card-header h3 { margin: 0; font-size: 14px; }
.chart-card-actions { display: flex; gap: 6px; align-items: center; }
.chart-placeholder { height: 220px; display: flex; gap: 8px; align-items: center; justify-content: center; color: #666; font-size: 13px; }
.chart-error { color: #b00020; flex-direction: column; }
.spinner { width: 14px; height: 14px; border: 2px solid #ccc; border-top-color: #333; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

**Step 5: Run `npm test`, commit**

```bash
git add web && git commit -m "feat(web): chart card shell, plotly wrapper, csv export"
```

### Task 5.2: NDVI series cards with click-to-load scene

**Files:**
- Create: `web/src/components/charts/SeriesChart.tsx`, `web/src/components/charts/LandsatNdviCard.tsx`, `web/src/components/charts/Sentinel2NdviCard.tsx`, `web/src/components/charts/ModisCard.tsx`
- Modify: `web/src/App.tsx`

**Step 1: Write `web/src/components/charts/SeriesChart.tsx`**

```tsx
import Plot from "../Plot";
import type { Point } from "../../lib/csv";

interface Props { points: Point[]; name: string; color?: string; markers?: { x: number[]; name: string; color: string }; onClickPoint?: (p: Point) => void; yRange?: [number, number] }

export default function SeriesChart({ points, name, color = "#2e7d32", markers, onClickPoint, yRange = [-0.25, 1] }: Props) {
  const data: Plotly.Data[] = [{
    x: points.map((p) => new Date(p.date)), y: points.map((p) => p.value), type: "scatter", mode: "lines+markers", name,
    marker: { size: 5, color }, line: { width: 1, color }, hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>",
  }];
  if (markers && markers.x.length) {
    data.push({ x: markers.x.map((t) => new Date(t)), y: markers.x.map(() => yRange[1]), type: "scatter", mode: "markers", name: markers.name, marker: { symbol: "triangle-down", size: 10, color: markers.color }, hovertemplate: "%{x|%Y-%m-%d}<extra>" + markers.name + "</extra>" });
  }
  return (
    <Plot
      data={data}
      layout={{ height: 240, margin: { l: 40, r: 10, t: 10, b: 40 }, yaxis: { range: yRange }, legend: { orientation: "h", y: -0.25 }, hovermode: "closest" }}
      config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }}
      style={{ width: "100%" }}
      onClick={(e) => { const i = e.points[0]?.pointIndex; if (onClickPoint && e.points[0]?.curveNumber === 0 && i !== undefined) onClickPoint(points[i]); }}
    />
  );
}
```

**Step 2: Write `web/src/components/charts/LandsatNdviCard.tsx`**

```tsx
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

export default function LandsatNdviCard() {
  const { plot, start, end, plotId, setScene } = usePlot();
  const state = useApi<{ points: Point[] }>((s) => postApi("series/landsat", { plot, start, end }, s), [plot, start, end]);
  return (
    <ChartCard title="Landsat NDVI (click a point to view that scene)" state={state} onDownload={() => downloadText(`${plotId || "plot"}-landsat-ndvi.csv`, pointsToCsv(state.data!.points, ["sensor"]))}>
      {(d) => <SeriesChart points={d.points} name="NDVI" onClickPoint={(p) => setScene({ sensor: "landsat", timeStart: p.date, label: `${String(p.sensor).replace("_", " ")} ${new Date(p.date).toISOString().slice(0, 10)}` })} />}
    </ChartCard>
  );
}
```

**Step 3: Write `Sentinel2NdviCard.tsx`** (same shape, endpoint `series/sentinel2`, sensor `"sentinel2"`, label `Sentinel-2 <date>`, title "Sentinel-2 NDVI (click a point to view that scene)", no extra CSV column.)

**Step 4: Write `ModisCard.tsx`**

```tsx
import ChartCard from "../ChartCard";
import SeriesChart from "./SeriesChart";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

interface Modis { ndvi: Point[]; fires: { month: number; date: number }[] }

export default function ModisCard() {
  const { plot, start, end, plotId } = usePlot();
  const state = useApi<Modis>((s) => postApi("series/modis", { plot, start, end }, s), [plot, start, end]);
  return (
    <ChartCard title="MODIS 16-day NDVI (250 m) and burned area" state={state} onDownload={() => downloadText(`${plotId || "plot"}-modis-ndvi.csv`, pointsToCsv(state.data!.ndvi))}>
      {(d) => <SeriesChart points={d.ndvi} name="MODIS NDVI" color="#1565c0" markers={{ x: d.fires.map((f) => f.date), name: "Burned (MCD64A1)", color: "#d32f2f" }} />}
    </ChartCard>
  );
}
```

**Step 5: Mount the cards in `App.tsx`** inside `.side-pane` after the heading:

```tsx
<p className="dates">{start} to {end}</p>
<LandsatNdviCard />
<Sentinel2NdviCard />
<ModisCard />
```

**Step 6: Manual verification**

Rebuild, open the demo URL. Expected: three cards appear with spinners; MODIS fills first, then Sentinel-2, then Landsat. Clicking a Landsat point switches the map to that scene and the Layers panel shows "Scene: LANDSAT 8 2021-03-04". Retry works if a card errors (test by stopping the emulator mid-load).

**Step 7: Commit**

```bash
git add web && git commit -m "feat(web): ndvi and modis chart cards with click-to-load scene"
```

---

## Phase 6: CCDC temporal segmentation

### Task 6.1: Vendor the Wiell library and build the CCDC endpoint

**Files:**
- Create: `functions/ee/vendor/temporalSegmentation.js` (copied), `functions/ee/ccdc.js`, `functions/lib/ccdcShape.js`, `functions/lib/ccdcShape.test.js`, `functions/test/live/ccdc.test.js`
- Modify: `functions/routes.js`

**Step 1: Copy the library and make it a CommonJS module**

```bash
cp /c/Users/sanch/code/ce_scripts/WiellTemporalSegmentation/temporalSegmentation functions/ee/vendor/temporalSegmentation.js
```

Then apply exactly three edits in `functions/ee/vendor/temporalSegmentation.js`:

1. Add as the first line: `const ee = require("@google/earthengine");`
2. In `chartPoint(args)`, replace the line `chartFeatures(features, callback)` with:
   ```js
   if (args.returnFeatures) return features
   chartFeatures(features, callback)
   ```
3. Replace the final `exports = {` with `module.exports = {`.

The file keeps its ES5 style; do not reformat it (it is a vendored copy, header comment says where from).

**Step 2: Write the failing test `functions/lib/ccdcShape.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shapeCcdc, jDaysToMillis } = require("./ccdcShape");

test("jDaysToMillis converts the matlab epoch", () => {
  assert.equal(jDaysToMillis(719529), 0);
  assert.equal(jDaysToMillis(719530), 86400000);
});

test("shapeCcdc splits raw and segment features", () => {
  const fc = { features: [
    { properties: { date: { type: "Date", value: 100 }, raw: 5000 } },
    { properties: { date: { type: "Date", value: 200 }, segments: [{ value: 4000 }, {}] } },
    { properties: { date: { type: "Date", value: 300 }, segments: [{}, { value: 3000 }] } },
  ] };
  const out = shapeCcdc(fc, [719530, 0]);
  assert.deepEqual(out.observed, [{ date: 100, value: 0.5 }]);
  assert.deepEqual(out.segments, [[{ date: 200, value: 0.4 }], [{ date: 300, value: 0.3 }]]);
  assert.deepEqual(out.breaks, [86400000]);
});
```

**Step 3: Run to verify failure, then write `functions/lib/ccdcShape.js`**

```js
const EPOCH_DAY = 719529; // Wiell library J_DAYS epoch (days since 0000-01-00)

function jDaysToMillis(t) { return Math.round((t - EPOCH_DAY) * 86400000); }

/** Reshapes evaluated chartPoint features (values scaled x10000) into chart JSON. */
function shapeCcdc(fc, tBreaks) {
  const observed = [];
  const segments = [];
  for (const { properties: p } of fc.features) {
    const date = p.date && typeof p.date === "object" ? p.date.value : p.date;
    if (p.raw !== undefined && p.raw !== null) observed.push({ date, value: p.raw / 10000 });
    if (Array.isArray(p.segments)) {
      p.segments.forEach((s, i) => {
        if (s && s.value !== undefined && s.value !== null) {
          (segments[i] = segments[i] || []).push({ date, value: s.value / 10000 });
        }
      });
    }
  }
  observed.sort((a, b) => a.date - b.date);
  for (const s of segments) if (s) s.sort((a, b) => a.date - b.date);
  const breaks = (tBreaks || []).filter((t) => t > 0).map(jDaysToMillis);
  return { observed, segments: segments.map((s) => s || []), breaks };
}

module.exports = { shapeCcdc, jDaysToMillis };
```

**Step 4: Write `functions/ee/ccdc.js`** (port of `uiChart.chartPlot` and `createLandsatCollection`)

```js
const { ee } = require("./auth");
const { evaluate } = require("./promise");
const ts = require("./vendor/temporalSegmentation");
const { shapeCcdc } = require("../lib/ccdcShape");
const { BadRequest } = require("../lib/plotRequest");

const BANDS = ["blue", "green", "red", "nir", "swir1", "swir2"];

function toNdfi(image) {
  const gv = [500, 900, 400, 6100, 3000, 1000], shade = [0, 0, 0, 0, 0, 0], npv = [1400, 1700, 2200, 3000, 5500, 3000];
  const soil = [2000, 3000, 3400, 5800, 6000, 5800], cloud = [9000, 9600, 8000, 7800, 7200, 6500];
  const unmixed = ee.Image(image).select(BANDS).unmix({ endmembers: [gv, shade, npv, soil, cloud], sumToOne: true, nonNegative: true }).rename(["gv", "shade", "npv", "soil", "cloud"]);
  return unmixed.expression("((i.gv / (1 - i.shade)) - (i.npv + i.soil)) / ((i.gv / (1 - i.shade)) + i.npv + i.soil)", { i: unmixed }).multiply(10000).rename("NDFI");
}

function toNdvi(image) { return ee.Image(image).normalizedDifference(["nir", "red"]).multiply(10000).rename("NDVI"); }

function maskLandsat(image) {
  const qa = image.select("pixel_qa");
  return image.updateMask(qa.bitwiseAnd(1 << 3).eq(0).and(qa.bitwiseAnd(1 << 5).eq(0)));
}

/** Landsat 7/8/9 C2 L2 over the plot, bands renamed, each image reduced to its plot mean as a constant image. */
function landsatCollection(plot, start, end, band) {
  const filter = ee.Filter.and(ee.Filter.bounds(plot), ee.Filter.date(start, end));
  const named = [...BANDS, "pixel_qa"];
  const l7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filter(filter).select(["SR_B1", "SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B7", "QA_PIXEL"], named);
  const l8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filter(filter).select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7", "QA_PIXEL"], named);
  const l9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filter(filter).select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7", "QA_PIXEL"], named);
  return l7.merge(l8).merge(l9).map((raw) => {
    const masked = maskLandsat(raw).select(BANDS);
    const scaled = ee.Image(masked.multiply(0.0000275).add(-0.2).multiply(10000).toInt32().copyProperties(raw, raw.propertyNames()));
    const withIndex = scaled.addBands(band === "NDVI" ? toNdvi(scaled) : toNdfi(scaled));
    return ee.Image(withIndex.reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot, scale: 30 }).toImage().int16().copyProperties(raw, raw.propertyNames()));
  }).sort("system:time_start");
}

async function ccdcSeries(plot, start, end, band) {
  if (band !== "NDFI" && band !== "NDVI") throw new BadRequest("band must be NDFI or NDVI");
  const collection = landsatCollection(plot, start, end, band);
  const ccdc = ee.Algorithms.TemporalSegmentation.Ccdc({ collection, breakpointBands: [band] });
  const features = ts.chartPoint({ image: ccdc, point: plot, bandName: band, collection, returnFeatures: true });
  const tBreak = ee.Array(ccdc.select("tBreak").reduceRegion({ reducer: ee.Reducer.first(), geometry: plot, scale: 30 }).get("tBreak")).toList();
  const [fc, breaks] = await Promise.all([evaluate(features), evaluate(tBreak)]);
  return { band, ...shapeCcdc(fc, breaks) };
}

module.exports = { ccdcSeries };
```

**Step 5: Route**

```js
const { ccdcSeries } = require("./ee/ccdc");
app.post("/api/ccdc", plotRoute((p, g, body) => ccdcSeries(g, p.start, p.end, body.band || "NDFI")));
```

**Step 6: Live test `functions/test/live/ccdc.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { ccdcSeries } = require("../../ee/ccdc");
const { belize } = require("../fixtures");

test("ccdc returns observed points and at least one segment", { skip: !process.env.EE_LIVE, timeout: 300000 }, async () => {
  await eeAuth();
  const r = await ccdcSeries(ee.Geometry(belize), "2010-01-01", "2020-01-01", "NDFI");
  assert.ok(r.observed.length >= 50, `observed ${r.observed.length}`);
  assert.ok(r.segments.length >= 1 && r.segments[0].length >= 12, `segments ${r.segments.map((s) => s.length)}`);
  for (const p of r.observed) assert.ok(p.value >= -1 && p.value <= 1);
  assert.ok(r.breaks.every((b) => b > Date.UTC(2009, 0, 1) && b < Date.UTC(2021, 0, 1)));
});
```

**Step 7: Run, commit**

```bash
cd functions && npm test && EE_LIVE=1 npm run test:live
cd .. && git add functions && git commit -m "feat(functions): ccdc temporal segmentation endpoint (vendored wiell library)"
```

### Task 6.2: CCDC card with band toggle

**Files:**
- Create: `web/src/components/charts/CcdcCard.tsx`
- Modify: `web/src/App.tsx`

**Step 1: Write `CcdcCard.tsx`**

```tsx
import { useState } from "react";
import ChartCard from "../ChartCard";
import Plot from "../Plot";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { pointsToCsv, downloadText, type Point } from "../../lib/csv";

interface Ccdc { band: "NDFI" | "NDVI"; observed: Point[]; segments: Point[][]; breaks: number[] }
const COLORS = ["#d32f2f", "#1976d2", "#388e3c", "#f57c00", "#7b1fa2", "#00796b", "#c2185b", "#5d4037"];

export default function CcdcCard() {
  const { plot, start, end, plotId, setScene } = usePlot();
  const [band, setBand] = useState<"NDFI" | "NDVI">("NDFI");
  const state = useApi<Ccdc>((s) => postApi("ccdc", { plot, start, end, band }, s), [plot, start, end, band]);
  const controls = (
    <select value={band} onChange={(e) => setBand(e.target.value as "NDFI" | "NDVI")}>
      <option value="NDFI">NDFI</option><option value="NDVI">NDVI</option>
    </select>
  );
  return (
    <ChartCard title="CCDC temporal segmentation (Landsat 7/8/9)" state={state} controls={controls} onDownload={() => downloadText(`${plotId || "plot"}-ccdc-${band}.csv`, pointsToCsv(state.data!.observed))}>
      {(d) => (
        <Plot
          data={[
            { x: d.observed.map((p) => new Date(p.date)), y: d.observed.map((p) => p.value), type: "scatter", mode: "markers", name: `${d.band} observed`, marker: { size: 4, color: "#9e9e9e" }, hovertemplate: "%{x|%Y-%m-%d}<br>%{y:.3f}<extra></extra>" },
            ...d.segments.map((s, i) => ({ x: s.map((p) => new Date(p.date)), y: s.map((p) => p.value), type: "scatter" as const, mode: "lines" as const, name: `Segment ${i + 1}`, line: { width: 2, color: COLORS[i % COLORS.length] }, hoverinfo: "skip" as const })),
          ]}
          layout={{ height: 260, margin: { l: 40, r: 10, t: 10, b: 40 }, yaxis: { range: [-1, 1] }, legend: { orientation: "h", y: -0.25 }, hovermode: "closest",
            shapes: d.breaks.map((b) => ({ type: "line", x0: new Date(b), x1: new Date(b), y0: 0, y1: 1, yref: "paper", line: { color: "#000", width: 1, dash: "dot" } })) }}
          config={{ displaylogo: false, responsive: true }}
          style={{ width: "100%" }}
          onClick={(e) => { const i = e.points[0]?.pointIndex; if (e.points[0]?.curveNumber === 0 && i !== undefined) { const p = d.observed[i]; setScene({ sensor: "landsat", timeStart: p.date, label: `Landsat ${new Date(p.date).toISOString().slice(0, 10)}` }); } }}
        />
      )}
    </ChartCard>
  );
}
```

**Step 2: Mount it first in the side pane** in `App.tsx`: `<CcdcCard />` above `<LandsatNdviCard />`.

**Step 3: Manual verification**

Rebuild, open the demo URL with `startTime=2010-01-01`. Expected: CCDC card shows the spinner for 20 to 90 s while other cards fill, then grey observed points with coloured fitted curves and dotted break lines. Switching NDFI/NDVI reloads. Clicking an observed point loads that Landsat scene.

**Step 4: Commit**

```bash
git add web && git commit -m "feat(web): ccdc card with ndfi/ndvi toggle and break lines"
```

---

## Phase 7: Cache, compare, polish, deploy

### Task 7.1: Firestore result cache

**Files:**
- Create: `functions/lib/cacheKey.js`, `functions/lib/cacheKey.test.js`, `functions/cache.js`
- Modify: `functions/routes.js`, `functions/index.js`

**Step 1: Write the failing test `functions/lib/cacheKey.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cacheKey } = require("./cacheKey");

test("key is stable across property order and 40 hex chars", () => {
  const a = cacheKey("series/modis", { plot: { type: "Polygon", coordinates: [[[1, 2]]] }, start: "2000-01-01", end: "2001-01-01" }, { band: "NDFI" });
  const b = cacheKey("series/modis", { end: "2001-01-01", start: "2000-01-01", plot: { coordinates: [[[1, 2]]], type: "Polygon" } }, { band: "NDFI" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test("different extras give different keys", () => {
  const base = { plot: { type: "Polygon", coordinates: [[[1, 2]]] }, start: "2000-01-01", end: "2001-01-01" };
  assert.notEqual(cacheKey("ccdc", base, { band: "NDFI" }), cacheKey("ccdc", base, { band: "NDVI" }));
});
```

**Step 2: Run to verify failure, then write `functions/lib/cacheKey.js`**

```js
const crypto = require("node:crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o; }, {});
  return value;
}

function cacheKey(endpoint, parsed, extras) {
  const payload = JSON.stringify(stable({ endpoint, plot: parsed.plot, start: parsed.start, end: parsed.end, extras: extras || {} }));
  return crypto.createHash("sha1").update(payload).digest("hex");
}

module.exports = { cacheKey };
```

**Step 3: Write `functions/cache.js`**

```js
const admin = require("firebase-admin");
const { cacheKey } = require("./lib/cacheKey");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const COLLECTION = "cache";

/** Returns cached value or runs `compute`, storing the result for `ttlSeconds`. */
async function withCache(endpoint, parsed, extras, ttlSeconds, compute, { refresh = false } = {}) {
  const key = cacheKey(endpoint, parsed, extras);
  const ref = db.collection(COLLECTION).doc(key);
  if (!refresh) {
    const snap = await ref.get().catch(() => null);
    if (snap && snap.exists && snap.data().expiresAt.toMillis() > Date.now()) return { ...snap.data().value, cached: true };
  }
  const value = await compute();
  ref.set({ endpoint, value, expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + ttlSeconds * 1000) }).catch((e) => console.warn("cache write failed", e.message));
  return value;
}

module.exports = { withCache };
```

**Step 4: Wire it into `plotRoute` in `functions/routes.js`**

```js
const { withCache } = require("./cache");
const TTL = { tiles: 20 * 3600, series: 30 * 24 * 3600 };

function plotRoute(endpoint, ttlSeconds, extrasOf, compute) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    const extras = extrasOf ? extrasOf(req.body) : {};
    const refresh = req.query.refresh === "1";
    const result = await withCache(endpoint, parsed, extras, ttlSeconds, async () => {
      await eeAuth();
      return compute(parsed, ee.Geometry(parsed.plot), extras);
    }, { refresh });
    res.json(result);
  });
}

function registerRoutes(app) {
  app.post("/api/tiles/sentinel2", plotRoute("tiles/sentinel2", TTL.tiles, null, (p, g) => sentinel2CompositeTiles(g, p.end)));
  app.post("/api/tiles/landsat", plotRoute("tiles/landsat", TTL.tiles, (b) => ({ year: Number(b.year) }), (p, g, x) => landsatCompositeTiles(g, x.year)));
  app.post("/api/tiles/scene", plotRoute("tiles/scene", TTL.tiles, (b) => ({ sensor: b.sensor, timeStart: Number(b.timeStart) }), (p, g, x) => sceneTiles(g, p.start, p.end, x.sensor, x.timeStart)));
  app.post("/api/series/modis", plotRoute("series/modis", TTL.series, null, (p, g) => modisSeries(g, p.start, p.end)));
  app.post("/api/series/landsat", plotRoute("series/landsat", TTL.series, null, (p, g) => landsatSeries(g, p.start, p.end)));
  app.post("/api/series/sentinel2", plotRoute("series/sentinel2", TTL.series, null, (p, g) => sentinel2Series(g, p.start, p.end)));
  app.post("/api/ccdc", plotRoute("ccdc", TTL.series, (b) => ({ band: b.band || "NDFI" }), (p, g, x) => ccdcSeries(g, p.start, p.end, x.band)));
}
```

**Step 5: Verify with the emulator**

```bash
firebase emulators:start --only functions,firestore
```
Call `series/modis` twice via curl (Task 1.4 step 6 URL pattern). Expected: the second response arrives in under a second and carries `"cached": true`; the Emulator UI shows a `cache` collection with one document.

**Step 6: Run unit tests, commit**

```bash
cd functions && npm test && cd .. && git add functions && git commit -m "feat(functions): firestore result cache with per-endpoint ttl"
```

### Task 7.2: Swipe compare

**Files:**
- Create: `web/src/components/CompareMap.tsx`
- Modify: `web/src/components/LayersPanel.tsx`, `web/src/App.tsx`, `web/src/index.css`

**Step 1: Write `web/src/components/CompareMap.tsx`**

```tsx
import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css";
import { BASE_STYLE, addPlotOutline, setImagery } from "./MapView";
import { polygonBounds, type Polygon } from "../lib/urlParams";

interface Props { plot: Polygon; leftTileUrl?: string; rightTileUrl?: string }

export default function CompareMap({ plot, leftTileUrl, rightTileUrl }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const leftEl = useRef<HTMLDivElement>(null);
  const rightEl = useRef<HTMLDivElement>(null);
  const maps = useRef<{ left?: MlMap; right?: MlMap }>({});

  useEffect(() => {
    const opts = { style: BASE_STYLE, bounds: polygonBounds(plot), fitBoundsOptions: { padding: 80, maxZoom: 16 } };
    const left = new maplibregl.Map({ container: leftEl.current!, ...opts });
    const right = new maplibregl.Map({ container: rightEl.current!, ...opts });
    left.on("load", () => { addPlotOutline(left, plot); maps.current.left = left; setImagery(left, leftTileUrl); });
    right.on("load", () => { addPlotOutline(right, plot); maps.current.right = right; setImagery(right, rightTileUrl); });
    const compare = new Compare(left, right, wrap.current!);
    return () => { compare.remove(); left.remove(); right.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (maps.current.left?.isStyleLoaded()) setImagery(maps.current.left, leftTileUrl); }, [leftTileUrl]);
  useEffect(() => { if (maps.current.right?.isStyleLoaded()) setImagery(maps.current.right, rightTileUrl); }, [rightTileUrl]);

  return (
    <div ref={wrap} style={{ position: "absolute", inset: 0 }}>
      <div ref={leftEl} style={{ position: "absolute", inset: 0 }} />
      <div ref={rightEl} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
```

If `@maplibre/maplibre-gl-compare` ships no types, add `declare module "@maplibre/maplibre-gl-compare";` to `web/src/plotly-dist.d.ts` (rename the file to `web/src/untyped.d.ts`).

**Step 2: Add the Compare toggle to `LayersPanel.tsx`** (below the Scene radio)

```tsx
<label className="layer-row"><input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} /> Compare with</label>
{p.compare && (
  <select value={p.compareLayer} onChange={(e) => p.setCompareLayer(e.target.value as LayerId)}>
    <option value="sentinel2">Sentinel-2, last 12 months</option>
    <option value="landsat">Landsat {draftYear}</option>
    <option value="scene" disabled={!p.scene}>Scene{p.scene ? `: ${p.scene.label}` : ""}</option>
  </select>
)}
```

**Step 3: Use it in `App.tsx`**

```tsx
const right = useLayerTiles(compareLayer);   // always called; cheap when cached
{compare ? <CompareMap plot={plot} leftTileUrl={tiles.data?.tileUrl} rightTileUrl={right.data?.tileUrl} /> : <MapView plot={plot} tileUrl={tiles.data?.tileUrl} />}
```
(`compare` and `compareLayer` come from `usePlot()`.) Give `CompareMap` and `MapView` a `key` so switching modes remounts cleanly: `key="compare"` / `key="single"`.

**Step 4: Manual verification**

Rebuild. Tick Compare, pick Landsat on the right and move the slider to 2000. Expected: a draggable vertical handle; Sentinel-2 on the left, Landsat 2000 on the right; both pan together.

**Step 5: Commit**

```bash
git add web && git commit -m "feat(web): swipe compare between two imagery layers"
```

### Task 7.3: Mobile layout check and polish

**Files:**
- Modify: `web/src/index.css`, `web/src/components/LayersPanel.tsx`

**Step 1: Collapsible layers panel on narrow screens.** Add state `open` (default `window.innerWidth > 900`) to `LayersPanel` and render a `<button className="layers-toggle">Layers</button>` that toggles it; when closed render only the button.

**Step 2: CSS**

```css
.layers-toggle { display: none; }
@media (max-width: 900px) {
  .layers-toggle { display: inline-block; position: absolute; top: 8px; left: 8px; z-index: 2; }
  .layers-panel { top: 44px; max-width: calc(100% - 16px); }
  .chart-card .js-plotly-plot { max-width: 100%; }
}
```

**Step 3: Verify** with the browser devtools device toolbar at 390 px wide: map on top at half height, cards below, Layers button opens the panel, charts fit the width without horizontal scroll.

**Step 4: Commit**

```bash
git add web && git commit -m "feat(web): responsive layout with collapsible layers panel"
```

### Task 7.4: Deploy and hook up Collect Earth

**Files:**
- Modify: `README.md`, `package.json` (root)

**Step 1: Root `package.json` with deploy scripts**

```json
{
  "name": "ce-earth-viewer",
  "private": true,
  "scripts": {
    "build": "npm --prefix web run build",
    "test": "npm --prefix functions test && npm --prefix web test",
    "emulate": "npm run build && firebase emulators:start",
    "deploy": "npm test && npm run build && firebase deploy",
    "deploy:preview": "npm run build && firebase hosting:channel:deploy preview --expires 7d"
  }
}
```

**Step 2: First deploy**

```bash
npm run deploy
```
Expected: Functions deploys `api` to europe-west1 (first deploy takes several minutes), Hosting prints `https://ce-earth-viewer.web.app`. Open the demo URL on that host and confirm the same behaviour as the emulator.

**Step 3: Smoke test production**

```bash
curl -s https://ce-earth-viewer.web.app/api/health
```
Expected: `{"ok":true}`.

**Step 4: Collect Earth**: change the GEE app URL in the Collect Earth project settings from the Code Editor app to `https://ce-earth-viewer.web.app/?geoJson=${geoJson}&startTime=${startTime}&endTime=${endTime}&plot_id=${plotId}` (same placeholders Collect Earth already fills for `testWithURL`). Record the exact setting name in the README once found.

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: deploy scripts and collect earth hook-up notes"
```

---

## Done criteria

- Opening a Collect Earth link on the deployed site shows the plot within 2 s, Sentinel-2 imagery within 10 s, MODIS and NDVI charts within 30 s, CCDC within 90 s, each card independently retryable.
- Reloading the same plot returns every card from cache in under 3 s total.
- `npm test` passes offline; `EE_LIVE=1 npm --prefix functions run test:live` passes with the service account.
- No service-account key or `.secret.local` in git history (`git log -p | grep -c private_key` prints 0).

---

## Amendments made during execution

Code review after each task changed the plan's code in these places. The committed code in `ce-earth-viewer` is authoritative; the task text above is kept as written for history.

- **Task 1.1** (`functions/app.js`, `functions/index.js`): `errorToResponse` passes through 4xx errors that carry `status` but no `code` (body-parser errors) as that status with `code: err.type || "bad_request"`. `index.js` exports `createHandler(load)` and `handler`; the handler wraps app creation in try/catch and answers a JSON 500 "API failed to load" if `./routes` cannot be required, instead of crashing outside Express.
- **Task 1.2** (`functions/lib/plotRequest.js`): dates are parsed with a regex capture and `Date.UTC`, so unpadded dates such as `2026-11-1` no longer drift by a day on non-UTC machines; impossible dates (`2000-02-31`) are a 400 while unparseable strings still fall back to the default. Geometry is validated before `@turf/area` runs: rings need 3 or more finite in-range positions, Polygon outer rings are closed like the line types, and malformed input is a 400 rather than a TypeError. Antimeridian-crossing plots are a documented limitation.
