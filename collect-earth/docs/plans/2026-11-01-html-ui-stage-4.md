# HTML UI, Stage 4 (Tools and Utilities) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Tools and Utilities menus of the app bar work: Saiku analysis, the stand-alone Saiku tool, the LULUCF
(IPCC GHGi) package, Load points from KML, Open data folder, Open plots map; Find missing plots, Divide large CSV
files and Delete plots using a CSV. Each long action is a job in the job panel of stage 3.

**Architecture:** The analysis services (`AnalysisSaikuService`, `IPCCGeneratorService`, `RDBExporter`,
`MissingPlotService`, the `ipcc` package) report their progress to Swing's `InfiniteProgressMonitor`; they get an
interface for it, `AnalysisProgress`, which the monitor implements and `JobProgress` implements over a `JobContext`,
so the same services run in jobs. `ToolsService` (`service.tools`) holds what the Swing listeners and dialogs did
(`GenerateDatabaseStarter`, `SaikuToolExportListener`, `MissingPlotsListener`, `FileDividerToolDlg`,
`RemovePlotsFromDBDlg`, `KmlImportService.loadFromKml`), `ToolsController` puts it behind `/api/tools` and
`/api/jobs/*`, and the page gets one dialog per entry under `components/tools/`.

**Tech stack, conventions:** as the earlier stage plans. `S=collect-earth-app/src/main/java/org/openforis/collect/earth/app/service`,
`C=collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/api`, `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`,
`F=collect-earth-app/src/main/frontend/src`, `I=collect-earth-app/src/main/java/org/openforis/collect/earth/ipcc`.

## What the Swing menus did (inventory)

**Tools** (`CollectEarthMenu.getToolsMenu`), after the Data Import/Export submenu of stage 3:

| Entry | What happens |
|---|---|
| `CollectEarthWindow.14` Start Saiku analysis | `GenerateRDBAnalysisListener`: if a `GenerateDatabaseStarter` is starting, `CollectEarthWindow.57/58`; if `isRdbAlreadyGenerated(SAIKU)` (SQLite: the zipped database exists; PostgreSQL: always), asks `CollectEarthWindow.59/60` with `SaikuAnalysisListener.0` refresh / `.1` reuse; then `initializeAndOpen(true)`: an `InfiniteProgressMonitor` (`GenerateDatabaseStarter.1/2`, Cancel sets `userCancelledOperation`), `setRefreshDatabase`, `prepareDataForAnalysis(monitor, true)`: stops Saiku, exports the RDB (or restores the zipped one), refreshes the data source, starts Saiku and opens it in the browser. `RdbExportException` → `CollectEarthWindow.29/40/47` (Saiku folder not set). |
| `CollectEarthWindow.71` Stand-alone Saiku tool (Windows only) | `SaikuToolExportListener`: a save dialog (`SaikuTool.zip`), `prepareDataForAnalysis(monitor, false)` with the same refresh question, then the ZIP: the Saiku folder (no logs, no temp), `DB/collectEarthDatabase.dbSaiku`, `DB/collectEarthCubes.xml`, the `java` folder next to Saiku, `resources/START SAIKU.bat`, `TERMINATE SAIKU.bat` and the README; opens the ZIP. `SaikuToolExportListener.1/2`. |
| `CollectEarthWindow.72` LULUCF package | `IPCCGeneratorListener` (`IPCCGeneratorListener.1-6`): same starting / refresh question for `ExportType.IPCC`; `IPCCGeneratorService.prepareDataForAnalysis`: `landUses.initializeCodeListValues()`, the RDB generated (`IPCCGenerator.generateRDB`) or restored, then `produceOutputs`: hides the monitor, shows the `AssignSubdivisionTypesWizard` (a country and region-attribute page, then a page per land use category with a management type per subdivision, forests also a forest type and croplands a perennial crop type), a save dialog (`LandUseForGHGi.zip`), then nine steps (`updateProgress(step, 9, text)`, each checking `isUserCancelled`) into the ZIP, which it opens. |
| `CollectEarthWindow.54` Load points from KML | `KmlImportService.prompToOpenKml`: a KML chosen, its placemarks written to a temporary CSV (`createTempCsv`), the message `KmlImportService.13`, a save dialog (`importedFromKml_<name>.csv`), the CSV copied there and set as `SAMPLE_FILE`, then `restartEarth()`. |
| `CollectEarthWindow.67` Open data folder | `CollectEarthUtils.openFolderInExplorer(FolderFinder.getCollectEarthDataFolder())`; `CollectEarthMenu.dataFolderNotFound/dataFolderUnknown`. |
| `CollectEarthMenu.openPlotsMap` | `browserService.openLeafletMap()` on a thread. |

**Utilities** (`CollectEarthMenu.2`):

