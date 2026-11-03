# The dashboard inside Collect Earth, without the cloud — Plan

**Date:** 2026-11-03 · **Branch:** ce-2026-GEW · **Status:** plan, for the owner to approve

## Goal

A person who collects alone, with no cloud project, gets the dashboard improvements on their own computer:
- progress and the forecast;
- the map of progress;
- their own answers and the survey's health;
- the pattern flags as a self-check;
- the activity log and the weekly summary;
- plot search and the plot page;
- the data downloads.

Everything about other people stays out: dividing plots, assignments, invitations, roles, check sampling,
reference plots, the review queue, progress links, emails and the server panel.

The person is the same one everywhere ("you"). Step 1 of this work, already pushed in `25cedb90`, made the desktop
show one name: the cloud account when a cloud project is joined, otherwise "Your name". Records keep their
`operator` field unchanged.

## Decision: one dashboard, run locally by a bundled Node

The desktop's web UI and the dashboard use the same stack, at the same versions: React 19.3.1, MUI 9.5.0,
Leaflet 1.9.4 and Vite 8.3.4. The dashboard's figures, though, are computed by the cloud server in TypeScript (`src/progress.ts`,
`quality.ts`, `answerStats.ts`, `flags.ts`, `surveyHealth.ts`, `plotsGeo.ts`, `activityLog.ts`, `weekly.ts`). The two ways
to bring them to the desktop are:

- **Bundle Node and run the cloud server locally, in a single-person mode** (chosen). One code base: every fix and
  feature of the cloud dashboard reaches the desktop. It costs the Node runtime in the installer, about 30 MB compressed and
  85 MB on disk per platform, and a second local process.
- Rewrite the figures in Java: no new runtime, but two copies of every calculation to keep equal. Rejected.

## How it works

```
 Collect Earth (Java, :8028)                         Local dashboard (Node, 127.0.0.1:<free port>)
 ───────────────────────────                         ───────────────────────────────────────────────
 LocalDashboardService starts node ─────────────────▶ collect-earth-cloud in LOCAL_MODE
 each save (CloudSyncQueueDao, a local sink) ───────▶ POST /v1/projects/<local>/records:batch
 at start: every record of the database ────────────▶ the same, in batches (rebuilds the state)
 the CEP and the plot file ─────────────────────────▶ PUT /cep, PUT /csv-files/<name>
 Menu "My dashboard" ──── opens ────────────────────▶ /projects/<local>/progress, signed in automatically
```

- **The desktop's database stays the only truth.** The local server keeps its state in memory and is fed again
  from the desktop's records at each start. Its record events take their time from each record's `modifiedOn`
  (`src/routes/records.ts`, `RecordEvent.modifiedOn`), so progress, the forecast, the log and the weekly summary get
  their real dates back. Only intermediate saves are lost: the desktop keeps a plot's latest state, not each draft.
  Nothing has to be migrated, backed up or kept in sync with a second database.
- **Single-person mode (`LOCAL_MODE=1`):**
  - it binds to 127.0.0.1 only;
  - there is one account, made at start, signed in through a one-time token the desktop passes in the URL;
  - one project, with you as both coordinator and collector;
  - sign-up, invitations, mail, the server panel and the routes for other people are switched off (404);
  - the web app hides their tabs and cards (`serverInfo.localMode`).
- **The feed reuses the cloud sync.** `CloudSyncService` already queues every save (`CloudSyncQueueDao`) and sends
  records:batch with the desktop's envelope (`CloudRecordSerializer`). A second destination, local, uses the same
  queue and client, with no new format.

## Tasks

### Task 1: Node in the installer and the dev build (done, see below)
- **Pin one version:** Node v22.22.0, already the build's version through frontend-maven-plugin.
- **Installer:** `collect-earth-installer` downloads the official Node archive per platform, the way `unpack-jre`
  does the JRE (`jre.version`, `ensure-jres`). It verifies each archive's SHA-256 against Node's signed
  `SHASUMS256.txt` and unpacks it into the install folder, as `node/`. Windows x64, macOS (arm64, x64) and Linux x64
  are the platforms the installers already cover.
