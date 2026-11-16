# Plots from the server for cloud projects — design

Date: 16 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: decided (below); stages 1 and 2 built.**

## What is asked

- **People who work alone** (a project file opened in Collect Earth, SQLite or an office PostgreSQL): nothing changes.
  The project file (CEP) keeps its plot file (CSV) inside, and Collect Earth reads it from the project folder.
- **Projects on a cloud server**: the plots live in one place, on the server. Each Collect Earth loads the person's
  plots from the server, not from a CSV that travels in the CEP or is handed around. Dividing the work becomes a
  matter of choosing who does which of the project's plots, not of making and sending many CSV files.
- **One CEP for both**: the CEP still carries its CSV, so the same file works for someone alone. A cloud project is
  made from that same CEP.

## Where things stand

Much of the server side exists already. The gaps are mostly in how Collect Earth takes the plots, and in the
coordinator still working file by file.

**On the server (`collect-earth-cloud`)**

- Plot files are stored per project (`csv_files`). When a CEP is uploaded, the dashboard takes the CSVs of its
  `grid/` folder into plot files, offering to merge those with the same columns (`web/src/project/FileTab.tsx`,
  `file.gridChoice`). Plot files also come from a design over an area, SIGRID, a CEO project or a backup.
- A file is given **whole** to people (`assignments`) or **divided** (`plot_assignments`, per plot):
  - evenly or by a column, with overlap copies for quality checks;
  - moving unfinished plots;
  - invitation links that hand out the next N plots (`docs/plans/2026-10-29-dividing-plots.md`, `src/invitePlots.ts`).
- `GET /my-assignment` lists the person's files. Each is built for them: only their plots of a divided file, with the
  round and the coordinator's note columns, the reference copies and the "To check again" files
  (`src/routes/assignments.ts:417-529`). Each entry has a checksum and a download path.
- Collectors download the CEP with its plot files **emptied to their header line** (`src/collectorCep.ts`), so they
  see no plot but those given to them. Coordinators and reviewers get it whole.

**In Collect Earth (desktop)**

- Every part of Collect Earth reads the plots from one CSV, the `csv` setting:
  - the Google Earth Pro KMZ;
  - the plots map (`/plotsGeoJson`);
  - the form (`/surveyForm/plot`);
  - the imagery windows;
  - the local dashboard.
- The map and the form cache the file by its path and date; the KMZ is rebuilt only at a start or on a plot reload.
  Extra columns go to the survey's "from CSV" questions **by position**.
- In a cloud project, `AssignedPlotFileSetup` asks `my-assignment`:
  - **only at a start**, and only while the plot file in use is not yet one of the assigned ones
    (`AssignedPlotFileSetup.java:93-104`);
  - with one file, it downloads it into `<project>/assignments/` and sets `csv` to it;
  - with several, it asks the person to **choose one** (Settings › Project);
  - with none, a collector has no plots.
- After that **nothing asks the server again**. Plots a coordinator gives, moves or divides later, or more plots from
  a link, reach the computer only when the person presses Settings › Project › "Refresh assignments", chooses the
  file, then "Apply". The training pages tell people to do exactly that.

So, for the people collecting:

1. **Several files, one at a time.** Their share of a divided file, a "To check again" file and a whole file are
   separate files, and Collect Earth shows one of them at a time.
2. **No updates by themselves.** A change on the server stays there until the person refreshes by hand.

And there are smaller faults when the file is replaced:

3. Downloading the same file name again does not reload the plots, and the KMZ stays as it was (fragile points 1
   and 2 below).
4. The project folder's checksum includes `assignments/`, so once a file is downloaded the project no longer shows as
   the active one in the project list, and "Load" puts back the CEP's empty file.
5. Two assigned files with the same name overwrite each other.

**For the coordinator**, each file is divided on its own. A project with ten plot files has ten divisions to set up
and keep in step, and a plot id can be in two files (both would make the same record key).

## Three ways to load the plots from the server

**A. A link in the CEP** (`csv=https://server/.../plots.csv`): rejected.

- An older Collect Earth, or anyone alone, cannot open it.
- The link needs the person's sign-in.
- It breaks offline, and when the server moves.

**B. Collect Earth reads the plots from the server's API, with no CSV on the computer**: rejected.

- Every part listed above reads a CSV through the same code (`CsvReaderUtils`, `KmlGenerator.getPlotObject`), and all
  of it would change.