| Entry | What happens |
|---|---|
| `CollectEarthWindow.18` Find missing plots | `MissingPlotsListener`: an info dialog (`MissingPlotsListener.3`), the plot files chosen (several), a monitor; `getPlotDataByFile(files)`, `getMissingPlotsByFile(data, monitor)`, `getMissingPlotInformation` (a text: `MissingPlotsListener.10/12/14/5`), `getMissingPlotFile` (a temporary CSV); a dialog with the text, Copy to clipboard and `MissingPlotsListener.6` Save as CSV (`plotsWithMissingInfo.csv`). |
| `CollectEarthMenu.3` Divide large CSV | `FileDividerToolDlg` (`FileDivider.*`): the CSV (checked as the sample file is, `CollectEarthGridTemplateGenerator.validate`), the number of files (1..500), randomise the lines, split by the values of a column (the expected headers, or not stratified), the output folder; `ProduceCsvFiles(survey, source, folder, randomise, columnIndex, files).divideIntoFiles()`; opens the folder. |
| `CollectEarthMenu.10` Delete plots using CSV | `RemovePlotsFromDBDlg` (`RemovePlotsDialog.*`): the CSV whose header must be the key attribute names (`RemovePlotsDialog.5/6/7`), a confirmation (`.3/.4`), then per row `earthSurveyService.loadRecord(row)`, `recordManager.delete`, a cloud tombstone (`cloudSyncQueueDao.enqueue`) when cloud sync is on; a report (`.12-.21`); the plots reloaded. |

## Decisions