- **Updates:** the updater ships `node/` with `earth-libs`, so a Node update reaches existing installations.
- **Dev builds:** `dev-run` finds `collect-earth-app/src/main/frontend/node`, the Node the Maven build already
  downloads, so developers need nothing new.
- **Size check:** the installer grows by about 30 MB. Measure it on the first build and record it here.

**Done (2026-11-03), except the InstallBuilder build itself, which needs a machine with InstallBuilder.**
- `collect-earth-installer/pom.xml`: `node.version` 22.22.0 and `node.shasums.sha256` (the SHA-256 of the release's
  `SHASUMS256.txt`, whose clearsigned `.asc` was checked against nodejs/release-keys: good signature, Marco Ippolito's
  key). `ensure-node` (assembly profile, `initialize`) downloads the four archives into the local repository as
  `org.nodejs:node:22.22.0:<type>:<classifier>` when missing and checks them at every build; `unpack-node` unpacks
  them into `target/installer/node_files`. `-Dnode.ensure.skip=true` skips the download and checks. CLAUDE.md, "The
  bundled Node", has the details and how to bump the version.
- `src/main/resources/node.xml`, included by `CollectEarthWithSaiku.xml` and `CollectEarthUpdater.xml`: installs
  `<installdir>/node/node` (`node.exe`) and `node/LICENSE`; on macOS both binaries are packed and the machine's is
  installed. The old `node/` is set aside and restored on a cancelled installation, as `java.xml` does with the JRE.
- **Only `node` and `LICENSE` ship:** npm, npx, corepack and the headers are trimmed, since nothing runs npm on the
  user's computer (Task 2 bundles the server).
- **Dev builds:** `dev-run.cmd` is unchanged. It runs from `collect-earth-app`, and both layouts are flat, so Task 5
  looks for `node/node[.exe]` (installed) and then `src/main/frontend/node/node[.exe]` (frontend-maven-plugin), both
  relative to the working folder.
- **Measured.** "Compressed" is xz -9 of what ships, an estimate of InstallBuilder's lzma:

  | Platform | Archive downloaded | Unpacked in full | What ships, on disk | Compressed (installer growth) |
  |---|---|---|---|---|
  | Windows x64 (zip) | 35.6 MB | 99.0 MB | 85.9 MB | 21.9 MB |
  | Linux x64 (tar.xz) | 30.8 MB | 197.7 MB | 123.5 MB | 28.4 MB |
  | macOS arm64 (tar.gz) | 49.9 MB | 185.9 MB | 111.8 MB | 23.2 MB |
  | macOS x64 (tar.gz) | 51.1 MB | 188.4 MB | 114.3 MB | 24.8 MB |

  The .dmg and the macOS updater carry both, about 48 MB more. Each updater grows by the same amount as its
  installer, at every release, since Node is not part of the updater baseline.
- **Still to check on the build machine:** one `-P assembly` build with InstallBuilder (the actual size of each
  installer, and that `node.xml` installs `node/` and leaves out the other macOS binary), and an update over an
  installation.

### Task 2: The server as files Node runs directly
- Bundle `collect-earth-cloud/src/index.ts` and `src/qualityWorker.ts` with esbuild into `dist/server.mjs` and
  `dist/qualityWorker.mjs`. This removes tsx at run time and node_modules from the installer.
  - `qualityService.ts` already loads `qualityWorker.js` beside it when not run from `.ts` (`WORKER_URL`). Check that
    the bundled worker is found.
  - The Postgres client and the AI client are left out of the local bundle.
- The Maven build copies `dist/` and `web/dist/` into `collect-earth-app/target/dashboard/`, and the installer
  ships them.
- **Test:** start the bundle with plain `node dist/server.mjs` in memory mode and run the existing e2e test against it.

### Task 3: LOCAL_MODE in the server
- Add a `config.localMode` setting. With it:
  - bind 127.0.0.1;
  - no `SETUP_CODE`;
  - at start, create the account and the project (with a stable id, so dashboard links survive restarts) and a
    one-time sign-in token, printed on stdout for the desktop to read;
  - turn sign-up, invites, `/v1/admin/*`, mail and digests, share links, AI, sampling, reference plots,
    division and assignments off: 404, and absent from `/v1/server-info`.
