# Collect Earth without Java, with Arena as the data backend — Plan

**Date:** 2026-11-05 · **Branch:** ce-2026-GEW · **Status:** plan for future development, for the owner to approve. Nothing
here is built yet.

## Goal

Two moves, which can be made separately:

1. **Collect Earth's desktop program moves from Java to Node.js** (TypeScript). The pages people use are already a
   React app (`collect-earth-app/src/main/frontend`) that talks to the Java program only through a JSON API. Only the
   program behind that API changes. The installers keep shipping one program for Windows, macOS and Linux.
2. **Open Foris Arena becomes the data backend, inside Collect Earth Cloud.** Collect Earth Cloud contains Arena: Arena
   keeps the surveys and the collected plots, and Collect Earth Cloud keeps what is about coordinating people (projects,
   plot files and who has which plots, checks, decisions, training). Collect Earth Cloud runs **on a server** when the
   collection is distributed, and **on the interpreter's own computer** when it is local, where it already runs today as
   the local dashboard: Arena runs inside it in both places.

## Requirements (from the owner, 5 Nov 2026)

1. **Arena works both locally and on servers** (added 5 Nov 2026): on `localhost` when the data collection takes place on
   one computer (set-up 1 of the guide *Collect Earth data collection: four ways to set it up*), and on a cloud server, the
   shared one or a private one, when it is distributed between several interpreters (set-ups 3 and 4). The same Arena, the
   same Collect Earth, the same way of sending plots: only the address changes. See "Collect Earth Cloud, with Arena inside,
   in two places" below.
2. **The Collect survey definitions and the `.cep` project files stay** (below).
3. **Collect Earth Cloud contains Arena** (added 5 Nov 2026). Collect Earth talks only to Collect Earth Cloud, as today;
   Collect Earth Cloud stores the surveys and the plots in the Arena it contains, and keeps its coordination features. See
   "How Collect Earth Cloud contains Arena" below.

**The Collect survey definitions and the `.cep` project files stay.** Coordinators keep designing surveys in Collect's
designer and handing out `.cep` files; existing projects keep working unchanged. So:

- the `.cep` (with its survey `placemark.idm.xml`, `balloon.html`, `kml_template.fmt` and
  `project_definition.properties`) remains **the only place a survey is defined**;
- Arena receives a **converted copy** of the survey, which nobody edits in Arena: a change goes into the `.cep`, which is
  uploaded again, and Arena gets a new version;
- records keep the Collect key: the plot id, plus the hidden `round` where the server added it.

## What there is today

| Part | Size (Java lines) | What it does | Notes for the move |
| --- | --- | --- | --- |
| `collect-earth-app` `service/*` | about 21,900 | Projects, settings, KML, browsers and windows, imagery sources, Saiku, import/export, jobs, notices, cloud sync, local dashboard | Most of the port |
| `collect-earth-app` `ipcc` | about 14,500 | The LULUCF (IPCC) package | Largest single feature; see Stage 6 |
| `collect-earth-app` `server` (API) | about 4,000 | The JSON API under `/earth/api` and the form endpoints (`placemark-info-expanded`, `save-data-expanded`, `surveyForm`) | The contract the React app relies on: keep it as is |
| `collect-earth-app` `service/imagery`, `BrowserService`, `GoogleEarthWebService`, `WindowLayoutService` | about 6,700 | Driving Chrome, Edge and Firefox with Selenium 4.51 and WebDriverManager; app windows, imagery tabs, layout | Replaced by Playwright (Stage 4) |
| `collect-earth-core` | about 5,000 | The survey service over the Collect framework (records, validation, relevance, attribute handlers) | The form engine: the hardest part (Stage 3) |
| `collect-earth-sampler` | about 3,100 | Plot shapes (square, circle, hexagon, NFI), KML/KMZ, coordinate systems (GeoTools) | Geometry in TypeScript with proj4 |
| `ad_hoc` | about 2,400 | One-off repair tools for particular countries | Not ported |
| The Collect framework 4.0.110 | (library) | Reads IDML, keeps records, evaluates Collect's expressions, stores records in SQLite/PostgreSQL | No JavaScript equivalent: see Stage 3 |

Already in TypeScript, in this repository, and reusable:

- **Collect Earth Cloud** (`collect-earth-cloud`): Fastify, PostgreSQL or memory store; reads `.cep` files and adds the
  hidden `round` (`src/cep.ts`), reads the survey's questions, answers and help (`src/surveyOutline.ts`), parses plot files
  as Collect Earth does (`src/plots.ts`), receives records as Collect XML plus a summary (`records:batch`), builds Collect
  backups (`src/collectBackup.ts`), and runs **as the desktop's local dashboard** in `LOCAL_MODE` on the Node already
  bundled in every installer (`docs/plans/2026-11-03-desktop-dashboard.md`).
- **The desktop's React app**: every page and the generated plot form; only the API behind it changes.

## Decisions to take (owner)