- **`AnalysisProgress`** (`$S/AnalysisProgress.java`): `progressMade(Progress)` (Collect's `ProgressListener`),
  `updateProgress(current, total)`, `updateProgress(current, total, message)`, `updateProgress(percent)`,
  `setMessage(message)`, `isUserCancelled()`, `show()`, `hide()`. `InfiniteProgressMonitor` implements it; the
  services and the `ipcc` package take it instead of the monitor (a type change only, the Swing dialog keeps working
  until stage 6). `JobProgress` (`$S/jobs/JobProgress.java`) implements it over a `JobContext`: the percent of
  `current/total`, the message as the step, `isUserCancelled` is the job's cancellation, `show`/`hide` do nothing.
- **The "still starting" and "refresh" questions** become the job rule (one job of a kind at a time, 409) and a
  question in the dialog, asked only when `GET /api/tools/analysis` says the database was generated before.
- **Saiku opens in the browser by itself**, as before (`AnalysisSaikuService.openSaiku`): the job ends when Saiku is
  up, and the panel says so.
- **The IPCC package in two jobs**, as the ZIP import: `ipccPrepare` generates or restores the database and
  answers the land use subdivisions found and the choices (`IpccForm`); the page's form replaces the wizard; `ipccOutputs`
  applies the answers (`LandUseSubdivisionUtils.setSubdivisionType`, the forest and crop types) and produces the ZIP at
  the path chosen, without opening it. `IPCCGenerator.produceOutputs(survey, destination, progress)` loses its wizard
  and its file dialog. The country and region attribute the wizard set are kept in the form and passed on as the
  wizard did (`AssignSubdivisionTypesWizard.setCountryCode/setRegionAttribute`: check in Task 3 where they are read,
  and pass them the same way; the wizard's fields are never read by the generator as of stage 3, so they may be
  unused).
- **Missing plots** is a job whose result is the report (the text, the counts, the missing rows per file, the
  temporary CSV); the dialog shows it and offers Save as CSV (`POST /api/files/copy {from, to}`, from a file the
  server wrote in the temporary folder) and copies the text.
- **Divide CSV** checks the file with `SampleFileCheck` (stage 2) before enabling, as the dialog checked it.
- **Delete plots** checks the header first (`POST /api/tools/deletePlots/check`), asks in the dialog, then runs as a
  job that logs each row's outcome and ends with the counts; the plots are reloaded after.
- **Load points from KML** is one call: the KML read, the CSV written where the page said, `SAMPLE_FILE` set, then
  the restart (`RestartService`), with the restart overlay of stage 2.
- **Texts:** the Swing keys; new `ToolsPage.*` keys (English + Spanish) for the dialogs. The hard-coded English of
  the wizard (`Assign Management Type`, the page labels, `Country`) gets keys.

## API

| Endpoint | Body | Answer |
|---|---|---|
| `GET /tools/analysis` | – | `{saikuGenerated, ipccGenerated, saikuToolAvailable, saikuFolderSet}` |
| `POST /jobs/saiku` | `{refresh}` | `{id}`; result `{opened: true}` |
| `POST /jobs/saikuTool` | `{refresh, path}` | `{id}`; result `{path}` |
| `POST /jobs/ipccPrepare` | `{refresh}` | `{id}`; result `IpccForm` = `{countries: [{code, name}], attributes: [..], categories: [{code, label, managementTypes: [..], typeField: {name, options} \| null, subdivisions: [{guid, code, name, managementType, type}]}]}` |
| `POST /jobs/ipccOutputs` | `{country, regionAttribute, subdivisions: [{guid, managementType, type}], path}` | `{id}`; result `{path}` |
| `POST /tools/loadKml` | `{kml, csv}` | `{restart: true, plots}`; 400 `kml.invalid` |
| `POST /actions/openDataFolder`, `POST /actions/openPlotsMap` | – | – |
| `POST /jobs/missingPlots` | `{files}` | `{id}`; result `{text, totalPlots, totalMissing, files: [{name, missing: [[..]]}], csv}` |
| `GET /tools/divideCsv/columns` | – | `{columns: [..]}` |
| `POST /jobs/divideCsv` | `{source, folder, files, randomize, column \| null}` | `{id}`; result `{path}` |
| `POST /tools/deletePlots/check` | `{path}` | `{ok, expected: [..], found: [..], message}` |
| `POST /jobs/deletePlots` | `{path}` | `{id}`; result `{deleted, notFound, failed, messages}` |
| `POST /files/copy` | `{from, to}` | `{path}`; only from the temporary folder |

---

### Task 1: `AnalysisProgress` and `JobProgress`

**Files:** `$S/AnalysisProgress.java`, `$S/jobs/JobProgress.java` (+test `$T/service/jobs/JobProgressTest.java`);
`InfiniteProgressMonitor implements AnalysisProgress`; the parameter type in `GenerateDatabase`, `AnalysisSaikuService`,
`IPCCGeneratorService`, `RDBExporter`, `RDBPostProcessor`, `MissingPlotService`, `IPCCGenerator`, `IPCCRDBGenerator`.
The `SwingUtilities.invokeLater(() -> progressListener.setMessage(...))` calls in the services stay: with a
`JobProgress` they run the lambda on the event thread, which exists without a window too.

Commit `Analysis services: their progress through an interface, so they run in jobs as well as behind the Swing monitor`.

### Task 2: `ToolsService`, the utilities

**Files:** `$S/tools/ToolsService.java` (+test `$T/service/tools/ToolsServiceTest.java`), `$S/tools/DivideCsvRequest.java`.

- `missingPlots(files)` job, from `MissingPlotsListener`.
- `divideCsvColumns()`, `divideCsv(request)` job (`ProduceCsvFiles`).
- `deletePlotsCheck(path)`, `deletePlots(path)` job, from `RemovePlotsFromDBDlg` (takes `RecordManager`,
  `CloudSyncQueueDao`, `EarthSurveyService`, `LocalPropertiesService`, the reload).
- `loadKml(kml, csv)`: `KmlImportService.createTempCsv` made package-visible or moved here; copies the CSV; sets
  `SAMPLE_FILE`; the caller restarts.

Commit `Tools: find missing plots, divide a CSV, delete plots and load points from a KML as services`.

### Task 3: `AnalysisService`, Saiku and the IPCC package

**Files:** `$S/tools/AnalysisService.java` (+test), `$S/tools/IpccForm.java`, `$S/tools/IpccAnswers.java`;
`IPCCGeneratorService` split into `prepareDatabase(progress)` and `produceOutputs(answers, destination, progress)`;
`IPCCGenerator.produceOutputs(survey, destination, progress)` without the wizard; `AnalysisSaikuService` gets
`buildStandaloneTool(zip)` from `SaikuToolExportListener`.

- `analysis()`: the flags of `GET /tools/analysis`.
- `saiku(refresh)` job; `saikuTool(refresh, path)` job; `ipccPrepare(refresh)` job → `IpccForm`; `ipccOutputs(answers, path)` job.

Commit `Tools: Saiku, the stand-alone tool and the LULUCF package as jobs, the IPCC wizard as a form`.

### Task 4: `ToolsController`, the actions, `/files/copy`

**Files:** `$C/ToolsController.java` (+test), `$C/ActionsController.java` (+test: `openDataFolder`, `openPlotsMap`),
`$C/FilesController.java` (+test: `copy`).

Commit `GET /api/tools and the jobs of the Tools and Utilities menus`.

### Task 5: Frontend: the dialogs

**Files:** `$F/tools.ts` (+test: the IPCC form logic, the delete-plots check, the divide-CSV request),
`$F/toolsApi.ts`, `$F/components/tools/{SaikuDialog,SaikuToolDialog,IpccDialog,LoadKmlDialog,MissingPlotsDialog,DivideCsvDialog,DeletePlotsDialog}.tsx`;
`$F/appBar.ts`, `$F/menus.ts`, `$F/components/AppBar.tsx` (+tests).

Commit `Frontend: the Tools and Utilities menus`.

### Task 6: Check in a browser against the mock, then in the real app

The mock of stages 2 and 3 extended to the tools endpoints; the smoke test opens each dialog. Then on the user's
machine the full build and the checks against the Swing entries, in particular Saiku (the analysis opens), the
LULUCF package against the wizard (same ZIP contents for the same answers), Load points from KML (restart), and the
deletion of plots from a CSV with a cloud project (tombstones). Then the design document and the README; commit
`HTML UI stage 4: the Tools and Utilities menus`.
