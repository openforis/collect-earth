# Inventory of the Swing properties dialog

**Date:** 2026-10-30 · **For:** stage 2 (Settings) of `2026-10-28-html-ui-design.md` · **Branch:** feature/html-ui

What the Swing properties dialog does today, which the new settings page replaces. Paths are relative to
`collect-earth-app/src/main/java/org/openforis/collect/earth/app/view/` unless stated. "LPS" is
`LocalPropertiesService` (collect-earth-core). Message keys are in `Messages.properties`. Line numbers are as of commit
`20e058fc` (the end of stage 1 on this branch) and drift.

**Tests:** nothing tests the dialog (`src/test/java/.../view/properties/` does not exist). Related:
`service/ViewerTypeResolutionTest` (`LPS.resolveViewerType`), `service/WindowLayoutTest`.

**Dialog** (`PropertiesDialog.java`): title `OptionWizard.0`. Tabs, in order: `OptionWizard.31` Sample data,
`OptionWizard.32` Plot layout, `OptionWizard.125` External Services, `OptionWizard.126` Database & Server,
`OptionWizard.127` Browser & Display, `OptionWizard.40` Projects. Buttons `OptionWizard.15` "Save & Apply changes",
`OptionWizard.24` "Cancel". Opened from `CollectEarthMenu.getPropertiesAction`; gets the backup folder from
`backupSqlLiteService.getAutomaticBackUpFolder()`. Bindings: `HashMap<Enum<?>, JComponent[]> propertyToComponent`,
filled by `registerComponent(EarthProperty, comps...)`; a radio group registers all its buttons, the value saved is the
selected button's `getName()`.

## 1. Settings per panel

### 1.1 SampleDataPanel

| Property (key) | Widget | Label | Choices / default | Validation | Dependencies |
|---|---|---|---|---|---|
| `SAMPLE_FILE` (`csv`) | `JFilePicker` open, filter `.csv,.ced` (`OptionWizard.52`) | `OptionWizard.49`; Browse `OptionWizard.50` | free path | none as such: the CSV is checked against the survey by `JPlotCsvTable.refreshTable` → `validateCsvFile` (`CollectEarthGridTemplateGenerator.validate`), see §5 | In cloud mode (`LPS.isCloudSyncEnabled()`: `db_driver=CLOUD` and `cloud_sync_enabled` blank or true) disabled, and filled from the assignment combo |

Shown, not stored:
- **Preview table** `JPlotCsvTable(path, surveyLoaded)`, up to `LIMIT_LOADED_CSV_LINES` rows; columns from
  `CollectEarthGridTemplateGenerator.getExpectedHeaders(survey)`; cells in error red, the error as tooltip.
- **Cloud only**: label `SampleDataPanel.assignmentLabel`; combo of `CloudApiClient.getMyAssignments()` (SwingWorker),
  items `filename (plotCount)`, the current file preselected when `currentPath.endsWith(filename)`, else the first;
  button `SampleDataPanel.refreshAssignments`; label `SampleDataPanel.assignedBy` with `LPS.getCloudSyncUrl()`. Choosing
  calls `cloudApiClient.downloadAssignedCsv(info, <dir of metadata_file>/assignments)` and puts the path in the picker.
  Errors `SampleDataPanel.assignmentsError`, `SampleDataPanel.downloadError`.

### 1.2 PlotOptionsPanel

Spinners: `PropertyComponentFactory.createIntegerSpinner(prop, default, min, max, tooltip)`; a blank or non-numeric
stored value becomes the default, one out of range is clamped silently (`parseIntWithinRange`).