1. **The raw copy of each record.** Arena's place is settled by requirements 1 and 3: inside Collect Earth Cloud, on the
   computer and on servers, with the coordination staying in Collect Earth Cloud. Still to decide: whether Collect Earth
   Cloud keeps, next to Arena's converted record, the record exactly as Collect Earth sent it (Collect XML and its
   summary). Proposed: keep it, at least until the conversion is shown to lose nothing in either direction; it is what
   the Collect backups, the exports and the quality figures read today, and it makes a wrong conversion repairable.
2. **Google Earth Pro.** Keep the Google Earth Pro viewer (KML and the balloon) or keep only the plots map and Google Earth
   Web. Keeping it means rendering the `.cep`'s FreeMarker template `kml_template.fmt` in Node (see Risks).
3. **Firefox.** Playwright drives only its own modified Firefox, not the one people install. Proposed: support Chrome and
   Edge (Edge is on every Windows 10 and 11), and drop Firefox.
4. **Saiku and the LULUCF package.** Saiku is replaced by the analysis of "Presenting the data" below (decided by the
   owner, 5 Nov 2026: the analysis must stay dynamic, built from any survey). The LULUCF package: port it, or keep it as a
   separate Java tool started on demand.
5. **Packaging.** Keep InstallBuilder (it already ships Node and the dashboard) or move to Electron with electron-builder.

## Design

### The shape of the new desktop program

```
React app (unchanged)  ──JSON API (same contract)──▶  Node program (Fastify)
                                                         ├─ project and settings (reads .cep, earth.properties)
                                                         ├─ survey engine (IDML → form model, checks, relevance)
                                                         ├─ local store (SQLite: Collect XML + summary per record)
                                                         ├─ plots (CSV, geometry, GeoJSON, optional KML)
                                                         ├─ browsers (Playwright: plots map, Google Earth Web, imagery)
                                                         ├─ sync (to Collect Earth Cloud: on this computer or on a server)
                                                         └─ local Collect Earth Cloud (LOCAL_MODE, Arena inside, same process)

Local collection:        Collect Earth ──sync──▶ Collect Earth Cloud on 127.0.0.1 [ Arena · local PostgreSQL ]
Distributed collection:  Collect Earth ──sync──▶ Collect Earth Cloud on a server [ Arena · PostgreSQL ] ◀── browsers
```

- **One Node process.** The local dashboard is already Collect Earth Cloud run by Node; the new desktop program serves the
  desktop API and the local Collect Earth Cloud, with its Arena, from the same process, so they never disagree.
- **The API stays.** The endpoints of `server/api` and the form's (`surveyForm`, `placemark-info-expanded`,
  `save-data-expanded`, `plot-activity`) keep their paths and JSON. The React app and its tests (about 300) do not change; the
  Java answers become the reference the Node ones are tested against (golden tests, below).

### The record format: Collect XML, converted inside Collect Earth Cloud

The desktop and Collect Earth Cloud already exchange records as **Collect record XML plus a flat summary** (the
`RecordEnvelope` of `CloudRecordSerializer`). The Node program stores exactly that in its local SQLite file, one row per
record, as the cloud server does. Consequences:

- Collect Earth Cloud, its figures, its exports and its Collect backups do not change.
- `.cep` files and their surveys stay readable by Collect itself, and data can always be opened in Collect.
- Conversion to Arena's model happens in one place: inside Collect Earth Cloud, when it stores a record (Stage 1). The
  desktop never deals with Arena's model.

### The survey engine: two candidates, chosen by a trial

Today Collect's Java framework reads the IDML and, on every save, works out which questions show, the checks and the
calculated answers, using Collect's expression language (XPath-like, `idm:` functions). The Node program needs the same.

| | A. Convert to Arena's model | B. An IDML engine in TypeScript |
| --- | --- | --- |
| How | At project load, convert the IDML with the converter Arena uses for its Collect import, then run Arena's JavaScript survey and record model (its `arena-core` component) | Read the IDML directly; evaluate Collect's expressions with a small XPath-like evaluator; code lists, units and taxonomies from the IDML |
| Fidelity | As good as Arena's converter: users report expressions it cannot translate | Exactly Collect's, once built; tested against the Java framework |
| Work | Smaller, if the converter can be used outside Arena's server | Larger |
| Shared with Arena | Yes: one model on both sides | No |

**Trial (Stage 0, S4):** take the surveys of real Collect Earth projects (the demo, two national inventories), convert
them with Arena's converter, and count what fails. Choose A if almost every survey converts cleanly and the failures can
be fixed in the converter; otherwise B, starting from `collect-earth-cloud/src/surveyOutline.ts`, which already reads
questions, answer options and help texts from IDML.

Either way, the form model the React form receives (`SurveyFormModelBuilder`'s JSON) and the per-save answers (relevance,
errors, values) are compared, survey by survey and save by save, with the Java program's.

### Browsers: Playwright

