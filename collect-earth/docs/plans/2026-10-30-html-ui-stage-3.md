# HTML UI, Stage 3 (Data) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Data menu of the app bar works: one export dialog replaces the nine export entries of the Swing
Data Import/Export menu, Import new data from ZIP and Update records from CSV run as jobs, and a job panel shows every
long action's progress, log, Cancel and result, with Open file / Open folder.

**Architecture:** Collect's `AbstractProcess`es (the exports, the CSV import) and `XMLDataImportProcess` run inside
`JobService` jobs through a small adapter (`ProcessJobs`) that turns their status into job progress and their
cancellation into the job's. `ExportService` and `ImportService` (`org.openforis.collect.earth.app.service.data`)
hold what `ExportActionListener`, `ImportActionListener` and the monitor dialogs did, without Swing; `DataController`
puts them behind `/api`, the job starts included (`POST /api/jobs/export`...), so `JobsController` stays the generic
reader and canceller of jobs. The XML import asks about the conflicting records as the
dialog did, in two steps: a summary job, the page's question, an import job. The page gets `JobPanel`, the export
dialog, the two import dialogs, and their pure logic in `jobs.ts`, `exportDialog.ts` and `importDialog.ts`.

**Tech stack, conventions:** as the stage-1 and stage-2 plans. `S=collect-earth-app/src/main/java/org/openforis/collect/earth/app/service`,
`C=collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/api`, `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`,
`F=collect-earth-app/src/main/frontend/src`.

## What the Swing menu did (inventory)

`CollectEarthMenu.addImportExportMenu`, the submenu `CollectEarthWindow.44` of Tools, hidden in client mode:

| Entry | Format (`DataFormat`) | Records (`RecordsToExport`) | What happens |
|---|---|---|---|
| `CollectEarthWindow.45` | ZIP_WITH_XML (`.zip`) | ALL | `exportSurveyAsZipWithXml(file, null)` |
| `CollectEarthWindow.61` | ZIP_WITH_XML | MODIFIED_SINCE_LAST_EXPORT | since `LPS.getLastExportedDate(survey)`; on success `setLastExportedDate` |
| `CollectEarthMenu.4` | ZIP_WITH_XML | PICK_FROM_DATE | a date picker (`ExportActionListener.1`), default today |
| `CollectEarthMenu.8` | ZIP_WITH_XML | USE_SUMMARY_ATTRIBUTE | attribute combo (the first 3 key and 3 summary attributes of the root entity, `ExportActionListener.9/10`) + value (`.4`, `.5`, wildcard `*` `.6`); no attributes `.7`, blank value `.8`; positional key/summary values |
| `CollectEarthMenu.6` / `.7` | COLLECT_BACKUP (`.collect-data`) | ALL / PICK_FROM_DATE | `exportSurveyAsBackup(file)` (the date is ignored by the service) |
| `CollectEarthWindow.73` | KML_FILE (`.kml`) | ALL | `kmlGeneratorService.exportToKml(file)` synchronously, then opens the folder |
| `CollectEarthWindow.13` | CSV (`.csv`) | ALL | info `ExportActionListener.2`; asks `includeLabelsQuestion`; `exportSurveyAsCsv(file, labels)` |
| `CollectEarthWindow.46` | ZIP_WITH_XML / `.collect-data` import | – | §Import ZIP |
| `CollectEarthWindow.55` | CSV import | – | §Update CSV |

Every export: a save dialog with the name `<operator>_collectedData_<survey>[_<attr>_<value>]_on_<ddMMyy_HHmmss>` or
`_<since>_to_<now>`, `_<FORMAT>.<ext>` (`getPreselectedName`, `toFileNameSafe`); then `ExportProcessMonitorDialog`:
a `ProgressMonitor` (`ExportDialogProcessMonitor.0/1`, note `.4` + processed/total), polled every second, Cancel
cancels the process; on error `ProcessMonitorDialog.attention` + the status message. CSV and KML open the file at the
end (`CollectEarthUtils.openFile`).

**Import ZIP:** several files allowed. One question (`ImportActionListener.0/2/3`, buttons `.10` all plots / `.11`
only fully assessed; with several files, "this file" / "all files" variants) → per file: `.collect-data` files are
transformed (`transformCollectDataFile`: `idml.xml` + `data/1..3`), `getImportSummary(file, includeNonFinished)`,
`callAndObserve` (progress `ImportDialogProcessMonitor.2`, count/total), then if the summary has conflicting records
the question `CollectEarthWindow.43` (`.9`, `.20` + count, `.25`, `.39`; buttons `ImportXMLDialogProcessMonitor.1`
overwrite / `.2` only non-conflicting), then `importRecordsFrom(file, process, conflicts)`; finally the KML is
reloaded (`executeKmlLoadAsynchronously`). Errors: `CollectEarthWindow.3/7`.