- Nothing would work offline.
- Google Earth Pro needs a KMZ made from a file anyway.

**C. One link per person, kept as a CSV on the computer and updated by itself** (recommended).

- The server builds **the person's plots**: everything they hold in the project, in one file, in the survey's column
  order.
- Collect Earth, in a cloud project, keeps a copy of it and points `csv` at that copy. It asks the server every couple
  of minutes whether the list changed, replaces the copy when it did, and reloads the plots.
- Every part of Collect Earth goes on reading a CSV, as it does for someone alone. Offline, the last copy is used.

C answers the request without touching the local way of working: the plot file stays the form Collect Earth reads.
What changes is where the file comes from, and that the server makes one file per person, not one per assignment.

On the coordinator's side, C works with today's files (stage 1). It becomes simpler still when the coordinator sees
**the project's plots** as one set and divides that once (stage 3).

## The design

### 1. The CEP: one format, two uses

- **Alone:** unchanged. The CEP carries its CSV, and `csv=${project_path}/grid/plots.csv` is read from the project
  folder.
- **Making a cloud project:**
  - The coordinator uploads the same CEP. The server takes its plot files into the project's plots.
  - Today the dashboard does this in the browser; it moves to the server's upload (`PUT /cep`), so a CEP uploaded any
    way (the dashboard, the API, a copy of a project) brings its plots the same way.
  - Files with the same columns are merged, as the dashboard offers now.
- **Served to people collecting:** the CEP with its plot files emptied to the header, as today. An older Collect Earth
  opens it as now.
- **Back to working alone:** from the dashboard, "Download for working alone": the CEP with plots in it, either a
  person's or all of them. For someone going where there is no internet, or a project leaving the cloud. The CEP
  stays the unit people already know.

### 2. The person's plots (server)

- `GET /v1/projects/:pid/my-plots` → `{ version, checksum, plots, columns, sources }`. It is small, and Collect Earth
  asks it every couple of minutes:
  - `version` changes whenever what the person holds changes;
  - `sources` gives how many plots come from each plot file, for the Settings card.
- `GET /v1/projects/:pid/my-plots.csv` → the file, with `ETag` = its checksum (`304` when unchanged).
  - **Header:** the survey's columns, in the order Collect Earth needs: the keys, `YCoordinate`, `XCoordinate`, then
    the "from CSV" questions. The round and note columns are added as the server adds them today.
  - **Rows:** every plot the person holds:
    - whole files given to them;
    - their plots of divided files;
    - plots from a link;
    - reference copies;
    - copies to check again.
  - **The survey's column order, by header name.** The server writes each row's values in the survey's column order,
    matched by the header's names. A file with the same columns in another order no longer shifts answers into the
    wrong questions (fragile point 3 below). A file lacking a key or a coordinate column is refused when it is
    uploaded.
  - **The plot's file, kept.** A last column, `plot_file`, carries the name of the file each plot came from. See
    "Points to get right".
  - **A plot in two files** that a person holds twice is written once.
- **Learning sets** stay apart, as today. They are attempts with their own start and their own feedback; mixing them
  into the work would be confusing. A person in training opens the set from the training card, and goes back to their
  plots afterwards.
- **Coordinators and reviewers** get the plots they hold, as everyone does. A project may have hundreds of thousands
  of plots, so a coordinator chooses which ones they assess (they give themselves plots, as they give anyone) rather
  than Collect Earth loading them all.
- **`my-assignment` stays** for older Collect Earth.
- **Cost:** a person's file is built once per `version` and kept, so the check every couple of minutes costs one small
  query. The version is raised in the same transaction as the change of holdings, under the sampling lock.

### 3. Collect Earth in a cloud project

- **Where the copy lives:** `~/CollectEarth/cloud/<projectId>/my-plots.csv`, in the data folder, not the project
  folder. The project's checksum then stays the CEP's (fault 4), and nothing can overwrite it by name (fault 5).
- **At the join:** the list is downloaded before the restart, so the first start already shows the person's plots
  rather than an empty map. `csv` is set to the copy; the CEP's own file is left as it is.
- **Keeping it up to date:**
  - The sync cycle asks `my-plots` every five minutes, and at a start.
  - When `version` changed, it downloads the file with `If-None-Match`, checks the checksum, writes a `.part` file
    and moves it over.
  - Then it reloads the plots: the KMZ again, the map and the form at once. They keep the file by its checksum, not
    its date (fragile points 1 and 2).
  - A notice says what changed: "5 plots added, 2 given to someone else".