Today: Selenium 4.51 with WebDriverManager, which downloads chromedriver, msedgedriver or geckodriver **at run time**;
the installed Chrome, Edge or Firefox; profiles in Collect Earth's folder (sign-ins kept); the plots map as an app
window; imagery in tabs through WebDriver BiDi; a check every 2 seconds for a closed window (`PlotsMapKeeper`); window
placement by `WindowLayoutService`.

With Playwright (`playwright-core`, no browser downloaded):

- `chromium.launchPersistentContext(profileFolder, { channel: "chrome" | "msedge", headless: false, args: ["--app=…"] })`
  opens the installed browser with Collect Earth's own profile, as today.
- **No driver download**: Playwright talks to Chrome over its own debugging protocol, so the failures of WebDriverManager
  behind proxies go.
- **Events instead of polling**: `page.on("close")`, new tabs, downloads.
- **Window placement**: Playwright has no API for it; Chrome's `Browser.getWindowForTarget` and `Browser.setWindowBounds`
  (through a CDP session) do what `WindowLayoutService` needs, on Chrome and Edge.
- **Google sign-in (risk)**: Google may refuse to sign in a browser that an automation library started ("This browser or
  app may not be secure"). The safer pattern: Collect Earth starts Chrome itself, as a normal process with its own
  `--user-data-dir` and a debugging pipe or port, then attaches with `chromium.connectOverCDP`. Chrome refuses remote
  debugging on the default profile; Collect Earth already uses its own profile folders.
- Shipping Chromium is possible (`npx playwright install chromium` with `PLAYWRIGHT_BROWSERS_PATH` inside the
  application, about 150 MB per platform) but not proposed: on macOS every nested binary must then be signed and
  notarized by us.

### Collect Earth Cloud, with Arena inside, in two places

The same Collect Earth Cloud, with the same Arena inside, runs in both, and Collect Earth talks to both the same way, through
Collect Earth Cloud's `/v1` interface; what differs is who starts it, where its database lives, and who signs in.

| | Local collection (one computer) | Distributed collection (several interpreters) |
| --- | --- | --- |
| Where Collect Earth Cloud (and its Arena) runs | On the interpreter's computer, at `127.0.0.1`, started and stopped by Collect Earth, as the local dashboard is today (`LOCAL_MODE`) | On a server: the shared one or a private one |
| Its database | PostgreSQL on the computer, in Collect Earth's user folder (see "A database on every computer"), in place of today's memory store | PostgreSQL on the server (Cloud SQL, or the organisation's) |
| Who signs in | Nobody: one local account, made at first start, and a one-time sign-in link, as the local dashboard does now | Everyone with their own account, invited to the project |
| How the survey gets there | Collect Earth sends the `.cep` it opened, as it does to the local dashboard today | The coordinator uploads the `.cep` |
| How plots get there | Collect Earth's sync, within seconds of each save | Collect Earth's sync, every 30 seconds, queued while offline |
| Who can see the data | Only that computer (`127.0.0.1` only, never the network) | The project's members, by role |
| Coordination (division, checks, training) | Off, as in today's local mode | Collect Earth Cloud's, as today |

**One sync, two addresses.** Collect Earth always keeps its own local store and sync queue (Collect XML per record), in
both kinds of collection, and sends the records to "its Collect Earth Cloud": the local one, or the one on the server.
So:

- working offline is the same in both: the queue waits;
- a local Collect Earth Cloud that is not running (it failed to start, or is being updated) loses nothing: the queue sends
  later;
- the local dashboard and the server's dashboard read the same kind of data.

**From local to distributed.** A project that starts on one computer and grows into a team does not need an export by
hand: the coordinator puts the `.cep` on the server, the interpreter joins it, and Collect Earth sends every record of
the project from its local store to the server's Collect Earth Cloud, as the cloud sync's reconciliation does today. The
local one is then no longer fed for that project. The other way (a server project continued alone, offline for good) is a
Collect backup from the server, imported into Collect Earth and so sent to the local Collect Earth Cloud.

**Versions.** Collect Earth only ever talks to Collect Earth Cloud's versioned `/v1` interface, never to Arena. Each
Collect Earth Cloud release pins the Arena version it contains and runs Arena's database migrations with its own. So a
desktop whose local Collect Earth Cloud contains one Arena version works with a server that contains another.

#### A database on every computer

Arena keeps its data in PostgreSQL, and so does Collect Earth Cloud's own part when it is not in memory. On a server that
is given; on an interpreter's laptop it must come with Collect Earth,
start in seconds, use little memory, and never ask the person anything. Three candidates, to be tried (S6):

| | Embedded PostgreSQL binaries | PGlite (PostgreSQL compiled to WebAssembly) | A store adapter |
| --- | --- | --- | --- |
| What | The real PostgreSQL server, shipped per system (Windows, macOS on Apple silicon and Intel, Linux) and started by Collect Earth on a free local port | PostgreSQL inside the Node process, data in a folder; reached by Arena and Collect Earth Cloud through a local socket | Arena's data layer gets a second implementation over SQLite, used only locally |
| Size | About 30 to 60 MB per system | About 10 MB | None extra |
| Fidelity | The same as on the server | Close; some extensions missing (PostGIS, if Arena needs it, to verify) | Arena's queries rewritten: large and lasting work |
| Risks | Antivirus and firewalls on Windows; signing every binary on macOS; a second process to keep alive | Whether Arena's database library works over it; speed on large projects | Two data layers to keep in step |

Proposed: try PGlite first, fall back to the embedded binaries. The store adapter only if both fail.

The local database lives next to Collect Earth's other files, in the user folder, and is backed up when Collect Earth
closes, as the SQLite file is today (`backupSqlite`, the newest 10 kept).

### How Collect Earth Cloud contains Arena

| Kept by | What |
| --- | --- |
| **Arena** | Each project's survey (converted from the `.cep`'s IDML), its records (converted from Collect XML), Arena's own pages for exploring and analysing the data |
| **Collect Earth Cloud** | Accounts, projects and members, the `.cep` as uploaded and as handed out, plot files, who has which plots (division, checks, reference plots), decisions and notes, training, time spent, activity, mail, progress links, the AI assistant; and, per decision 1, the raw copy of each record |

- **One deployment.** Arena's server runs inside Collect Earth Cloud's process (Fastify can host an Express application) or,
  if that is not possible, beside it in the same container, started and stopped with it. One PostgreSQL database holds
  Arena's schemas next to Collect Earth Cloud's tables; Collect Earth Cloud's row-level security stays on its own tables.
  To find out in trial S3, with the Arena team.
- **One `Store`, two parts.** Collect Earth Cloud reads and writes through its `Store` interface (today: memory and
  PostgreSQL). Surveys and records go through a new implementation backed by Arena's code; everything else stays in
  Collect Earth Cloud's tables, unchanged.
- **One sign-in.** People have one account, Collect Earth Cloud's. Each project is one Arena survey, and its members are
  given matching rights there: coordinator → the survey's administrator, reviewer → an analyst who reads the data,
  collector → data entry for their own records. Arena's pages open from the dashboard without signing in again. What Arena
  allows here is to verify (S3).
- **Survey:** when a `.cep` is uploaded (or a new version), Collect Earth Cloud converts the survey it hands out (with the
  hidden `round` and the coordinator's comment field, where added) with Arena's Collect import code, and creates or
  updates the project's Arena survey. A version Arena cannot take is refused at upload, with the reason, as a `.cep` that
  would no longer match the data is today.
- **Data:** each record of `records:batch` is stored in Arena (converted) and, per decision 1, kept as sent. A conversion
  that fails does not lose the record: it is kept as sent, flagged, and converted again once fixed.
- **Collect backups and exports** come from the raw copy while it is kept, so they stay exactly what Collect reads; Arena's
  own exports are offered next to them.
- **Keys:** the plot id and `round` are the record keys in both systems.
- **Collect Earth's bookkeeping answers** (operator, actively saved, plot file, …) are ordinary questions of the survey:
  they come through.
- **What Arena does not get:** the form (`balloon.html`), the map template and the project settings: they are Collect
  Earth's, and stay in the `.cep`.
- **No new interface for Collect Earth.** The desktop keeps sending to Collect Earth Cloud's `records:batch`; Arena is
  reached from inside Collect Earth Cloud, through Arena's own code, not through a public interface of Arena.

### Presenting the data: the analysis that replaces Saiku

**What Saiku is used for.** A pivot table over the collected plots: a question on the rows, another on the columns,
counts and areas in the cells, by stratum or region, exported to Excel. Saiku 2.6 (2014) is bundled with a Tomcat and
started from **Tools → Start SAIKU Analysis**; a rebuilt Saiku exists (Spicule, 2026, still Mondrian and Java) but keeps
Java in a product leaving it, under one vendor and an unclear licence. Everything Saiku knows of a survey is generated:
the tables by Collect's RDB export (one per entity, codes and labels), the cube by `collectEarthCubes.xml.fmt` from the
`.cep` (dimensions: code, boolean and range attributes, code-list levels; measures: count, area, numbers), the expansion
factors from `region_areas.csv` or `areas_per_attribute.csv`, and the climate, soil, elevation, slope and aspect columns
added by `AnalysisSaikuService`. The replacement is generated from the same sources, so **any survey** works, as today.

**Three layers, each useful alone**

| Layer | What | Where it runs |
| --- | --- | --- |
| 1. The pivot table | DuckDB-WASM (the analytical database, inside the page) and Perspective (the drag-and-drop pivot grid and charts, OpenJS Foundation), both MIT. A page of the dashboard, so the same on the laptop and on the cloud server | In the browser |
| 2. Estimates | Design-based estimates with confidence intervals, through Arena's R processing chains (`survey`, `srvyr`) once Arena is the backend, or an R script template shipped with Collect Earth if Arena's chains need a field-inventory structure (to verify, S7) | On the server (RStudio Server), or the person's R |
| 3. The AI analyst | Questions in plain words, answered as queries over layer 1's model, with the chart and the query shown (next section) | The cloud server (an LLM), optional |

**Layer 1, built from the survey**

- **The view model**, generated at project load from the survey the dashboard already reads (`surveyOutline.ts`: questions,
  types, code lists, labels per language): one DuckDB table per entity (plot and the nested ones, as the RDB export
  does), *dimensions* = code, boolean, range and date attributes with their labels, code-list hierarchies as level
  columns (`land_use`, `land_use_subcategory`), *measures* = plot count, area (expansion factor × count), sums and means
  of number attributes. The `collectEarthCubes.xml` of a `.cep` that customised its cube (renamed measures, hidden
  attributes, calculated members) is read as an override; a calculated MDX member becomes a SQL expression of the model.
- **Enrichment**, the same as today, in TypeScript: expansion factors from the areas CSVs, the ALU climate and soil
  classes, elevation, slope and aspect.
- **The data**: the project's records as the dashboard holds them (on the laptop, every record; on the server, by role:
  coordinators all, collectors their own), loaded into DuckDB as Parquet. No export step, no stale copy: the pivot reads
  what was synced a minute ago.
- **Perspective** shows the pivot, filters, sorts, charts (bar, line, heat map, map scatter of plots), and exports CSV and
  Excel; its views are JSON, saved per project and shared with the team on the cloud. Aggregation is done in DuckDB (SQL
  generated from the view), Perspective only displays: DuckDB-WASM handles millions of rows, Perspective's own engine
  about one or two million.
- **The stand-alone tool** ("Generate Stand-Alone Saiku tool") becomes one HTML file holding the page, DuckDB-WASM and
  the data as Parquet: opens in any browser, no install, no Java.
- **Pages**: a *Data → Analyse* page of the dashboard (local and cloud), and **Tools → Analyse the data** in Collect Earth,
  which opens it in the local dashboard where **Start SAIKU Analysis** is now.

**Trial S7 (a day or two):** the demo survey and one real `.cep` with a customised cube loaded into DuckDB-WASM with a
view model generated from the survey, pivoted in Perspective, and the figures (counts and areas by two dimensions,
with expansion factors) compared with Saiku's on the same data; a 100,000-plot file for speed and memory in Chrome on an
8 GB laptop; the stand-alone HTML opened offline.

### S7 results (5 November 2026, the demo survey)

Run on the demo survey (`demo_survey.cep`: a plot entity with 40 questions and two nested tables, 132 cube dimensions),
with synthetic records, in headless Chromium on this 16 GB machine; the code is in `collect-earth-cloud/trials/s7-pivot`
(its README lists what was learnt). **Verdict: it works, and layer 1 can be built as designed.**

| Question | Result |
| --- | --- |
| Generated from the survey, as the cube is? | **Yes.** The view model generated from the IDML has 128 dimensions and 36 measures to the cube's 132 and 30; the differences are explained (the cube splits the save date into year, month and day and adds latitude and longitude as dimensions; ours adds min/max/avg of the nested tables' percentages). Rule found: the cube generator skips the attributes marked `collect:includeInDataExport="false"` and keeps the bookkeeping ones. Nested entities (`land_cover`, `land_use`) become cubes of their own with the plot's dimensions joined, as Saiku's hierarchies do. |
| The figures right? | **Yes.** Plot counts and areas (with expansion factors) by land use, means and shares by climate, the two-level land-use list as a drill-down, land cover rows by element with the plot's province: 26 figures per run, identical between Perspective's pivot, DuckDB's SQL and an independent Python count, at 55 and at 100,000 plots. |
| Speed | 55 plots: the page usable in 2.2 s (DuckDB started in 0.8 s). **100,000 plots (49 columns, 300,000 land cover rows): first pivot in 5.2 s**, a new pivot (province × land use, area) in 0.4 s. |
| Memory | DuckDB 64 MB for 100,000 plots; the whole headless browser 1.6 GB against 0.85 GB with 55 plots, so about 0.7 GB for the data in DuckDB, Arrow and Perspective's copy together: fine on an 8 GB laptop, but the Perspective copy should be a projection of the columns in use, not the whole cube (the next step of layer 1). |
| Charts | Stacked bars, lines and the rest from the same pivot, with the maintained `@perspective-dev/viewer-charts`. |
| The stand-alone file | **One HTML file opens from the disk with no server**: 19 MB with the demo's 55 plots, 26 MB with 100,000 (DuckDB's wasm 8 MB gzipped, Perspective 8 MB, the data 5 MB gzipped); ready in 3.9 s and 6.9 s, the same figures. **The charts stay blank in it:** the chart package draws in a background worker that a page opened from the disk cannot start (a `blob:` script from an opaque origin); the grid works. To fix in the package (an option to draw without the worker), or by serving the stand-alone from the local dashboard instead of a bare file. |
| Offline | DuckDB-WASM downloads its Parquet and JSON extensions from the internet on first use (refused in this sandbox): the product must serve them itself, or stick to CSV and Arrow, which need none. |

