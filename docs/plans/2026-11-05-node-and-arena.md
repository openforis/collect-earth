# Collect Earth without Java, with Arena as the data backend — Plan

**Date:** 2026-11-05 · **Branch:** ce-2026-GEW · **Status:** plan for future development, for the owner to approve. Nothing
here is built yet.

## Goal

Two moves, which can be made separately:

1. **Collect Earth's desktop program moves from Java to Node.js** (TypeScript). The pages people use are already a
   React app (`collect-earth-app/src/main/frontend`) that talks to the Java program only through a JSON API. Only the
   program behind that API changes. The installers keep shipping one program for Windows, macOS and Linux.
2. **Open Foris Arena becomes the data backend.** Arena keeps the survey and the collected plots for analysis and long-term
   storage, next to (and later in place of) the storage of Collect Earth Cloud. It runs **on the interpreter's own
   computer** when the collection is local, and **on a server** when it is distributed.

## Requirements (from the owner, 5 Nov 2026)

1. **Arena works both locally and on servers** (added 5 Nov 2026): on `localhost` when the data collection takes place on
   one computer (set-up 1 of the guide *Collect Earth data collection: four ways to set it up*), and on a cloud server, the
   shared one or a private one, when it is distributed between several interpreters (set-ups 3 and 4). The same Arena, the
   same Collect Earth, the same way of sending plots: only the address changes. See "Arena in two places" below.
2. **The Collect survey definitions and the `.cep` project files stay** (below).

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

1. **Arena's role.** Settled in part by requirement 1: Arena is the backend in both kinds of collection, on the computer and
   on servers, and Collect Earth sends plots to it the same way in both. Still to decide: (a) whether Arena starts as a store
   downstream of Collect Earth Cloud, fed by it (recommended first, Stage 1), before Collect Earth sends to it directly;
   (b) where the coordination of a distributed collection lives (assignments, division, checks, reference plots, training,
   time spent): in Collect Earth Cloud, reading from and writing to Arena, or moved into Arena itself.
2. **Google Earth Pro.** Keep the Google Earth Pro viewer (KML and the balloon) or keep only the plots map and Google Earth
   Web. Keeping it means rendering the `.cep`'s FreeMarker template `kml_template.fmt` in Node (see Risks).
3. **Firefox.** Playwright drives only its own modified Firefox, not the one people install. Proposed: support Chrome and
   Edge (Edge is on every Windows 10 and 11), and drop Firefox.
4. **Saiku and the LULUCF package.** Port them, keep them as a separate Java tool started on demand, or replace them with
   Arena's analysis (to verify what Arena offers).
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
                                                         ├─ sync (to an Arena: on this computer or on a server)
                                                         └─ local dashboard (the cloud server in LOCAL_MODE, same process)