- **Plots taken away with work not sent:** a plot whose record has changes not yet sent (pending or failed) stays in
  the copy until they are sent, then goes. Nobody loses a plot they are half-way through. Today the server accepts
  their record of it anyway (records are kept per person and plot).
- **A plot open in the form when it is taken away:** the form stays open until it is saved. The map then drops the
  plot.
- **Offline:** the last copy is used. The checks resume when the server answers.
- **Settings › Project, in a cloud project:**
  - The file chooser and "Refresh assignments" go.
  - In their place: "Your plots come from the project on `<server>`: 120 plots, updated 2 minutes ago", with
    "Refresh now".
  - The `csv` field is not editable there (it is restricted already).
- **An older server** (no `my-plots`): Collect Earth falls back to `my-assignment` as today, found through
  server-info.

### 4. The coordinator: the project's plots, divided once (stage 3)

- Setup › Plots shows **the project's plots** and **where they came from** ("sources"):
  - the project file;
  - an upload;
  - a design over an area;
  - SIGRID;
  - CEO;
  - a backup.
  Each source has its count and can be replaced or removed, as files can now.
- **Two rules** make one set possible, checked when a source is added:
  - all sources have the survey's columns (by header name);
  - a plot id is in one source only. A second source with ids already there is refused, or replaces those plots.
- **One division over the whole set.** The tools are those of today (evenly, by a column, overlap, move unfinished),
  and "which plots" can be all of them, a source, or a column's values. A share link gives the next N plots of the
  project nobody holds, not of a file.
- **Stored much as now.** `plot_assignments` stays keyed by `(file, plot)`; the division's rule is kept for the
  project, not per file, and writes every file's rows when applied. Whole-file assignments stay for "give everything
  to this person".
- **Already working, and unchanged:** progress, quality, areas and exports go plot by plot. The server takes strata
  from the plot files' columns by name, not from which file a plot is in (`src/routes/analysis.ts`).

### 5. Compatibility

- **Alone, the office's PostgreSQL, Collect Earth with no cloud project:** nothing changes.
- **An older Collect Earth on a new server:** `my-assignment`, the per-file downloads and the emptied CEP stay, so it
  works as today.
- **A new Collect Earth on an older server:** it uses `my-assignment`, as now.
- **Existing cloud projects:**
  - their plot files become sources;
  - a file whose columns differ from the survey's is flagged in Setup ("its columns differ from the survey's; fix it
    before giving it out") and keeps today's per-file handling until fixed;
  - at its first start, a new Collect Earth that has an assigned file in `assignments/` moves to the copy of
    `my-plots`. The records are untouched, since the keys are the same.

## Points to get right

- **The record's `plot_file`.**
  - Collect Earth writes into each record the file the plot was read from: the full path from the form, the file name
    from the KMZ.
  - The IPCC export's regions (`RegionCalculationUtils`, `region_areas.csv`) can match records on it: a project made
    of one file per region relies on it. With one file per person, every record would say `my-plots.csv`.
  - So each row carries its source in the trailing `plot_file` column, and Collect Earth in a cloud project writes
    that value instead of the copy's name. This is a desktop change, in the form, the balloon and the KMZ.
- **The column order.**
  - Collect Earth maps extra columns by position.
  - The server must write the columns in exactly the survey's order (`CollectSurvey.getExtendedDataFields()` order),
    with the round and note columns where it adds them today.
  - Tests use the demo survey and a survey with columns inside a group.
- **Big projects.**
  - 100,000 plots: the person's file is built per version and kept.
  - The KMZ rebuild after a change takes time with many plots, so it runs only when the list changed, and not for a
    change made by the person's own save.
- **A row Collect Earth cannot read** breaks the whole KMZ (`AbstractPolygonKmlGenerator.java:185-188`). The server
  checks every row (coordinates in range, enough columns) when a source is added, so the person's file never has one.
- **Ids with commas** break Collect Earth's key splitting. They are refused when a source is added.
- **Learning sets** delete the person's earlier records of the set when it is downloaded for a new attempt, not when
  it is applied. That stays with the training card, out of `my-plots`.

### Fragile points found in Collect Earth (they matter for any automatic update)

1. Downloading the same file name again: "Apply" finds nothing changed, so no reload; the KMZ stays old.
2. The map's and the form's cache stores the file's date read after parsing. A file replaced during the read stays
   cached as the old content.