Found and fixed on the way, kept in the trial's README: the deprecated `@finos/perspective*` packages (use `@perspective-dev/*`),
a viewer element written in the HTML before the library loads crashing when a plugin is chosen, two Arrow versions
giving empty tables, a `Uint8Array` where Perspective wants an `ArrayBuffer`, and a CSV dialect DuckDB could not sniff.
None of them is a reason against the design; all of them would have cost the stage days.

### Stage 6a, first part: the analysis page (built 5 November 2026)

In collect-earth-cloud, so the same code serves the cloud dashboard and the local one Collect Earth runs:

- **Server** (`src/analysis.ts`, `src/routes/analysis.ts`): `GET /v1/projects/:pid/analysis` answers, gzipped, the
  model generated from the survey (the plot table, a table per multiple entity keyed by its key attribute, labels in
  every language, the code lists with their levels) and every table's rows as CSV with their DuckDB types, built from
  the records' summaries; the expansion factors from `region_areas.csv` or `areas_per_attribute.csv`, as
  RegionCalculationUtils works them out. Coordinators and reviewers get every record with its round and whether it is
  a first assessment or a check; a collector their own records, without rounds.
- **Page** (`web/src/pages/AnalysisPage.tsx`, `analysisView.ts`, `analysisEngine.ts`): `/projects/<id>/analysis`,
  linked from the Data tab (coordinators, and the local dashboard), and from the project page of reviewers and
  collectors. DuckDB-WASM and Perspective load with the page only, from the dashboard's own files (offline).
  - Every column is named by its label in the dashboard's language. Each code has its label, its code and the
    label of each level above it.
  - It opens on the number of plots and the area by land use, for coordinators the first assessments only.
  - Any table and chart are a drag away, and Perspective's own panel is in the same four languages.
  - Views are saved per project in the browser, and a saved view is translated (columns and filter values) when the
    language changes.