| Property (key) | Widget | Label | Tooltip | Choices / range / default | Shown when |
|---|---|---|---|---|---|
| `SAMPLE_SHAPE` (`sample_shape`) | combo of `SAMPLE_SHAPE.values()` (`EarthConstants`), hard-coded English `toString()`, saved as `name()` | `OptionWizard.128` | – | SQUARE, SQUARE_WITH_LARGE_CENTRAL_PLOT, CIRCLE, KML_POLYGON, WKT_POLYGON, GEOJSON_POLYGON, HEXAGON, NFMA, NFMA_250, SQUARE_CIRCLE, NFI_THREE_CIRCLES, NFI_FOUR_CIRCLES; default SQUARE | always |
| `NUMBER_OF_SAMPLING_POINTS_IN_PLOT` (`number_of_sampling_points_in_plot`) | combo of `ComboBoxItem(n, label)`, saved as n | `OptionWizard.35` | – | 0 `OptionWizard.53`, 1 `OptionWizard.54`, 4 "2x2", 9, 16, 25, 36, 49, 64, 81, 100 "10x10"; an unknown value selects 0 | square or round shapes |
| `DISTANCE_BETWEEN_SAMPLE_POINTS` (`distance_between_sample_points`) | spinner | `OptionWizard.36` (square), `OptionWizard.132` "Radius" (CIRCLE/HEXAGON), `OptionWizard.133` (NFI) | `OptionWizard.1027` | 10, 2..1000 | round: always; square: points > 1; NFI: always |
| `DISTANCE_TO_PLOT_BOUNDARIES` (`distance_to_plot_boundaries`) | spinner | `OptionWizard.37` | `OptionWizard.1028` | 0, 0..500 | square |
| `INNER_SUBPLOT_SIDE` (`inner_point_side`) | spinner | `OptionWizard.95` | `OptionWizard.1029` | 2, 2..100 | square/round with points ≥ 1; NFI always |
| `LARGE_CENTRAL_PLOT_SIDE` (`large_central_plot_side`) | spinner | `OptionWizard.129` | `OptionWizard.1030` | 20, 2..200 | SQUARE_WITH_LARGE_CENTRAL_PLOT |
| `DISTANCE_BETWEEN_PLOTS` (`distance_between_plots`) | spinner | `OptionWizard.130` | `OptionWizard.1031` | 100, 2..1000 | NFI_THREE_CIRCLES / NFI_FOUR_CIRCLES |
| `BUFFER_SHAPE` (`buffer_shape`) | combo of `BUFFER_SHAPE.values()`, English `toString()`, saved as `name()` | `OptionWizard.1022` | – | NONE, SQUARE, CIRCLE, HEXAGON; NONE when `distance_to_buffers` is blank, else `LPS.getBufferShape()` (default SQUARE) | square or round shapes |
| `DISTANCE_TO_BUFFERS` (`distance_to_buffers`) | spinner | `OptionWizard.1023` | `OptionWizard.1023` (`OptionWizard.1025` when invalid) | 1..10000, default 100; only the first of comma-separated values is read and saved back | `BUFFER_SHAPE` shown and not NONE |

Visibility: `handleVisibilityPlotLayout`, `syncRowsWithNumberOfPoints`, `handleReferenceAreaVisibility`. KML_POLYGON,
WKT_POLYGON, GEOJSON_POLYGON, NFMA, NFMA_250 and SQUARE_CIRCLE show only the shape. A hidden row is saved as `""`
(§4): "no reference area" is an empty `distance_to_buffers`.

Validation: `ReferenceAreaDistanceVerifier`: the distance must be ≥ `minimumReferenceAreaDistance()`, else the field
turns `ERROR_COLOR` with `MessageFormat(OptionWizard.1025, min)`; blocks Apply; re-run on every geometry change
(`updateReferenceAreaWarning`).

Computed and shown, not stored:
- **Areas**: `OptionWizard.131` + `plotArea()/10000` (`DecimalFormat("###.##")`), and, when the distance row shows,
  `OptionWizard.1026` + `referenceArea(d)`. Square and round shapes.