3. Extra columns go by position. A file with other columns shifts answers into the wrong questions, with only a
   warning.

The design fixes all three for cloud projects: the cache goes by checksum, the copy is replaced and then reloaded,
and the server writes the survey's order.

## Stages

1. **Server: the person's plots.**
   - `my-plots` and `my-plots.csv`;
   - the version raised on every change of holdings;
   - one column order by header name, and the `plot_file` column;
   - rows Collect Earth cannot read left out.
   Tests: a person's file for whole files, divided files, a link, reference and check copies; the version; `304`; the
   column order. (Built: "Stage 1, as built" below.)
2. **Collect Earth: one list, kept up to date by itself.**
   - the copy in the data folder, downloaded at the join;
   - the five-minute check, the reload by checksum and the notice;
   - plots with unsent work kept;
   - `plot_file` from the row;
   - the Settings card;
   - the fallback to `my-assignment`.
   Real runs (`scripts/workflows`):
   - a coordinator gives, moves and divides plots while Collect Earth runs, and the plots arrive within five minutes
     with no click;
   - a plot moved away with unsent work stays until it is sent;
   - offline, the last copy is used;
   - an older server.
3. **Dashboard: the project's plots, divided once.**
   - sources and the two rules, checked when a source is added;
   - the CEP's plot files taken at upload by the server;
   - one division, share links over the project, and a coordinator taking plots for themselves.
   Existing projects: files with other columns flagged.
4. **"Download for working alone":** the CEP with a person's plots, or all of them.

Stages 1 and 2 give the collectors one list that updates by itself, which is the larger gain. Stage 3 is what makes
dividing simpler for the coordinator, and needs the two rules, so it comes after.

## Decisions (16 November 2026)

1. **Coordinators and reviewers** are given plots like everyone, and get only those they hold: with hundreds of
   thousands of plots, a coordinator chooses which ones they assess. A way for a coordinator to take plots for
   themselves goes with stage 3's division over the project.
2. **Training sets** stay apart from the person's plots.
3. **The project's plots are one set** (stage 3): a plot id is in one source only, and every source has the same
   columns.
4. **Collect Earth asks every five minutes.**

## Stage 1, as built

- `GET /v1/projects/:pid/my-plots` and `GET /v1/projects/:pid/my-plots.csv` (`src/routes/assignments.ts`, merge in
  `src/myPlots.ts`, the answer's type `MyPlotsAnswer` in `src/wire/plotFiles.ts`).
- **The parts.** The parts are those `my-assignment` lists, from one function (`personFiles`):
  - the whole files;
  - the person's file of each divided file (reference and check copies included);
  - the plots sent back to check again, first, so a plot's coordinator's note is kept.

  Training sets are not parts, and `my-assignment` is unchanged for older Collect Earth.
- **The columns.** The file takes the columns of the part with the most rows. This is not the survey's own column
  order: real plot files often name the coordinates `lat` and `lon`, not the survey's `YCoordinate` and
  `XCoordinate`, so matching the survey by name would refuse good files.
  - A part with the same columns in another order (any letter case) is put in that order.
  - A part without a header row is taken when it is no wider.
  - A part with other columns is left out and listed (`leftOut`), as its plots would fill the wrong questions.
  - Stage 3 makes all sources have the same columns, so nothing is left out then.
- **Each plot once.** A plot (its keys and its round) in two parts is written once (`repeated`).
- **Unreadable rows.** Rows whose coordinates Collect Earth cannot read are left out and counted (`unreadable`): one
  such row stops Google Earth Pro's plot file.
- **The `plot_file` column.** `?plotFile=1` adds a last column `plot_file`, each row's plot file, for stage 2.
- **The version.** It comes from what each part depends on (the plots held, the file's checksum, the round, the
  note), not from building it.
- **What it costs, with someone holding 100,000 plots** (in memory, one instance):
  - a check: 26–35 ms;
  - the first build after a change: about 1 s;
  - the download: 37 ms, 2.8 MB.

  The person's file is kept by version (16 files, 64 MB). The merge of 300,000 plots alone takes 1.6 s.
- **`ETag`** is the version (`If-None-Match` → 304). `?v=` an older version → 409 `changed`, as for a plot file.
- **Tests:**
  - `test/myPlots.test.ts`, 8 tests, the merge;
  - `test/myPlots.routes.test.ts`, 4 tests: a whole file and a share; training apart; 304, 409; a move gives a new
    version; a coordinator gets their own plots; columns, repeats, unreadable rows; the round;
  - `test/isolation.test.ts`, the cross-project 404;
  - a run on PostgreSQL.
- **Moved to stage 3:** the server taking the CEP's plot files at upload. It changes how the dashboard adds them (it
  asks whether to merge them), and belongs with the sources.