**Update CSV:** several files allowed, one after the other. An info dialog says the columns must start with the key
attributes (`getKeyNamesForSurvey`) followed by attribute names (English, hard-coded). Per file:
`getCsvImporterProcess(file)`, `init()`, status error → nothing; else total = lines of the file, `call()` under a
`ProgressMonitor` (`ImportProcessMonitorDialog.0`); errors: `ProcessMonitorDialog.1/4/5/moreWarnings` with the first
10 `ParsingError`s (row, message, type, columns, args); done: `ImportProcessMonitorDialog.updateFinished`.

## Decisions

- **One export job kind, one dialog.** `ExportRequest {format, records, fromDate, attribute, value, includeLabels, path}`;
  the records filters offered per format: XML all four, backup ALL and FROM_DATE, CSV and KML only ALL (what the menu
  offered). The backup "from date" entry is kept in the dialog although the service ignores the date, as before.
- **The file name is suggested by the server** (`POST /api/data/export/fileName`), from the same rule, and the save
  dialog starts from it; the page does not auto-open the result but offers Open file / Open folder.
- **Imports as two jobs.** `importSummary` reads the files and answers, per file, the records to import, the
  conflicting ones (keys, when modified, completion of both) and the errors; the page asks about the conflicts; `import`
  imports with the answers. The prepared processes are kept by `ImportService` under a token for 30 minutes, as a
  job's result is; a token no longer there is answered 409 `import.expired` and the page starts again.
- **Several files** for the imports: `POST /api/files/choose` with `multiple: true` answers `{paths}`
  (`JFileChooser.setMultiSelectionEnabled`).
- **The KML export** is synchronous in `KmlGeneratorService`; it runs as a job all the same, without progress.
- **The reload of the plots after an XML import** stays `EarthApp.reloadPlots()` (a thread, logged), as after Apply.
- **Job progress from a process:** `ProcessJobs.run(process, context, label)` calls the process on the job thread and
  a watcher thread copies `getStatus()` (percent, processed/total) into the context every 250 ms and cancels the
  process when the job is cancelled; on `isError()` it throws with the status message, and for a `CSVDataImportProcess`
  the parsing errors as job messages (first 50).
- **Texts:** the Swing keys where they fit; new `DataPage.*` keys (English + Spanish) for the dialogs.

## API

| Endpoint | Body | Answer |
|---|---|---|
| `GET /data/export/options` | – | `{formats: ["CSV","XML","BACKUP","KML"], attributes: [{id, label, type, position}], lastExport: millis\|null, survey}` |
| `POST /data/export/fileName` | `ExportRequest` without path | `{name, extension}` |
| `POST /jobs/export` | `ExportRequest` | `{id}`; result `{path}` |
| `GET /data/import/csvInfo` | – | `{keyAttributes: [...]}` |
| `POST /jobs/importSummary` | `{files: [path], includeNonFinished}` | `{id}`; result `{token, files: [{path, name, toImport, conflicts: [{keys, modified, completion, existingCompletion}], errors: [..]}]}` |
| `POST /jobs/import` | `{token, files: [{path, overwriteConflicts}]}` | `{id}`; result `{imported, overwritten}`; 409 `import.expired` |
| `POST /jobs/updateCsv` | `{files: [path]}` | `{id}`; result `{files: [{path, updated, errors: [..]}]}` |
| `POST /files/choose` | `+ multiple: true` | `{paths: [...]}` or `{cancelled}` |
| `POST /files/open`, `POST /files/reveal` | `{path}` | – (opens the file with the system viewer; opens its folder) |

A job of a kind that still runs: 409 `job.running` (`JobService.start` throws `IllegalStateException`).

---

### Task 1: `ProcessJobs`

**Files:** `$S/data/ProcessJobs.java`; test `$T/service/data/ProcessJobsTest.java` (a fake `AbstractProcess` whose
status the test moves).

`run(AbstractProcess<?, ? extends ProcessStatus> process, JobContext context, String step)`: progress copied until
the call returns; `isCancelled()` → `process.cancel()`; error → `ProcessFailedException(status message, errors)`.
For `CSVDataImportProcess` the parsing errors (row, message, columns) become `context.message` lines, formatted as
`ProcessMonitorDialog.1/4/5` did. Returns the status.

Commit `Jobs: a process of Collect run as a job, with its progress and its cancellation`.

### Task 2: `ExportService`

**Files:** `$S/data/ExportService.java`, `$S/data/ExportRequest.java`; test `$T/service/data/ExportServiceTest.java`
(mocked `DataImportExportService`, `EarthSurveyService`, `KmlGeneratorService`, `LocalPropertiesService`).