- `plotHalfExtent`: round shapes r = distance_between_sample_points; square with points ≤ 1: side = 2·margin; square
  otherwise: side = 2·margin + (√points − 1)·distance; half extent = side/2.
- `plotArea`: circle π·h², hexagon (3√3/2)·h², otherwise 4·h². `referenceArea(d)`: circle π·d², hexagon (3√3/2)·d²,
  square 4·d².
- `minimumReferenceAreaDistance()`: outline half extent h, plus 5 m for round plots (`CIRCLE_PLOT_MARGIN`); square
  reference area h; circle h (round plots) or h·√2 (square plots); hexagon h/cos30 (round) or h·(cos30+0.5)/cos30
  (square); result `max(1, ceil(min) + 1)`.
- `recommendedReferenceAreaDistance()`: the distance giving a reference area 10× the plot, clamped to [minimum, 10000].
- **Warning** `OptionWizard.1024` (orange, not blocking) when the reference area is under 10× the plot.
- **Proposal**: when `BUFFER_SHAPE` changes, the distance is set to the recommended one if never set (blank in the file
  and not touched) or below the minimum. A change of plot shape does not propose again.

### 1.3 ExternalServicesPanel

| Property (key) | Widget | Label / tooltip | Choices / default | Dependencies / notes |
|---|---|---|---|---|
| `OPEN_GEE_APP` (`open_gee_app`) | checkbox | `OptionWizard.136` | initially true | Off also unticks the date-range box and clears both dates |
| (not stored) | checkbox | `OptionWizard.120` | ticked iff `geeapp_date_from` non-blank | Shown when `OPEN_GEE_APP` is on; ticking fills empty dates with 2000-01-01 and today, unticking clears them |
| `GEEAPP_FROM_DATE` (`geeapp_date_from`) | `JXDatePicker` `yyyy-MM-dd`, 2000-01-01..today | `OptionWizard.121`; `OptionWizard.1038` | empty → `""` | shown when both boxes above are ticked |
| `GEEAPP_TO_DATE` (`geeapp_date_to`) | same | `OptionWizard.122`; `OptionWizard.1039` | same | same |
| `OPEN_EARTH_MAP` (`open_earth_map`) | checkbox | `OptionWizard.105` | false | – |
| `OPEN_ESRI_WAYBACK` (`open_esri_wayback`) | checkbox | `OptionWizard.144` | – | – |
| `VIEWER_TYPE` (`viewer_type`) | combo; labels `ExternalServicesPanel.viewerType.<value>` | `ExternalServicesPanel.viewerType`; `…viewerTypeTooltip` | `google_earth_pro`, `plots_map`, `google_earth_web` (`LPS.VIEWER_TYPE_*`); initial `LPS.getViewerType()` (falls back to the legacy `open_google_earth_web` / `open_in_leaflet_map`, then google_earth_pro) | help box below, not stored: `ExternalServicesPanel.viewerHelp.<value>` |
| `MAP_ENGINE` (`map_engine`) | combo `leaflet`, `google_maps`, labels hard-coded "Leaflet (ESRI imagery)" / "Google Maps" | `OptionWizard.147` | leaflet | enabled iff viewer ≠ google_earth_pro (saved even when disabled); `google_maps` needs `google_maps_api_key`, which is not in the dialog |
| `WINDOW_LAYOUT` (`window_layout`) | combo; labels `ExternalServicesPanel.windowLayout.<value>` | `ExternalServicesPanel.windowLayout`; `…windowLayoutTooltip` | `auto`, `side_by_side`, `separate_screens`, `imagery_full_screen`, `plots_map_in_earth`; default auto | enabled iff viewer ≠ google_earth_pro |
| `OPEN_PLANET_MAPS` (`open_planet_maps`) | checkbox in a box titled "Planet NICFI" (hard-coded) | `OptionWizard.100` | – | switches the key, TFO and months; off also unticks TFO |
| `PLANET_MAPS_KEY` (`planet_maps_key`) | password | `OptionWizard.101`; `OptionWizard.1053` | – | enabled iff Planet; note below (not stored): `OptionWizard.1054` (grey) with a key, `OptionWizard.1055` (orange) without, updated as typed |
| `PLANET_MAPS_USE_TFO` (`planet_maps_use_tfo`) | checkbox | `OptionWizard.140` | – | enabled iff Planet |
| `PLANET_TFO_DATE_FROM` (`planet_tfo_date_from`) | combo of `PlanetMonthlyObject`, saved `getValue()` | `OptionWizard.142`; `OptionWizard.1040` | item 0 `STARTING_DATE` (label `PlanetMonthlyObject.1`, value `""`), then 10 biannual `2015-12_2016-05` … `2020-06_2020-08`, then monthly `YYYY-MM` from 2020-09 to last month (to the month before before the 10th; `generateTfoMonthOptions`); legacy "Oldest"/"Latest" select the sentinel | shown and enabled iff Planet and TFO |
| `PLANET_TFO_DATE_TO` (`planet_tfo_date_to`) | same, sentinel `PRESENT_DATE` (`PlanetMonthlyObject.2`) | `OptionWizard.143`; `OptionWizard.1041` | same | same |
| `OPEN_MAXAR_SECUREWATCH` (`open_maxar_securewatch`), `MAXAR_SECUREWATCH_URL` (`secure_watch_url`) | never laid out | – | – | dead: `LPS.isSecureWatchSupported()` is false; values re-saved unchanged |
| `EXTRA_MAP_URL` (`extra_map_url`) | text, placeholder `https://www.extramap.org/lat=LATITUDE&long=LONGITUDE&id=PLOT_ID` | `OptionWizard.103`; `OptionWizard.1042` | – | `UrlPlaceholderVerifier`, §5 |