## Stage 2, as built

`MyPlotsService` (collect-earth-app, `service/cloud`) keeps the person's plots in a cloud project.

- **The copy.** It lives at `<data folder>/cloud/<project>/my-plots.csv` and is the plots file (`csv`), so every part of
  Collect Earth reads it as a project's own plot file. Beside it:
  - `server-plots.csv`: the server's rows;
  - `server-plot-files.csv` and `plot-files.csv`: each row's plot file;
  - `my-plots.properties`: the version, when it was checked and updated, the files left out.
- **The plot file column.** The copy is downloaded with each row's plot file (`?plotFile=1`; the server says so in
  `X-Plot-File-Column`). That column is taken off the copy, so the file Collect Earth reads has exactly the server's
  columns. The generated form writes each record's `plot_file` from it (`SurveyFormController`); the KMZ and the old
  balloon still write the copy's name.
- **When it asks:**
  - at the join, before the restart (`CloudService.useProject`): the first start shows the person's plots;
  - at each start, once the KMZ is made (`EarthApp.setUpAssignedPlotFile`);
  - every five minutes on a thread of its own (`collectearth.myPlotsCheckSeconds` changes it, for the real runs);
  - on "Refresh now".

  A check asks only for the version; the file is downloaded when it changed (409 once: asked again).
- **Plots taken away with work not sent** (pending or failed in the sync queue) stay in the copy until it is sent.
  They go at the next check, without a download.
- **After a change:** the copy is written aside and moved in, then the plots are reloaded. The map's and the form's
  caches compare the file's date and size read before parsing it (fragile points 1 and 2). A notice says how many
  plots were added and how many are no longer the person's.
- **Holding no plot:** the copy keeps a header row (the previous copy's, or the project file's plot file's), as the
  plot readers refuse an empty file.
- **Training sets:**
  - At a start, a training set the person takes part in is offered once for each of its versions (a notice with Open
    and Later).
  - Settings › Project lists them with Open; opening one makes its file the plots file (`CLOUD_TRAINING_FILE`).
  - The checks leave an open training set alone until "Back to my plots".
- **Settings › Project** (`CloudPlotsCard`): no file to choose any more. It shows how many plots, when last asked,
  Refresh now, the training sets, and the plot files left out or rows unreadable (to tell the coordinator).
- **Older servers.** On an older server (`my-plots` answers 404 while `my-assignment` answers), the start does what it
  did (`AssignedPlotFileSetup`) and the card is the old list. A 404 from both means the person is not in the project:
  nothing is changed.
- **Moving from before.** A computer whose plots file was an assigned file in `assignments/` moves to the copy at the
  first check of this version.
- **A file name the computer cannot write.** A training set's file named with characters the computer's file names
  cannot hold ("Calibration – set.csv" where they are not UTF-8, as on a Linux in the POSIX locale) is written with
  those replaced by "_" (`CloudApiClient.fileNameHere`). It could not be downloaded at all before, also with the
  per-file list.
- **Tests:**
  - `MyPlotsServiceTest`, 11 tests:
    - the first check;
    - the same version, not downloaded again;
    - a change, said;
    - a plot taken away with work not sent kept, then gone;
    - a training set left open, then "Back to my plots";
    - an older server, and someone not in the project;
    - offline after the project was loaded again;
    - no plot held: a header row;
    - the join;
    - a version that changed while downloading;
    - outside a cloud project.
  - `CloudApiClientDownloadTest`: a file name the computer cannot write.
  - `LeafletMapControllerTest`: a file replaced within the same second.
  - Desktop 77 + 722 tests, page 352, server 1724.
- **The real run** (`plots-update` in `scripts/workflows`, checking every 15 s). m1's Collect Earth:
  - reads the person's plots from its data folder;
  - its form loads `mapathon.csv` as a plot's `plot_file`;
  - the plots the coordinator gives, then moves away, arrive and leave with no click, with a notice;
  - Refresh now works;
  - a training set opens, the checks leave it open, and "Back to my plots" returns.

  The run gives 80 checks in ten scenarios from empty databases, all passed.