- Keep in `/v1/server-info` only what the web app needs to hide the rest (`localMode: true`).
- **Tests:** the routes that are off answer 404; the one account can do every remaining thing; a second
  account cannot be created; the server listens only on loopback.

### Task 4: The dashboard's single-person view
- When `serverInfo.localMode` is set:
  - Tabs shown: Progress, Map, Data, Quality, Activity and Settings (progress settings only). People, Plot files
    and Setup are hidden. The project switcher and Account go, since there is one of each.
  - **Quality:** keeps Answers, as the plain distribution of your answers per question (decision 4: no "rest of the
    team", no flags against the team), plus Survey health and Pattern flags. Checks, Reference plots, the Review
    queue and Differences are hidden.
  - **Settings:** the progress settings (deadline, target, quiet days) stay, and are where the forecast is set
    (decision 3).
  - **Progress:** the "Needs attention" cards about other people are left out (quiet people, plots not given,
    old project files).
- Texts: "you" throughout. Add new i18n keys in the 4 languages where a coordinator's wording ("each person") does
  not fit.
- **Tests:** view tests per tab with `localMode`; a Chrome run at desktop and phone width, with seeded local data.

**Done (2026-11-03), in `collect-earth-cloud/web` only; the cloud's view is unchanged without `localMode`.**
- `ServerInfo.localMode` (`api.ts`), `useLocalMode()` (`appContext.ts`). `src/localMode.ts` holds every choice, pure:
  the tabs, where each address leads, and what each tab shows.
- **Pages:** signed out, a page says to open the dashboard again from Collect Earth (no log-in form: there is no
  password). Home goes to the one project's Progress tab; People, Plot files, Setup, a person's or a plot file's page,
  My work, My quality and the team report go to Progress; account, server, setup, log-in, sign-up and the links of
  mail, invitations, resets and progress links go home. The app bar says "My Collect Earth dashboard" and has no
  account menu (projects, account, password, log-out); no bell (its cards are about other people).
- **Progress:** plots, submitted, started, not started (not "given to someone"); no "Needs attention" at all (every
  card is about other people, checks or the server's storage, and points to a hidden tab). With no target, the
  forecast asks for one in Settings.
- **Map:** no person filter, holders or links to plot files; the legend lists not started, started and "Submitted"
  (and any other status that has plots); no note about quality figures or decisions.
- **Data:** the data download only, "one line for each plot" (the Collect Earth backup is left out: the desktop's
  database already holds every record).
- **Quality:** Plots worth a look (no person filter, names or counts per person; "your previous plot"), Your answers
  (no person filter, no "rest of the team", no flags against the team; one row, "Your plots"), Survey health (no
  agreement or decision columns or notes). No counts, report links, review queue, checks, reference plots,
  comparison, differences, notes, data problems or AI (`/quality` itself is not asked for).
- **Activity:** the weekly summary (plots done without checks, plots worth a look; no one else's week), the log
  ("You submitted plot 17", "Collect Earth sent the plot file …"; no person filter; kinds: Collect Earth's,
  files, settings, downloads), the daily activity download only.
- **Settings:** the progress card only (deadline, target, quiet days), with "you" help texts.
- **A plot's page:** no decision, differences, holders or names.
- 45 new i18n keys in en, es, fr and pt (`…Local`, `local.*`, `answers.yourPlots`).
- **Tests:** `localMode.test.ts` (24 tests, a describe per tab, cloud unchanged alongside) and server-info parsing in
  `api.test.ts`; web 385 tests pass, `tsc --noEmit` clean; server tests pass but the 2 known `qualityService` worker
  failures of this container.
- **Chromium (Playwright), desktop 1280 and phone 390, en and es,** against `npm run build:local` + `vite build`
  with `LOCAL_MODE=1`, fed the demo CEP, a 40-plot file, 30 records and progress settings: every tab, a plot page,
  the weekly summary and the redirects. No API answer of 400 or more (so no off route asked for), no page error, no
  sideways scroll. Only the map tiles failed (no internet in the container). `WEB_DIR` must be absolute (a relative
  one stops the start: fastify-static's `root`); the README's example uses a relative one.

### Task 5: The desktop starts it and feeds it (done, see below)
- **`LocalDashboardService` (collect-earth-app):**
  - starts `node dashboard/server.mjs` with LOCAL_MODE once the project is loaded, with a free port, and a log in
    the user folder (`dashboard.log`);
  - restarts it once if it dies;
  - stops it on exit, including when Collect Earth is killed (`Process.destroy` on a shutdown hook, plus the
    child noticing its parent's end).
- Cloud mode does not start it: the cloud dashboard already exists.
- **Initial feed:** after the start, send the CEP, the plot file and every record of the project, in batches,
  through the existing serializer. Measure the time on 10,000 records; the target is under 30 s, in the
  background, with the menu entry showing "Getting ready…" until it is done.
- **Live feed:** each save goes to the local server through the sync queue (a local destination next to the cloud
  one), so the dashboard follows within seconds.
- **Changing project, survey or plot file:** restart the local server and feed it again.
- **Tests:** a Java test with a fake Node, for start, stop, restart and the port. An integration test that starts
  the real bundle, feeds the test survey's records and reads `/progress`.

**Done (2026-11-03), in `collect-earth-app`, package `service.dashboard`:**
- `LocalDashboardService` (a bean, `ContextRefreshedEvent`, skipped when `isUsingCloudDB()`): everything runs on one
  daemon thread, so the start of Collect Earth waits for nothing. It finds `node/node[.exe]`, else
  `src/main/frontend/node/node[.exe]`, and `dashboard/` (installed), else `target/dashboard/` (built), each holding
  `server.mjs` and `web/index.html`; without them its state is `UNAVAILABLE` and nothing starts.
  `LocalDashboardProcess` runs `node <dir>/server.mjs` (LOCAL_MODE=1, PORT=0, HOST=127.0.0.1, WEB_DIR absolute,
  LOCAL_USER = the operator, LOCAL_PROJECT_ID = a name-based UUID of the survey's URI, LOCAL_PROJECT_NAME = the
  survey name; `NODE_OPTIONS` removed), stderr appended to `dashboard.log` in the user folder (begun again past 5 MB),
  and waits up to 60 s for the ready line.
- **States** for Task 6: `OFF` (cloud project, or quitting), `UNAVAILABLE`, `STARTING`, `FEEDING`, `READY`, `FAILED`;
  `getStateText()` gives the menu's text (`LocalDashboard.*` in Messages, en/es/fr/pt) and `newSignInUrl()` a new
  one-time link (POST /v1/local/sign-in-links), or null when it is not running.
- **Feed:** PUT /cep (the project folder zipped again, files above 10 MB such as the guide PDF left out), PUT
  /csv-files/<plot file name>, then every record (`RecordManager`, not validated) in batches of 200, through
  `CloudRecordSerializer` and `CloudApiClient`, which now takes a `Destination` (base URL, project, token) besides the
  cloud project of the settings. Envelopes are sent under the ready line's username (`RecordEnvelope.withOperator`).
- **Live feed:** a second `RecordSavedListener` notes each saved key; every 2 s the keys go out in records:batch.
  *Unlike the plan*, not through `CloudSyncQueueDao`: its table has no destination column, and a durable queue buys
  nothing here, since the dashboard is fed everything again at each start.
- **Restarts:** a server that ends, or does not start, is started once more, on a new port, and fed again; the second
  time the state is `FAILED`. A change of the survey, the project folder or the plot file (path, size, date; checked
  every 15 s) starts it again and feeds it again: a new project or survey relaunches Collect Earth anyway, a new plot
  file from the settings does not.
- **Stop:** `@PreDestroy` (Quit and restart close the Spring context), and a JVM shutdown hook. When Collect Earth is
  killed the server is left running: its pid is in `dashboard.pid`, and the next start ends it (if it is a Node
  running `server.mjs`). *Still to do in collect-earth-cloud:* the server noticing its parent's end by itself (e.g.
  exit when stdin closes, which the desktop leaves open as a pipe).
- **Maven:** `collect-earth-app` copies `../../collect-earth-cloud/dist` and `web/dist` into `target/dashboard` and
  `target/dashboard/web` at `process-resources` (maven-resources-plugin), and skips them when absent, so the Java build
  needs no npm.
- **Measured** (this container, Node 22.22.0): 10,000 records of the demo survey fed in 27.8 s, of which 22.4 s were the
  test making and serializing the records in Java and 5.4 s sending them and the server storing them; the first
  `/progress` after it took 0.2 s. On the desktop the records are loaded from the database instead of made; Task 7
  measures that.
- **Tests:** `LocalDashboardServiceTest` (fake Node: start, the ready line, the port, the environment, the feed and its
  operator, the live feed, restart once then `FAILED`, a silent start, stop, a new plot file, a real `/bin/sh` process
  for stderr to the log and stop); `LocalDashboardIntegrationTest` (the real bundle, the demo project and its records,
  `/progress`, a live save, the sign-in link, the stop; `DASHBOARD_FEED_10K=1` for the timing above), skipped without
  Node or the bundle.
- **What the installer still needs** (not done): build the bundle in the release (`npm ci && npm run build:local` in
  `collect-earth-cloud`, `npm ci && npx vite build` in `web`) before `collect-earth-app`, and fail the `assembly` build
  when `target/dashboard/server.mjs` is missing; a `dashboard.xml` like `node.xml`, included by
  `CollectEarthWithSaiku.xml` and `CollectEarthUpdater.xml`, installing `collect-earth-app/target/dashboard` as
  `<installdir>/dashboard` (`server.mjs`, `qualityWorker.mjs`, `server.mjs.LEGAL.txt`, `web/`), replacing the old
  folder whole so no stale asset stays; and the updaters carry it at every release (it changes with the cloud code).

### Task 6: Opening it
- A menu entry "My dashboard" (Tools), and a link on the home page and in the plots map's sidebar. It opens the local
  URL with the one-time token in the default browser (decision 1).
- **Tests:** the menu entry, and the token being single use.

**Done (2026-11-03, e190be95), the menu entry only.** Tools > My dashboard (`myDashboard` in `menus.ts`), absent in a
cloud project and as a client of another Collect Earth. It runs the `openDashboard` action (`ActionsController`):
a new link from `LocalDashboardService.newSignInUrl()`, opened with `CollectEarthUtils.openUrl` (the default
browser); while the dashboard cannot be opened, `dashboard.notReady` with `getStateText()` ("Getting ready…", the
failure and its log, or not installed). The links on the home page and in the plots map's sidebar are not done: the
plots map files are being changed by the GEW work, so they wait for it.

### Task 7: Real runs (CE OFFICE)
- Measure on a real project:
  - the start-up added to Collect Earth's (the target is none, since the dashboard starts in the background);
  - the dashboard's memory;
  - the first feed with the user's backed-up 1 GB database.
- Check every shown page against the desktop's own figures (plots saved, per status).

## Owner decisions (taken 2026-11-03)
1. **Where it opens:** in the default browser.
2. **Who gets it:** everyone working on their own (no setting to turn it on); cloud projects keep the cloud dashboard.
3. **The forecast's deadline and target:** set in the dashboard's Settings tab (local), as in the cloud.
4. **Answers when alone:** the plain distribution of your answers (no comparison with earlier weeks for now).

## Risks
- **Antivirus software** on Windows may flag a second process listening on a port. It binds 127.0.0.1 only, and
  `node.exe` is Node's signed binary, but this should be checked on a managed FAO laptop before release.
- **Memory:** the server in memory mode holds every record's summary; about 150 MB for 100,000 plots is expected (Task 22
  measured 354 MiB peak for the cloud image under load). Measure in Task 7.
- **Two copies of the dashboard code ship** (cloud and desktop) from the same commit. The cloud's tests cover both,
  and the local mode adds its own.