### 1.4 DatabaseServerPanel

Shown, not stored: `OptionWizard.4` + `CollectEarthUtils.getComputerIp()` (`InetAddress.getLocalHost()`, fallback
`OptionWizard.11`), in box `OptionWizard.3`.

| Property (key) | Widget | Label / tooltip | Default | Validation | Enabled when |
|---|---|---|---|---|---|
| `HOST_PORT_KEY` (`port`) | text | `OptionWizard.5`; `PropertyValidators.portRange` | 8028 (`LPS.DEFAULT_LOCAL_PORT`) | `PortValidator`: blank OK, else 1..65535 | always |
| `DB_DRIVER` (`db_driver`) | radios `SQLITE` / `POSTGRESQL` / `CLOUD` | `OptionWizard.93`, `OptionWizard.94`, `DatabaseServerPanel.cloudOption` | SQLITE | – | always; any click sets restartRequired |
| `AUTOMATIC_BACKUP` (`automatic_backup`) | checkbox in box `OptionWizard.30` | `OptionWizard.44` | true | – | SQLITE |
| `DB_USERNAME` (`db_username`) | text in box `OptionWizard.6` | `OptionWizard.7`; `OptionWizard.1032` | "" | required (`PropertyValidators.required`) | POSTGRESQL |
| `DB_PASSWORD` (`db_password`) | password, not trimmed | `OptionWizard.8`; `OptionWizard.1033` | "" | – | POSTGRESQL |
| `DB_NAME` (`db_name`) | text | `OptionWizard.9`; `OptionWizard.1034` | "" | required | POSTGRESQL |
| `DB_HOST` (`db_host`) | text | `OptionWizard.26`; `OptionWizard.1035` | "" | required | POSTGRESQL |
| `DB_PORT` (`db_port`) | text, hint `OptionWizard.134` | `OptionWizard.29`; `OptionWizard.1036` | "" | `PortValidator` | POSTGRESQL |
| `CLOUD_SYNC_URL` (`cloud_sync_url`) | text in box `DatabaseServerPanel.cloudPanelTitle` | `…cloudUrlLabel`; `…cloudUrlTooltip` | "" | none | CLOUD |
| `CLOUD_PROJECT_ID` (`cloud_project_id`) | text | `…cloudProjectLabel`; `…cloudProjectTooltip` | "" | none | CLOUD |
| `CLOUD_SYNC_TOKEN` (`cloud_sync_token`) | password | `…cloudTokenLabel`; `…cloudTokenTooltip` | "" | none | CLOUD |