Local collection:        Collect Earth ──sync──▶ Arena on 127.0.0.1 (started by Collect Earth, local PostgreSQL)
Distributed collection:  Collect Earth ──sync──▶ Arena on a server (shared or private) ◀── coordinators' browsers
```

- **One Node process.** The local dashboard is already the cloud server run by Node; the new desktop program serves the
  desktop API and the dashboard from the same process, so the two never disagree.
- **The API stays.** The endpoints of `server/api` and the form's (`surveyForm`, `placemark-info-expanded`,
  `save-data-expanded`, `plot-activity`) keep their paths and JSON. The React app and its tests (about 300) do not change; the
  Java answers become the reference the Node ones are tested against (golden tests, below).

### The record format: Collect XML, converted only at Arena's door

The desktop and Collect Earth Cloud already exchange records as **Collect record XML plus a flat summary** (the
`RecordEnvelope` of `CloudRecordSerializer`). The Node program stores exactly that in its local SQLite file, one row per
record, as the cloud server does. Consequences:

- Collect Earth Cloud, its figures, its exports and its Collect backups do not change.
- `.cep` files and their surveys stay readable by Collect itself, and data can always be opened in Collect.
- Conversion to Arena's model happens in one place, at the boundary (Stage 1), not in every program.

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

### Arena in two places: on the computer and on a server

The same Arena code runs in both, and Collect Earth talks to both the same way; what differs is who starts it, where its
database lives, and who signs in.

| | Local collection (one computer) | Distributed collection (several interpreters) |
| --- | --- | --- |
| Where Arena runs | On the interpreter's computer, at `127.0.0.1`, started and stopped by Collect Earth | On a server: the shared one or a private one |
| Its database | PostgreSQL on the computer, in Collect Earth's user folder (see "A database on every computer") | PostgreSQL on the server (Cloud SQL, or the organisation's) |
| Who signs in | Nobody: one local account, made at first start, and a one-time sign-in link to open Arena in the browser, as the local dashboard does now | Everyone with their own account, invited to the project |
| How the survey gets there | Collect Earth sends the survey of the `.cep` it opened | The coordinator uploads the `.cep`; the server sends its survey (with the hidden `round`) |
| How plots get there | Collect Earth's sync, within seconds of each save | Collect Earth's sync, every 30 seconds, queued while offline |
| Who can see the data | Only that computer (`127.0.0.1` only, never the network) | The project's members, by role |
| Coordination (division, checks, training) | Not needed | Decision 1b |

**One sync, two addresses.** Collect Earth always keeps its own local store and sync queue (Collect XML per record), in
both kinds of collection, and sends the records to "its Arena": the local one, or the one on the server. So:

- working offline is the same in both: the queue waits;
- a local Arena that is not running (it failed to start, or is being updated) loses nothing: the queue sends later;
- the local dashboard and the server's dashboard read the same kind of data.

**From local to distributed.** A project that starts on one computer and grows into a team does not need an export by
hand: the coordinator puts the `.cep` on the server, the interpreter joins it, and Collect Earth sends every record of
the project from its local store to the server's Arena, as the cloud sync's reconciliation does today. The local Arena can
then be stopped. The other way (a server project continued alone, offline for good) is a Collect backup from the server
imported into the local Arena.

**The same version on both sides.** Collect Earth bundles the local Arena, so every Collect Earth release names the Arena
version it ships. A server running an older or newer Arena must still accept Collect Earth's sync: the sync uses one
documented, versioned interface (as `/v1` is for Collect Earth Cloud today), and the server says which versions it
accepts.

#### A database on every computer

Arena keeps its data in PostgreSQL. On a server that is given; on an interpreter's laptop it must come with Collect Earth,
start in seconds, use little memory, and never ask the person anything. Three candidates, to be tried (S6):

| | Embedded PostgreSQL binaries | PGlite (PostgreSQL compiled to WebAssembly) | A store adapter |
| --- | --- | --- | --- |
| What | The real PostgreSQL server, shipped per system (Windows, macOS on Apple silicon and Intel, Linux) and started by Collect Earth on a free local port | PostgreSQL inside the Node process, data in a folder; reached by Arena through a local socket | Arena's data layer gets a second implementation over SQLite, used only locally |
| Size | About 30 to 60 MB per system | About 10 MB | None extra |
| Fidelity | The same as on the server | Close; some extensions missing (PostGIS, if Arena needs it, to verify) | Arena's queries rewritten: large and lasting work |
| Risks | Antivirus and firewalls on Windows; signing every binary on macOS; a second process to keep alive | Whether Arena's database library works over it; speed on large projects | Two data layers to keep in step |

Proposed: try PGlite first, fall back to the embedded binaries. The store adapter only if both fail.

The local database lives next to Collect Earth's other files, in the user folder, and is backed up when Collect Earth
closes, as the SQLite file is today (`backupSqlite`, the newest 10 kept).

### Arena

- **Survey:** when a `.cep` is uploaded to Collect Earth Cloud (or a new version), the server sends Arena the survey it
  hands out (with the hidden `round` and the coordinator's comment field, where added) through Arena's Collect import.
- **Data:** the server builds a Collect backup of the project (`collectBackup.ts`: `idml.xml` and one XML per record) and
  imports it into Arena, on a schedule and on demand. Its layout must be checked against what Arena's Collect import
  expects (Collect's own backups also carry an `info.xml`).
- **Keys:** the plot id and `round` are the record keys in both systems.
- **Collect Earth's bookkeeping answers** (operator, actively saved, plot file, …) are ordinary questions of the survey:
  they come through.
- **What Arena does not get:** the form (`balloon.html`), the map template and the project settings: they are Collect
  Earth's, and stay in the `.cep`.
- **The desktop sending to Arena directly:** both the local Arena and a server's need an interface through which a program
  sends records one by one (or in small batches), signs in with a token, and learns which records were stored. To verify
  with the Arena team (S3); if Arena has none yet, it is the first thing to build there, since requirement 1 depends on it.
  Conversion from Collect XML happens in that interface or in Collect Earth's sync step.

### Data already on people's computers

Today's local database keeps each record as a **Protostuff blob that only the matching Collect version can decode**
(see `CloudRecordSerializer`). The Node program cannot read it. So:

1. The **last Java release** writes every local record as Collect XML (the format of "Export data → XML") into a
   migration folder when it closes for the last time, and says so.
2. The **first Node release** imports that folder into its own store at first start, and reads `earth.properties` for the
   settings, the projects loaded and the operator name.
3. Cloud projects lose nothing either way: their records are on the server.
4. Once the local Arena runs (Stage 5b), the first start also sends every imported record of a local project to it, so
   the local Arena holds the project's whole history from day one.

### Packaging and updates

- **InstallBuilder (proposed first):** the installers and updaters already ship Node 22.22.0 and the dashboard
  (`node.xml`, `dashboard.xml`). The Java runtime and the jars are replaced by the Node program, bundled with esbuild as
  the dashboard is (`npm run build:local`), plus the native modules built per system and processor (SQLite). The update
  manifest and its `versionId` rule do not change.
- **The local Arena** ships in the same installers and updaters: Arena's server bundled like the dashboard, and the local
  database (PGlite, or the embedded PostgreSQL binaries per system). An update that changes Arena's database applies
  Arena's migrations to the local database at the next start, after a backup.
- **The server Arena** is installed as Collect Earth Cloud is today: the guided Google Cloud script (Cloud Run and Cloud
  SQL) and a Docker image for other hosts (`SELF-HOSTING.md`, `DEPLOY.md`), extended to Arena.
- **Electron (alternative):** the main window becomes a desktop window (tray, menus, quit on close and updates built in).
  Imagery windows still need a real Chrome, since Google blocks sign-in inside embedded browsers.
- **Signing:** Windows needs a code-signing certificate (SmartScreen); macOS needs an Apple Developer ID, the hardened
  runtime and notarization, done on a Mac (a macOS runner), for Apple silicon and Intel.

## Stages

Each stage leaves a working Collect Earth; the Java program is retired only at the end.

| Stage | What | Depends on | Size |
| --- | --- | --- | --- |
| 0 | Trials (S1 to S6, below) | — | S |
| 1 | Arena downstream of Collect Earth Cloud (distributed collection first) | S1, S3 | M |
| 2 | The Node program serving the same API, project and settings, local store, plot files, sync, local dashboard in the same process | S5 | L |
| 3 | The survey engine (A or B) | S4 | L |
| 4 | Browsers and windows with Playwright: plots map, Google Earth Web, imagery sources, layout | S2 | L |
| 5 | Packaging, updates and the migration of local data; a public beta next to the Java release | 2, 3, 4 | M |
| 5b | The local Arena: bundled, started and stopped by Collect Earth, its database on the computer, the sync pointed at it for local projects, moving a project from local to distributed | 5, S6, the sync interface of S3 | M |
| 6 | What is left: Saiku, the LULUCF package, the Google Earth Pro viewer (per decisions 2 and 4) | decisions | M to L |
| 7 | Retire the Java program and Selenium; Collect Earth Cloud reads from Arena if decision 1b | 5, 6 | S |

### Stage 0: trials

- **S1, Arena and real surveys:** import the surveys of three real projects and a Collect backup of their data into Arena;
  list what fails (expressions, attached files, code lists).
- **S2, Google sign-in through Playwright:** on Windows and macOS, open Google Earth Web in Chrome and Edge started by
  Playwright, and started by Collect Earth then attached; sign in with a Google account; keep the sign-in across restarts.
- **S3, Arena's interfaces:** how a program (not a person in the browser) imports a survey and a Collect backup, signs in,
  and whether a client can send single records.
- **S4, the survey engine:** Arena's converter on the same surveys as S1, outside Arena's server; decide A or B.
- **S5, a Node installer:** an InstallBuilder build with the Node program only (a "hello" API and the React app), signed
  and notarized on macOS, installed on Windows and macOS.
- **S6, Arena on a laptop:** Arena's server with PGlite, then with the embedded PostgreSQL binaries, on a Windows laptop
  with 8 GB of memory and on a Mac: time to start, memory and disk used, a project of 10,000 plots imported and read, a
  restart after the computer was switched off mid-write, and what antivirus and the firewall say.

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
| A database on every laptop | Slow starts, memory, antivirus, a damaged database after a power cut | Trial S6; backups at every close; the sync queue keeps every record until the local Arena has it |
| Local and server Arena on different versions | Collect Earth's sync refused by an older or newer server | One versioned sync interface; the server says which versions it accepts |
| Arena has no interface for a client to send records | Requirement 1 cannot be met without it | Trial S3; build it with the Arena team before Stage 5b |

## Not in this plan

- Changing the survey designer: surveys stay Collect's.
- Changing the React app's pages, beyond what a different program behind the API needs.
- Collect Earth Cloud's coordination features (division, checks, training, time spent): they stay in Collect Earth Cloud
  until decision 1b says otherwise.
