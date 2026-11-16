# Plots from the server for cloud projects — design

Date: 16 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: design, for decision; nothing built.**

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
- **Coordinators and reviewers:**
  - With no plots of their own, they get all the project's plots (`?all=1`, only for those roles), as the whole CEP
    gives them now.
  - With plots of their own, they choose between "my plots" and "all plots" (a decision below).
- **`my-assignment` stays** for older Collect Earth.
- **Cost:** a person's file is built once per `version` and kept, so the check every couple of minutes costs one small
  query. The version is raised in the same transaction as the change of holdings, under the sampling lock.

### 3. Collect Earth in a cloud project

- **Where the copy lives:** `~/CollectEarth/cloud/<projectId>/my-plots.csv`, in the data folder, not the project
  folder. The project's checksum then stays the CEP's (fault 4), and nothing can overwrite it by name (fault 5).
- **At the join:** the list is downloaded before the restart, so the first start already shows the person's plots
  rather than an empty map. `csv` is set to the copy; the CEP's own file is left as it is.
- **Keeping it up to date:**
  - The sync cycle asks `my-plots` every two minutes, as it already asks the coordinator's plot layout
    (`CloudCoordinatorSettings`). It also asks at a start.
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
   - the survey's column order by header name, and the `plot_file` column;
   - the checks when a plot file is added;
   - the CEP's plot files taken at upload by the server.
   Tests: a person's file for whole files, divided files, a link, reference and check copies; the version; `304`; the
   column order.
2. **Collect Earth: one list, kept up to date by itself.**
   - the copy in the data folder, downloaded at the join;
   - the two-minute check, the reload by checksum and the notice;
   - plots with unsent work kept;
   - `plot_file` from the row;
   - the Settings card;
   - the fallback to `my-assignment`.
   Real runs (`scripts/workflows`):
   - a coordinator gives, moves and divides plots while Collect Earth runs, and the plots arrive within two minutes
     with no click;
   - a plot moved away with unsent work stays until it is sent;
   - offline, the last copy is used;
   - an older server.
3. **Dashboard: the project's plots, divided once.**
   - sources and the two rules;
   - one division, share links over the project.
   Existing projects: files with other columns flagged.
4. **"Download for working alone":** the CEP with a person's plots, or all of them.

Stages 1 and 2 give the collectors one list that updates by itself, which is the larger gain. Stage 3 is what makes
dividing simpler for the coordinator, and needs the two rules, so it comes after.

## Decisions for you

1. **Coordinators and reviewers in Collect Earth:** all the project's plots, as now, or only those they hold?
   Recommended: all when they hold none, and a switch "my plots / all plots" when they hold some.
2. **Learning sets:** apart from the person's plots, as now (recommended), or in the same list with a mark?
3. **One set of plots per project (stage 3):** recommended. It means a plot id is in one source only, and every source
   has the survey's columns. Today neither is enforced.
4. **How often Collect Earth asks:** every two minutes (recommended, as the coordinator's settings already are), or
   every ten.