`enableDBOptions(driver)` enables only the sub-panel of the selected driver; nothing is hidden.

### 1.5 BrowserDisplayPanel

| Property (key) | Widget | Label | Choices / default | Notes |
|---|---|---|---|---|
| `BROWSER_TO_USE` (`use_browser`) | radios, hard-coded "Firefox"/"Chrome"/"Edge", in box `OptionWizard.1` | – | `EarthConstants.FIREFOX_BROWSER` "firefox", `CHROME_BROWSER` "chrome", `EDGE_BROWSER` "edge"; firefox | any click sets restartRequired; an unknown stored value selects none and saves nothing |
| `SAIKU_SERVER_FOLDER` (`saiku_server_folder`) | folder picker | `OptionWizard.65`; Browse `OptionWizard.66` | `saiku-server_2.6/` | on every insert, if `!saikuService.isSaikuFolder(file)`, a dialog `OptionWizard.27`/`.28` and a red field; does not block |
| `OPEN_BALLOON_IN_BROWSER` (`open_separate_browser_form`) | checkbox | `OptionWizard.48` | false | – |

## 2. Buttons and actions that are not settings

| Button | Where | What it does |
|---|---|---|
| Browse… (`OptionWizard.50` / `.66`) | `JFilePicker` | file/folder chooser writing the path into the field |
| Refresh assignments (`SampleDataPanel.refreshAssignments`) | Sample data, cloud | `cloudApiClient.getMyAssignments()`, refills the combo |
| Assignment chosen | Sample data, cloud | `cloudApiClient.downloadAssignedCsv(info, <metadata dir>/assignments)`, sets the path |
| Test Connection (`OptionWizard.135`) | Database, PostgreSQL | `CollectEarthUtils.testPostgreSQLConnection(host, port, db, user, pass)` → its string in a dialog titled `OptionWizard.1037` |
| Open backup folder (`OptionWizard.10`) | Database, SQLite | `CollectEarthUtils.openFolderInExplorer(backupFolder)` |
| Log in… (`DatabaseServerPanel.cloudLoginButton`) | Database, cloud | needs a URL (else `cloudUrlRequired` / `cloudTestTitle`); `new CloudLoginDialog(owner, cloudApiClient, baseUrl, null)`; on success the token goes into the field |
| Test connection (`DatabaseServerPanel.cloudTestButton`) | Database, cloud | `CollectEarthUtils.testCloudConnection(url, projectId, token)` (on the event thread) → dialog `cloudTestTitle` |
| Load a new project file (`OptionWizard.41`) | Projects | file chooser (`DataFormat.PROJECT_DEFINITION_FILE`) → `projectsService.loadCompressedProjectFile(file)`; error title `OptionWizard.51`; success: restart |
| Load project (`OptionWizard.56`) / double click | Projects | §3 |

## 3. ProjectsPanel

- List in box `OptionWizard.57` (tooltip `ProjectsPanel.listTooltip`), single selection, sorted by name.
- Source: `EarthProjectsService.getProjectList()`, a `Map<surveyName, File folder>`: `loaded_projects` split on
  `File.pathSeparator`, only folders whose `project_definition.properties` validates; the name is its `survey_name`;
  projects sharing a survey name collapse into one.
