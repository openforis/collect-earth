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

### Task 1: Node in the installer and the dev build
- **Pin one version:** Node v22.22.0, already the build's version through frontend-maven-plugin.
- **Installer:** `collect-earth-installer` downloads the official Node archive per platform, the way `unpack-jre`
  does the JRE (`jre.version`, `ensure-jres`). It verifies each archive's SHA-256 against Node's signed
  `SHASUMS256.txt` and unpacks it into the install folder, as `node/`. Windows x64, macOS (arm64, x64) and Linux x64
  are the platforms the installers already cover.
- **Updates:** the updater ships `node/` with `earth-libs`, so a Node update reaches existing installations.
- **Dev builds:** `dev-run` finds `collect-earth-app/src/main/frontend/node`, the Node the Maven build already
  downloads, so developers need nothing new.
- **Size check:** the installer grows by about 30 MB. Measure it on the first build and record it here.

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

### Task 5: The desktop starts it and feeds it
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

### Task 6: Opening it
- A menu entry "My dashboard" (Tools), and a link on the home page and in the plots map's sidebar. It opens the local
  URL with the one-time token in the default browser (decision 1).
- **Tests:** the menu entry, and the token being single use.

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