- **Checked** in Chromium against a running server with the demo survey and 200 plots from two collectors: the
  figures (the areas add up to the areas file's total), the nested tables, charts, saving and reopening a view,
  switching to Spanish, a collector's own view; page ready in about 6 s, most of it starting DuckDB.
- **Found:** with Vite, Perspective's client must not be given its own wasm (`init_client` of
  `@perspective-dev/client`): it takes the viewer's module, and a second one crashes `load` with "memory access out of
  bounds". `load(table)` is deprecated: `load(client)`, then `restore({ table })`.
- **Size:** the dashboard's files grow from 2.6 to 44 MB (DuckDB's wasm 36 MB): the build writes `.gz` copies the
  server sends (8 MB for DuckDB) and the assets are now cached for good (hashed names); the installer carries
  about 11 MB more (xz), without the `.gz` copies.

Still to do in 6a: views shared by the team (saved on the server, not only in the browser); the stand-alone HTML
download; Collect Earth's "Tools → Start SAIKU Analysis" becoming "Analyse the data" (the local dashboard's page, or
the cloud's for a cloud project), then Saiku and its Tomcat out of the installer; a projection of the columns in use
for very large projects (S7's memory finding).

### The AI analyst: presenting the data and finding what matters

The cloud server already has an AI assistant for quality (`src/ai/`: Gemini on Vertex AI; per project, switched on by a
coordinator; names replaced by Person A, B…; the model answers through a fixed set of tools over figures already
computed, never raw text answers or coordinates; daily and monthly limits per project; every run and its tool calls
kept). The analyst extends that design to the collected data, in the same place and under the same rules.

**What it does, in four steps that build on one another**

| Step | What the person gets | How |
| --- | --- | --- |
| A. Ask in words | "How much forest is there by province, as a share of the area?" → the pivot shows the table and chart, with the query underneath, which the person can edit | The model gets the **view model** (dimensions, measures, labels, help texts) and writes a DuckDB query, or a Perspective view; the server runs it on the project's data with the asker's rights; the model never sees the rows, only the aggregated result it asked for (capped, as the quality tools are) |
| B. Explain a result | A paragraph under a pivot: what stands out, which cells are small samples, how the figure compares with the whole | The model receives the aggregated table shown (not the records) and the survey's definitions; the text is marked as the assistant's and never replaces a figure |
| C. Find what matters | "What should I look at?": a short list of findings with their table, each a saved view the person can open — strata with few plots, questions whose answers changed over time, land uses concentrated in one region, numbers far from the others | A fixed set of analyses run in DuckDB without a model (the same way the pattern flags work), the model ranking and wording them; the figures are the computer's, the sentences the model's |
| D. Report | A printable report for a project (as the training report is): the headline figures, the pivots the coordinator saved, the findings of C and the estimates of layer 2 with their intervals, in the dashboard's language | Built by the server from saved views; the model writes only the connecting sentences, from the figures |

**Rules, the same as the quality assistant's**

- **Off until a coordinator switches it on**, and only where the server owner has set an LLM up. On the laptop (local mode)
  it can use the same cloud model with the person's own key, or a local model through Ollama, or stay off: layer 1 works
  without it.
- **Nothing a person wrote reaches the model**: answers to choice, number and date questions, aggregated, and the survey's
  own texts; never free-text answers, comments, coordinates or names (people as Person A, B…; plots by their id only
  when the asker could see them anyway).
- **Every figure is reproducible**: the query is shown and kept with the answer; a person can run it again without the
  model. The model's text is labelled as such.
- **Limits and logging** as today: runs per day and tokens per month per project, every run kept with its tool calls, the
  server owner's usage panel.
- **The model is replaceable**: the client is one module (`src/ai/client.ts`, Gemini today); the analyst adds no other
  dependency on a provider.

**Trial S8 (after S7):** twenty questions a coordinator would ask, in English, Spanish and French, on the demo and one real
survey; the model's queries checked against hand-written ones for the same questions (correct dimensions, measures,
filters, expansion factors); the explanations read by two coordinators for usefulness and for anything they should not
contain.