- Load (`openSelectedProject`) → `projectsService.loadProjectInFolder(folder)`, which acts only if the folder's MD5
  differs from the active project's and the definition is valid: `LPS.removeModelVersionName()`;
  `applyPropertiesToCollectEarth` (clears `balloon_web` if the project lacks it, copies every key of the project file
  into earth.properties replacing `${project_path}`); `addToProjectList`; `setProjectDefinitionMD5`;
  `moveSaikuQueriesToRepository`. Errors: `e.getMessage()`, title `OptionWizard.55`. Success: restart (§4); unsaved
  edits in the other tabs are discarded.

## 4. Applying

1. `ApplyOptionChangesListener.applyProperties` (overridden in `PropertiesDialog`): button text
   `PropertiesDialog.applyingChanges`, disabled, wait cursor, thread "Applying properties dialog".
2. On the event thread: `validateAllFields()`, and if valid `savePropertyValues()`.
3. If valid: `restartRequired ? restartEarth() : EarthApp.executeKmlLoadAsynchronously(this)`, then
   `showSuccessMessage()` (`PropertiesDialog.settingsApplied`, plus `…settingsAppliedRestart` on restart; title
   `…settingsAppliedTitle`), then close. If invalid: `PropertiesDialog.validationErrors` / `…validationErrorTitle`, the
   dialog stays. Exception: `PropertiesDialog.applyError` / `…applyErrorTitle`.