- `options()`: the attributes (`filterableAttributes`, from `ExportActionListener`), the last export date, the survey name.
- `fileName(request)`: `getPreselectedName` + `toFileNameSafe`, moved here; `extension(format)`.
- `export(request, context)`: a `Job`: validates (a path; XML+BY_ATTRIBUTE needs an attribute and a value; FROM_DATE a
  date), builds the process as `getExportProcess` did (`modifiedSince` from the last export for SINCE_LAST_EXPORT),
  runs it with `ProcessJobs`, KML through `exportToKml`; on success SINCE_LAST_EXPORT sets the last export date;
  result `{path}`.

Commit `Export: the export of the Data menu as a service, for a job`.

### Task 3: `ImportService`

**Files:** `$S/data/ImportService.java`; test `$T/service/data/ImportServiceTest.java` (mocked
`DataImportExportService`; `XMLDataImportProcess` mocked, `CSVDataImportProcess` through `ProcessJobs`).

- `summaries(files, includeNonFinished, context)`: per file (transforming `.collect-data` as
  `ImportXMLDialogProcessMonitor.transformCollectDataFile`, moved here): `getImportSummary`, `callAndObserve` with an
  observer that reports count/total; the summary as data; keeps the processes under a token (`PreparedImport`,
  forgotten after 30 min or once imported). A file that fails is an entry with `errors` and no token share: the others
  go on.
- `importPrepared(token, decisions, context)`: `importRecordsFrom(file, process, overwrite ? conflicts : empty)`
  per file, then `reload.run()` (`EarthApp::reloadPlots`); result counts; closes the processes.
- `updateFromCsv(files, context)`: per file as the Swing thread did (`init`, status, total lines, `ProcessJobs.run`);
  result per file.
- `csvInfo()`: the key attribute names.

Commit `Import: the ZIP import, with its conflicts, and the CSV update as services, for jobs`.

### Task 4: `DataController`, the job POSTs, several files, open and reveal

**Files:** `$C/DataController.java` (+test: the options, the file name, the four job POSTs answer `{id}` and 409
`job.running`), `$C/FilesController.java` (+test: `multiple`, `/files/open`, `/files/reveal`),
`$S/NativeFileChooser.java` + `SwingNativeFileChooser.java` (`chooseMany`).

Commit `POST /api/jobs/export, importSummary, import and updateCsv; several files from the file dialog`.

### Task 5: Frontend `jobs.ts` and `JobPanel`

**Files:** `$F/jobs.ts` (+test: `useJob` logic as a pure `jobReducer`, `isOver`, `progressOf`), `$F/dataApi.ts`,
`$F/components/data/JobPanel.tsx`.

The panel: a `LinearProgress` (determinate when progress ≥ 0), the step, the last messages in a scrolling box,
Cancel (`DELETE /jobs/{id}`), and when over: DONE in green with the result's buttons (Open file, Open folder when the
result has a `path`), FAILED with the error, CANCELLED. Polls every 500 ms.

Commit `Frontend: the job panel`.

### Task 6: The export dialog

**Files:** `$F/exportDialog.ts` (+test: filters per format, request validity, what changes the file name),
`$F/components/data/ExportDialog.tsx`; `$F/appBar.ts`, `$F/menus.ts`, `$F/components/AppBar.tsx`, `$F/App.tsx`.

Format as toggle buttons, the records filter as radio buttons (the ones the format allows), the date / the attribute
and value when chosen, the CSV labels switch, the CSV note, the path with Browse (SAVE, suggested name from
`/data/export/fileName`, refreshed when format, filter or value change), Export → `/jobs/export` → `JobPanel` in the
dialog.

Commit `Frontend: the export dialog replaces the nine export entries`.

### Task 7: The import dialogs

**Files:** `$F/importDialog.ts` (+test: the decisions sent from the summaries and the answers, the counts),
`$F/components/data/ImportZipDialog.tsx`, `$F/components/data/UpdateCsvDialog.tsx`.

Import ZIP: choose files (several), the all / only fully assessed choice (`ImportActionListener.10/11`), Read files →
the summary job → per file a card: records to import, the conflicts (a table: keys, modified, completion here and
there) with the overwrite switch (default off, as the dialog's default button), the errors; Import → the import job →
the panel. Update CSV: the key attributes note, choose files, Update → the job → the panel with the parsing errors.

Commit `Frontend: Import new data from ZIP and Update records from CSV`.

### Task 8: Check in a browser against a mock, then in the real app

The smoke test of stage 2 (a mock of the API in Node) extended to the data dialogs; then on the user's machine the
full build and the checks against the Swing entries: each export format and filter, the file name, Cancel, an import
with conflicts answered both ways, a CSV update with wrong rows. Then the design document (stage 3 done, what it left)
and the README; commit `HTML UI stage 3: the Data menu, with the job panel`.