### Data already on people's computers

Today's local database keeps each record as a **Protostuff blob that only the matching Collect version can decode**
(see `CloudRecordSerializer`). The Node program cannot read it. So:

1. The **last Java release** writes every local record as Collect XML (the format of "Export data → XML") into a
   migration folder when it closes for the last time, and says so.
2. The **first Node release** imports that folder into its own store at first start, and reads `earth.properties` for the
   settings, the projects loaded and the operator name.
3. Cloud projects lose nothing either way: their records are on the server.
4. Once the local Collect Earth Cloud keeps its data with Arena (Stage 5b), the first start also sends every imported
   record of a local project to it, so it holds the project's whole history from day one.

### Packaging and updates

- **InstallBuilder (proposed first):** the installers and updaters already ship Node 22.22.0 and the dashboard
  (`node.xml`, `dashboard.xml`). The Java runtime and the jars are replaced by the Node program, bundled with esbuild as
  the dashboard is (`npm run build:local`), plus the native modules built per system and processor (SQLite). The update
  manifest and its `versionId` rule do not change.
- **On the computer:** the local Collect Earth Cloud (today's `dashboard/`) is bundled with the Arena it contains, plus the
  local database (PGlite, or the embedded PostgreSQL binaries per system). An update that changes the database applies
  the migrations, Arena's and Collect Earth Cloud's, at the next start, after a backup.
- **On a server:** nothing more to install. The guided Google Cloud script (Cloud Run and Cloud SQL) and the Docker image
  (`SELF-HOSTING.md`, `DEPLOY.md`) install Collect Earth Cloud with Arena inside, on the same database.
- **Electron (alternative):** the main window becomes a desktop window (tray, menus, quit on close and updates built in).
  Imagery windows still need a real Chrome, since Google blocks sign-in inside embedded browsers.
- **Signing:** Windows needs a code-signing certificate (SmartScreen); macOS needs an Apple Developer ID, the hardened
  runtime and notarization, done on a Mac (a macOS runner), for Apple silicon and Intel.

## Stages

Each stage leaves a working Collect Earth; the Java program is retired only at the end.

| Stage | What | Depends on | Size |
| --- | --- | --- | --- |
| 0 | Trials (S1 to S8, below) | — | S |
| 1 | Arena inside Collect Earth Cloud on servers: surveys and records stored in Arena, the raw copy kept, one sign-in, Arena's pages from the dashboard | S1, S3 | L |
| 2 | The Node program serving the same API, project and settings, local store, plot files, sync, local dashboard in the same process | S5 | L |
| 3 | The survey engine (A or B) | S4 | L |
| 4 | Browsers and windows with Playwright: plots map, Google Earth Web, imagery sources, layout | S2 | L |
| 5 | Packaging, updates and the migration of local data; a public beta next to the Java release | 2, 3, 4 | M |
| 5b | Arena inside the local Collect Earth Cloud: its database on the computer in place of the memory store, the local dashboard reading from it, moving a project from local to distributed | 1, 5, S6 | M |
| 6 | What is left: the LULUCF package, the Google Earth Pro viewer (per decisions 2 and 4) | decisions | M to L |
| 6a | The analysis, layer 1: the view model from the survey, DuckDB-WASM and Perspective in the dashboard (local and cloud), enrichment, saved views, the stand-alone HTML; Saiku and its Tomcat leave the installer | S7 (done, passed); can start before 2; the analysis page done (see "Stage 6a, first part") | M |
| 6b | The analysis, layer 2: estimates through Arena's R chains or a shipped R template | 1, 6a, S7 | M |
| 6c | The AI analyst, steps A to D, on the quality assistant's foundations | 6a, S8 | M |
| 7 | Retire the Java program and Selenium; drop the raw copy of records if decision 1 allows | 5, 6 | S |

### Stage 0: trials

- **S1, Arena and real surveys:** import the surveys of three real projects and a Collect backup of their data into Arena;
  list what fails (expressions, attached files, code lists).
- **S2, Google sign-in through Playwright:** on Windows and macOS, open Google Earth Web in Chrome and Edge started by
  Playwright, and started by Collect Earth then attached; sign in with a Google account; keep the sign-in across restarts.
- **S3, Arena inside Collect Earth Cloud:** run Arena's server in Collect Earth Cloud's process (or beside it in one
  container) on one database; create a survey from a `.cep` and store a record through Arena's own code; give a member
  rights in Arena and open Arena's pages without a second sign-in.
- **S4, the survey engine:** Arena's converter on the same surveys as S1, outside Arena's server; decide A or B.
- **S5, a Node installer:** an InstallBuilder build with the Node program only (a "hello" API and the React app), signed
  and notarized on macOS, installed on Windows and macOS.
- **S6, Collect Earth Cloud with Arena on a laptop:** the local Collect Earth Cloud with its Arena, on PGlite, then on the
  embedded PostgreSQL binaries, on a Windows laptop
  with 8 GB of memory and on a Mac: time to start, memory and disk used, a project of 10,000 plots imported and read, a
  restart after the computer was switched off mid-write, and what antivirus and the firewall say.
- **S7, the pivot table:** see "Presenting the data" (DuckDB-WASM and Perspective against Saiku on the same data). **Done: see "S7 results".** Saiku itself could not be run here (its Tomcat and Java are not in this environment); the figures were checked against SQL and an independent count instead.
- **S8, the AI analyst:** see "The AI analyst" (twenty questions checked against hand-written queries).

### Testing

- **Golden tests against the Java program:** for the demo survey and two real ones, record the Java program's answers to
  every API call the React app makes, and to a script of saves on the form (relevance, errors, calculated values). The Node
  program must give the same JSON.
- **Geometry:** plot shapes and GeoJSON for every shape and coordinate system used in real projects, compared to the
  Java sampler's.
- **Exports:** CSV, XML, Collect backup and KML compared byte for byte where the format allows it, otherwise by content.
- **Browsers:** Playwright's own test runner drives the real windows on Windows and macOS runners.

## Risks

| Risk | Why it matters | What reduces it |
| --- | --- | --- |
| Collect's expressions in JavaScript | Every survey's checks and relevance depend on them | Trial S4; golden tests on real surveys |
| Google sign-in refused | Google Earth Web and Earth Engine apps need it | Trial S2; start Chrome ourselves and attach |
| FreeMarker templates in `.cep` files | The Google Earth Pro viewer renders `kml_template.fmt`; JavaScript FreeMarker engines are partial | Decision 2; if kept, render only the subset Collect Earth's templates use, tested on every known template |
| Arena's Collect import gaps | Data that does not import, or imports wrongly | Trial S1; fixes in Arena's converter, agreed with its team |
| The LULUCF package | 14,500 lines with its own rules | Decision 4; keep it as a Java tool until ported |
| Local data in Protostuff blobs | Unreadable outside Java | The migration export of the last Java release |
| Two programs for a while | Fixes made twice | Freeze Java features once Stage 2 starts; only fixes |
| A database on every laptop | Slow starts, memory, antivirus, a damaged database after a power cut | Trial S6; backups at every close; the sync queue keeps every record until the local Collect Earth Cloud has it |
| Arena built as an application, not as a part of another | Running it inside Collect Earth Cloud may need changes in Arena | Trial S3; agree the changes with the Arena team; else two processes in one container |
| Two permission systems | A member could see in Arena what Collect Earth Cloud would hide | Rights in Arena derived from Collect Earth Cloud's roles only; the isolation tests (`test/isolation.test.ts`) extended to Arena's pages |
| Arena upgrades | A new Arena changes its database or its conversion of Collect surveys | Each Collect Earth Cloud release pins its Arena; upgrades tested on copies of real projects first |
| Customised cubes | A survey's `collectEarthCubes.xml` with MDX calculated members the view model cannot express | Trial S7 ran on the demo survey only (its cube has no calculated member): still to try on a customised `.cep` from a country; the override reads what it can and lists what it could not |
| Wrong figures from the AI analyst | A plausible table built from the wrong measure or filter | The query is always shown and editable; S8's check against hand-written queries; the model never computes, DuckDB does |
| Arena's R chains assume a field inventory | Layer 2 may not fit plot photo-interpretation | Trial S7; fall back to a shipped R template |

## Not in this plan

- Changing the survey designer: surveys stay Collect's.
- Changing the React app's pages, beyond what a different program behind the API needs.
- Moving Collect Earth Cloud's coordination features (division, checks, training, time spent) into Arena: they stay in
  Collect Earth Cloud, which contains Arena.