**No change detection.** `savePropertyValues` writes every registered property: `""` for a component whose own
`isVisible()` is false (not its parents': the GEE dates and TFO combos inside hidden panels keep their values);
disabled ones too. Per widget: password raw; text trimmed; checkbox `"true"`/`"false"`; combo by the type of item 0
(`ComboBoxItem` → number of points, `PlanetMonthlyObject` → value, String → itself, the shape enums → `name()`); date
picker `yyyy-MM-dd` or `""`; spinner value; radio the selected button's name; file picker the path. Each `LPS.setValue`
rewrites earth.properties (about 40 writes per Apply).

**Restart only when** a `DB_DRIVER` or `BROWSER_TO_USE` radio was clicked (even back to the same value; never reset).
`restartEarth()`: `LPS.nullifyChecksumValues()` (forces a KML regeneration), then `EarthApp.restart()`
(`serverController.stopServer()` → `relaunch()`: the same java command line, output to the relaunch log, dialog
`EarthApp.relaunchFailed` / `…relaunchFailedTitle` if the child dies at once, `System.exit(0)`), and a dialog
`OptionWizard.20` / `OptionWizard.21`; on error `OptionWizard.23`.

**Otherwise** `EarthApp.executeKmlLoadAsynchronously(dialog)`: `loadKmlInGoogleEarth(true)` →
`kmlGeneratorService.generatePlacemarksKmzFile(true)`, then the plots map (`openLeafletMap` + `arrange`) or the loader
KML in Google Earth Pro; on error a hard-coded English message. So the sample file, plot layout, viewer, map engine,
window layout and external services take effect by regenerating the KML and reopening, without a restart.

Language is not in the dialog (language menu: `setUiLanguage`, font, the main window reopened, no restart). A project
load or import always restarts.

## 5. Validation flow

- InputVerifiers: `HOST_PORT_KEY`, `DB_PORT` (`PortValidator`); `DB_USERNAME`, `DB_NAME`, `DB_HOST`
  (`RequiredFieldValidator`); `MAXAR_SECUREWATCH_URL` (`UrlValidator`); `EXTRA_MAP_URL` (`UrlPlaceholderVerifier`);
  `DISTANCE_TO_BUFFERS` (`ReferenceAreaDistanceVerifier`).
- While typing, validated text fields turn red or white; on focus loss the verifier runs and a failing field keeps the
  focus; on Apply `validateAllFields()` checks the visible and enabled ones, the first failure blocks with the generic
  `PropertiesDialog.validationErrors`.
- `UrlPlaceholderVerifier`: blank OK; a malformed URL is an error (modal, hard-coded English, blocks); no placeholder of
  LATITUDE / LONGITUDE / PLOT_ID / GEOJSON, or only one of LATITUDE/LONGITUDE, is a warning (yellow + modal, hard-coded
  English), not blocking.
- Sample CSV, on every change of the path: `samplePlots.refreshTable(path)`, then Apply enabled iff
  `sampleDataPanel.isDataValid()`. INVALID_FILE_TYPE / INVALID_NUMBER_OF_COLUMNS: modal `JPlotCsvTable.expectedFileType`
  / `…expectedFileTypeTitle`, blocks. INVALID_HEADERS: dialog `JPlotCsvTable.expectedColumns` /
  `…columnsMismatchTitle`, not blocking. A missing file or no rows: a red table only, not blocking. Row errors: red
  cells.
- Saiku folder: an info dialog, not blocking.

## 6. User-facing settings that are not in the dialog

`UI_LANGUAGE` (language menu), `OPERATOR_KEY` (main window, `AppInfoController`), `OPEN_STREET_VIEW`, `JUMP_TO_NEXT`
(from the balloon), `WEB_FORM` (`generated`/`balloon`), `DEFERRED_SAVE_DISABLED`, `GOOGLE_MAPS_API_KEY` (needed by
`map_engine=google_maps`, which is in the dialog), `GEE_MAP_URL`, `EARTH_MAP_URL` / `_LAYERS` / `_SCRIPTS` / `_AOI`,
`OPERATION_MODE`, `HOST_KEY`, `LOCAL_PORT_KEY`, `SERVER_BIND_ADDRESS`, `CHROME_BINARY_PATH`, `FIREFOX_BINARY_PATH`,
`CRS_KEY`, `ELEVATION_GEOTIF_DIRECTORY`, `CLOUD_SYNC_ENABLED`, `GEW_TRIAL_PROMPT_DISABLED`, `MODEL_VERSION_NAME`,
`PLANET_MAPS_CE_KEY`.

Defaults: `collect-earth-installer/src/main/resources/earth.properties_initial` (the whole file on a new install or when
earth.properties is under 300 bytes, else only the missing keys; LPS `init`).

## 7. Bugs and oddities to fix or not repeat

1. Changing the server port, or the PostgreSQL / cloud settings without clicking a radio, needs no restart in the
   dialog: saved, but Jetty and the database keep the old values until the next start.
2. Any radio click forces a restart, even back to the same value, and the flag never resets.
3. On a restart two dialogs race `System.exit` (`OptionWizard.20` and the success message).
4. Hidden rows are saved as `""`: changing the shape loses the values of the hidden plot fields. Out-of-list or
   out-of-range values are replaced silently; only the first comma-separated reference-area distance survives.
5. Project load/import ignores the boolean returned: loading the active project (same MD5, nothing done) still
   relaunches.
6. `EarthProjectsService.addToProjectList`: `ArrayUtils.contains(String[], File)` is always false, so `loaded_projects`
   grows on every load; the list collapses projects sharing a survey name.
7. Validators open modal dialogs (the URL one on focus loss and on Apply; the Saiku one on every character). Hard-coded
   English: those dialogs, "Planet NICFI", the map engine and browser labels, the shape enum labels.
8. SecureWatch is dead (never laid out; re-saved).
9. `JFilePicker.setEnabled` doesn't call `super.setEnabled`.
10. The CSV check disables Apply but a failed apply re-enables it; a missing CSV never blocks.
11. The cloud "Test connection" runs on the event thread.
12. No change tracking: earth.properties rewritten once per property.
13. "Specify GEE App dates" is UI-only, derived from `geeapp_date_from`.
14. `START_OF_LANDSAT_AND_MODIS` defined twice; `PropertyValidators.databaseConnectionValidator()` and
    `integerRangeValidator()` unused.
15. `ProjectsPanel` imports `Messages` twice; `refreshProjectsList()` never called.
