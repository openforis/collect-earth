# HTML UI, Stage 2 (Settings) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Settings entry of the app bar opens a settings page that replaces the Swing properties dialog
(`PropertiesDialog` and its six panels): the sections of the design, drawn from one Java description of the settings,
validated by the server while the user types, with a live preview of the plot, a check of the sample file, the recent
projects, and Apply / Discard from a bar at the bottom. Applying restarts Collect Earth only when a setting that needs
it changed, and otherwise regenerates the KML and reopens the plots, as the dialog did.

**Architecture:** `org.openforis.collect.earth.app.service.settings` describes the settings (`Setting`, `Section`,
`SettingsModel`), their visibility (`Condition`), their rules (`SettingsValidator`) and the plot geometry the rules and
the page need (`PlotGeometry`); `SettingsService` reads, validates and saves, and decides between a restart
(`RestartService`) and a reload of the plots. `SettingsController` (`server.api`) puts it behind `/api/settings`,
`ProjectsController` behind `/api/projects`. The page (`SettingsPage.tsx` and `settings.ts`) draws itself from the
description: a new setting is one line of Java, and its field, visibility, validation and texts follow.

**Tech stack:** as stage 1 (`2026-10-28-html-ui-stage-1.md`): Java 11, Spring MVC 5.3, Jackson, JUnit 5 + MockMvc
(`TemplateWiring`) + Mockito; React 19 + MUI 9 + Vite + Vitest.

**Inventory:** `2026-10-30-settings-inventory.md` lists every setting, widget, rule and oddity of the Swing dialog, with
the message keys. This plan refers to it by section (§1.2 is the plot layout, §7 the bugs).

**Conventions (read before starting):** those of the stage-1 plan. In addition:
- New texts go to `Messages.properties` (English) with a Spanish translation in `Messages_es.properties` (`\uXXXX` for
  non-ASCII, the file is ISO-8859-1); Crowdin fills the other languages. Keys of the page start with `SettingsPage.`.
- The settings page reads its texts from the server (`serverText`), as the app bar does: nothing of it goes to `i18n.ts`.
- `S=collect-earth-app/src/main/java/org/openforis/collect/earth/app/service/settings`,
  `C=collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/api`,
  `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`, `F=collect-earth-app/src/main/frontend/src`.

## Decisions taken while planning

- **Visibility is data.** A setting is shown when its `Condition` holds for the current values: `in(key, values...)`,
  `atLeast(key, n)`, `notBlank(key)`, `all(...)`, `any(...)`, `not(...)`. It is sent as JSON and evaluated by the page
  (`holds()` in `settings.ts`) so fields appear as the user changes the shape, and by the server, which validates and
  saves only the visible ones. Swing's "enabled iff" (the database fields of the other driver, the map engine with
  Google Earth Pro) becomes "shown iff", as the design says.
- **Rules run on the server only**, on every change (debounced), through `POST /api/settings/validate`, which answers
  the errors and warnings per field and the plot figures (areas, minimum and recommended reference distance). The page
  computes no rule itself; it draws the preview from the values, which is drawing, not a rule.
- **Hidden settings keep their values** (§7.4), except `distance_between_sample_points` and `large_central_plot_side`,
  which the KML generators read whatever the shape (`SquareKmlGenerator` sizes the square by the first, and the second
  draws a central plot in any square): those are saved blank when hidden, as Swing saved them (`blankWhenHidden`).
  `distance_to_buffers` keeps its value: `AbstractPolygonKmlGenerator` draws no reference area for `BUFFER_SHAPE.NONE`,
  and the generators of the other shapes take none.
- **Restart when a setting marked `restart` changed value** (§7.1, §7.2): the database driver and its connection
  settings, the server port, the browser. Nothing else restarts. The restart is answered first and done on a thread,
  like Quit; the relaunched Collect Earth opens its own window and the old process closes this one.
- **Only the changes are saved**, in one write of earth.properties (`LocalPropertiesService.setValues`, §7.12).
- **The GEE "specify dates" box** (§7.13) goes: the two dates are shown when the GEE App is on, and a blank date means
  no restriction, which its tooltip says.
- **Left to stage 5** (cloud): the cloud assignments of the sample file (§1.1), the cloud "Log in…" button (§2), and
  Import CEP from the Project section (the design has it in the Project menu, with the job panel of stage 3). The
  Collaboration section keeps the URL, project id, token and Test connection.
- **Texts in English in `CollectEarthUtils.test*Connection`** stay as they are; the answer carries them as the dialog
  did. Moving them to Messages is a separate change.

## API

All under `/earth/api`, behind the stage-1 filters. Errors as in stage 1.

| Endpoint | Body | Answer |
|---|---|---|
| `GET /settings` | – | `{sections: [Section], values: {key: value}, info: {computerIp, backupFolder, cloudMode}}` |
| `POST /settings/validate` | `{values: {key: value}}` (every value the page holds) | `{errors: {key: message}, warnings: {key: message}, plot: {plotAreaHa, referenceAreaHa?, minReferenceDistance?, recommendedReferenceDistance?} \| null}` |
| `POST /settings` | `{values: {key: value}}` (the changes) | `{restart: boolean}`; 400 `{error: "settings.invalid", message, errors: {key: message}}` |
| `POST /settings/sampleFile` | `{path}` | `{exists, plots, expectedColumns: [], foundColumns: [], rows: [[]], points: [[lat, lon]], problems: [{code, message, blocking}]}` |
| `POST /settings/testDatabase` | `{host, port, name, username, password}` | `{ok, message}` |
| `POST /settings/testCloud` | `{url, projectId, token}` | `{ok, message}` |
| `GET /projects` | – | `{projects: [{name, folder, active}]}` |
| `POST /projects/load` | `{folder}` | `{restart: boolean}` (false: it was the active project already, §7.5) |
| `POST /actions/openBackupFolder` | – | – |

A `Section` is `{id, label, fields: [Field]}`; a `Field` is

```json
{"key": "distance_to_buffers", "type": "integer", "label": "OptionWizard.1023", "tooltip": "OptionWizard.1023",
 "default": "100", "min": 1, "max": 10000, "restart": false, "required": false,
 "visible": {"all": [{"key": "sample_shape", "in": ["SQUARE", "SQUARE_WITH_LARGE_CENTRAL_PLOT", "CIRCLE", "HEXAGON"]},
                     {"key": "buffer_shape", "in": ["SQUARE", "CIRCLE", "HEXAGON"]}]}}
```

Types: `text`, `password`, `integer` (`min`, `max`), `boolean`, `choice` (`choices: [{value, label}]`, label a message
key), `file` (`extensions`), `folder`, `date` (`yyyy-MM-dd`, blank allowed). `label` and `tooltip` are message keys;
`labels` may give the label per condition (`[{when: Condition, label}]`, the first that holds), for the distance /
radius row of §1.2. Values are always strings, as earth.properties holds them.

---

### Task 1: `LocalPropertiesService.setValues`

**Files:** Modify `collect-earth-core/.../service/LocalPropertiesService.java`.

**Step 1:** Add, next to `setValue`:

```java
/** Several values in one write of earth.properties: the settings page saves its changes together. */
public void setValues(Map<String, String> values) {
	for (Map.Entry<String, String> value : values.entrySet()) {
		properties.setProperty(value.getKey(), value.getValue());
		this.setChanged();
		this.notifyObservers(value.getKey());
	}
	storeProperties();
}
```

(`setValue` notifies its observers with the key; nothing in the application observes `LocalPropertiesService`, the
only `Observer` there is watches `DataImportState`, so the observers are told per key, by its name, and that is all.)

**Step 2:** `mvn -q install -DskipTests -Dskip.npm -pl collect-earth-core` from the repository root. Exit 0.

**Step 3:** Commit `LocalPropertiesService.setValues: several settings in one write of earth.properties`.

---

### Task 2: `Condition`

**Files:** Create `$S/Condition.java`; test `$T/service/settings/ConditionTest.java`.

**Step 1: Failing test.** `in("sample_shape", "SQUARE", "CIRCLE")` holds for SQUARE and not for HEXAGON nor a missing
key; `atLeast("n", 2)` holds for "4", not for "1", "", "x" or a missing key; `notBlank("k")` not for " ";
`all`, `any`, `not` combine them; `toJson()` gives the maps of the API section above (`{"key", "in"}`,
`{"key", "min"}`, `{"key", "notBlank": true}`, `{"all": [...]}`, `{"any": [...]}`, `{"not": {...}}`).

**Step 2:** Implement: an abstract class with `boolean holds(Map<String, String> values)` and
`Map<String, Object> toJson()`, the six static factories returning private subclasses. `values.get(key)` null is
treated as blank.

**Step 3:** `mvn -q test "-Dskip.npm" "-Dtest=ConditionTest"` from `collect-earth-app`: PASS.

**Step 4:** Commit `Settings: Condition, when a setting is shown, as data for the page and the server`.

---

### Task 3: `PlotGeometry`

**Files:** Create `$S/PlotGeometry.java`; test `$T/service/settings/PlotGeometryTest.java`.

**Step 1: Failing test**, with the numbers of §1.2: SQUARE, 25 points, distance 10, margin 0 → half extent 20, plot area
1600 m² (0.16 ha); square reference area at 50 → 10000 m²; `minimumReferenceDistance`: square 21, circle
ceil(20·√2)+1 = 30, hexagon ceil(20·(cos30+0.5)/cos30)+1 = 33; `recommendedReferenceDistance` (10× the plot): square
ceil(√16000/2) = 64, circle ceil(√(16000/π)) = 72. CIRCLE radius 15: outline half extent 20 (5 m margin), area
π·225; square reference minimum 21. SQUARE with 1 point and margin 12: side 24. A hexagon plot's area is
(3√3/2)·r². Non-numeric or blank values are read as the Swing spinners did (`parseIntWithinRange`: default, clamped).
`isSquare`, `isRound`, `hasReferenceArea` (square or round and buffer shape not NONE).

**Step 2:** Implement from `PlotOptionsPanel` (§1.2 states every formula and constant): a value class built from the
values map (`PlotGeometry.of(Map<String, String>)`) with `plotArea()`, `referenceArea(distance)`,
`minimumReferenceDistance()`, `recommendedReferenceDistance()`, `plotHalfExtent()`, and the constants
(`MIN_REFERENCE_AREA_TO_PLOT_AREA_RATIO = 10`, `CIRCLE_PLOT_MARGIN = 5`, the ranges of each spinner as public
constants, used by Task 4).

**Step 3:** Test PASS. **Step 4:** Commit `Settings: the plot geometry of the properties dialog as a class of its own`.

---

### Task 4: The description of the settings

**Files:** Create `$S/Setting.java`, `$S/Section.java`, `$S/SettingsModel.java`; test
`$T/service/settings/SettingsModelTest.java`; modify `Messages.properties`, `Messages_es.properties`.

**Step 1: Failing test:**
- `SettingsModel.sections()` has the six ids `project, plot, imagery, storage, collaboration, advanced`, in that order.
- Every key is the name of an `EarthProperty` (`EarthProperty.valueOf`-by-name over `values()`), no key twice.
- Every `label`, `tooltip`, section label and choice label is a key of `Messages.properties`
  (`Messages.getString(key)` does not start with `!`).
- The plot section: with `sample_shape=KML_POLYGON` only the shape is visible; with SQUARE and 1 point the distance
  between points is hidden and the margin shown; with CIRCLE the radius label (`OptionWizard.132`) is the one that
  holds; with HEXAGON and `buffer_shape=NONE` the distance to buffers is hidden; with NFI_THREE_CIRCLES the inner side,
  radius and distance between plots are shown and the reference area is not.
- Restart flags: `db_driver`, `db_host`, `db_port`, `db_name`, `db_username`, `db_password`, `port`, `use_browser`
  are `restart`; `csv`, `sample_shape`, `viewer_type` are not.
- `blankWhenHidden`: exactly `distance_between_sample_points` and `large_central_plot_side`.
- `toJson()` of a field has the keys of the API section (`key, type, label, tooltip, default, restart, required,
  visible`, and `min/max`, `choices`, `extensions`, `labels` when they apply); of the model, `sections` with their
  fields.

**Step 2: Implement.** `Setting`: a builder-style class (`Setting.text(EarthProperty, label)`, `.tooltip(key)`,
`.integer(min, max)`, `.choice(value, labelKey)...`, `.file(ext...)`, `.folder()`, `.date()`, `.password()`,
`.bool()`, `.defaultValue(v)`, `.restart()`, `.required()`, `.visibleWhen(Condition)`, `.labelWhen(Condition, key)`,
`.blankWhenHidden()`, `.validate(Rule)` where `Rule` is `(value, values) -> message or null`, see Task 5). `Section`:
id, label key, settings. `SettingsModel`: the six sections, from the inventory:

1. **project** (`SettingsPage.section.project`): `csv` (file `csv,ced`, label `OptionWizard.49`). The projects list is
   not a setting (Task 9), nor is Import CEP (stage 5).
2. **plot** (`OptionWizard.32`): §1.2, in its order. Choice labels for the shapes and buffer shapes are new keys
   `SettingsPage.shape.<NAME>` and `SettingsPage.bufferShape.<NAME>` with the English of the enums (§7.7); the number
   of points `OptionWizard.53`, `OptionWizard.54`, and `SettingsPage.points.grid` = "{0}x{0}" formatted by the page.
3. **imagery** (`SettingsPage.section.imagery`): `viewer_type` (choices `ExternalServicesPanel.viewerType.*`, tooltip
   `…viewerTypeTooltip`; default google_earth_pro), `window_layout` and `map_engine` (shown when viewer ≠
   google_earth_pro; labels `SettingsPage.mapEngine.leaflet` / `.google_maps`), then the sources as §1.3:
   `open_gee_app` (+ `geeapp_date_from`, `geeapp_date_to` when on), `open_earth_map`, `open_esri_wayback`,
   `open_planet_maps` (+ `planet_maps_key` password, `planet_maps_use_tfo`, `planet_tfo_date_from/to` choices of
   `PlanetMonthlyObject.getPlanetMonthlyMosaics()` with the sentinels' labels `PlanetMonthlyObject.1/2` and plain
   month labels, when on), `extra_map_url`. SecureWatch stays out (§7.8).
4. **storage** (`OptionWizard.126`): `db_driver` (choices `OptionWizard.93`, `OptionWizard.94`,
   `DatabaseServerPanel.cloudOption`; restart), `automatic_backup` (SQLITE or CLOUD), `db_host`, `db_port`, `db_name`,
   `db_username`, `db_password` (POSTGRESQL; required but the password; restart).
5. **collaboration** (`DatabaseServerPanel.cloudPanelTitle`): `cloud_sync_url`, `cloud_project_id`,
   `cloud_sync_token` (password). Shown always (the design keeps them a section; the driver CLOUD is what turns them
   on, which the section says in `SettingsPage.collaboration.hint`).
6. **advanced** (`SettingsPage.section.advanced`): `use_browser` (choices `SettingsPage.browser.firefox/chrome/edge`;
   restart), `web_form` (`generated` / `balloon`, labels `SettingsPage.webForm.*`; this is the "form in the browser or
   the balloon" of the design, which `open_separate_browser_form` was for Google Earth Pro: keep that one too, label
   `OptionWizard.48`, shown with the google_earth_pro viewer), `port` (`OptionWizard.5`, default 8028, restart),
   `saiku_server_folder` (folder, `OptionWizard.65`).

New keys (English + Spanish): the section labels, the hints, the choice labels, `SettingsPage.date.hint`
("Leave blank for no limit"). Defaults from §1 and `earth.properties_initial`.

**Step 3:** Test PASS. **Step 4:** Commit `Settings: one description of every setting, its type, visibility and texts`.

---

### Task 5: `SettingsValidator`

**Files:** Create `$S/SettingsValidator.java`, `$S/Validation.java` (errors, warnings, plot figures); test
`$T/service/settings/SettingsValidatorTest.java`.

**Step 1: Failing test** (the rules of §5, as errors unless said):
- `port` and `db_port`: blank OK, else 1..65535 (`PropertyValidators.portRange`).
- `db_host`, `db_name`, `db_username` required when POSTGRESQL (`PropertyValidators.required`); not checked with SQLITE.
- integers: within `min..max`, else `PropertyValidators.valueRange` formatted with them; not a number is the same error.
- `distance_to_buffers` ≥ `PlotGeometry.minimumReferenceDistance()` (`OptionWizard.1025` formatted), only when
  visible; warning `OptionWizard.1024` when the reference area is under 10× the plot.
- `extra_map_url`: malformed → error `SettingsPage.extraMap.invalid`; no placeholder or only one of LATITUDE /
  LONGITUDE → warnings `SettingsPage.extraMap.noPlaceholder` / `.latLong` (the English of §5, as keys).
- `geeapp_date_*`: blank OK; else `yyyy-MM-dd` between 2000-01-01 and today (`SettingsPage.date.invalid`); from ≤ to.
- `planet_maps_key` blank with Planet on: warning `OptionWizard.1055`.
- `saiku_server_folder`: warning `OptionWizard.27` when the folder is not a Saiku one, through a `Predicate<File>`
  given to the validator (for the tests; the service gives `AnalysisSaikuService::isSaikuFolder`).
- Hidden settings are not validated: `db_host` blank with SQLITE gives no error.
- `plot` figures: for SQUARE 25 points, distance 10, margin 0, square buffer at 50: `plotAreaHa` 0.16,
  `referenceAreaHa` 1, `minReferenceDistance` 21, `recommendedReferenceDistance` 64; null for KML_POLYGON.

**Step 2: Implement.** `validate(Map<String, String> values)` → `Validation` with `Map<String, String> errors`,
`warnings`, `PlotFigures plot` (null when the shape has none). Rules live on the `Setting`s (Task 4's `.validate`),
the validator walks the visible ones; the cross-field ones (reference area, dates) are rules of the dependent field.

**Step 3:** Test PASS. **Step 4:** Commit `Settings: the rules of the properties dialog, run by the server`.

---

### Task 6: `SettingsService` and `RestartService`

**Files:** Create `$S/SettingsService.java`, `collect-earth-app/.../service/RestartService.java`; test
`$T/service/settings/SettingsServiceTest.java`, `$T/service/RestartServiceTest.java`.

**Step 1: Failing tests.** `SettingsService(LocalPropertiesService, SettingsValidator, Runnable restart, Runnable reload)`:
- `current()` gives every setting's stored value (`getValue`).
- `save(changes)` with valid changes writes them with `setValues` in one call, only the keys that differ from the stored
  value, and answers `restart=false` and runs `reload` when no restart setting changed.
- a restart setting changed (`db_driver` SQLITE → POSTGRESQL) answers `restart=true`, runs `restart` and not `reload`;
  the same value sent again (`db_driver` SQLITE → SQLITE) does not restart (§7.2).
- hidden changes are dropped (`db_host` sent with SQLITE); `blankWhenHidden` settings are written blank when hidden
  after the change (SQUARE with 1 point: `distance_between_sample_points` = "") and not touched otherwise.
- invalid changes throw `SettingsService.InvalidSettingsException` with the errors and write nothing.
- `validate(values)` delegates to the validator over the stored values overlaid with the ones given.

`RestartService` as `QuitService`: `run()` answers at once, nullifies the checksums (`nullifyChecksumValues`, so the
KML is regenerated) and calls `EarthApp.restart()` on a thread; a second call while restarting does nothing. Test with
injected runnables.

**Step 2: Implement.** `reload` is `EarthApp::reloadPlots`: add to `EarthApp` a public static `reloadPlots()` that runs
`loadKmlInGoogleEarth(true)` on a thread and logs a failure (what `executeKmlLoadAsynchronously(null)` does without the
Swing dialog); `restart` is the `RestartService`. Wire with `@Service` and `@Autowired`
(`SettingsValidator` takes `AnalysisSaikuService`).

**Step 3:** Tests PASS. **Step 4:** Commit `Settings: saved as one change, with a restart only when a setting needs it`.

---

### Task 7: `SettingsController`

**Files:** Create `$C/SettingsController.java`; test `$T/server/api/SettingsControllerTest.java`; Messages.

**Step 1: Failing test** (MockMvc through `TemplateWiring`, the service mocked):
- `GET /api/settings` → the sections of the model, the values, `info.computerIp`, `info.backupFolder`, `info.cloudMode`.
- `POST /api/settings/validate` → `errors`, `warnings`, `plot`.
- `POST /api/settings` → `{restart}`; invalid → 400 `error=settings.invalid`, `message` =
  `PropertiesDialog.validationErrors`, `errors.<key>`.
- `POST /api/settings/testDatabase` → `{ok, message}` through an injected function (`CollectEarthUtils::testPostgreSQLConnection`
  in the app; `ok` is `message.equals("Connection OK!")`, which is what that method answers on success).
- `POST /api/settings/testCloud` likewise.

**Step 2: Implement.** Constructor for the app `(SettingsService, BackupSqlLiteService)` and a package-private one with
the functions. The test connections run on the request thread, which is not the event thread (§7.11): fine.

**Step 3:** Tests PASS. **Step 4:** Commit `GET and POST /api/settings: the settings for the page, validated and saved`.

---

### Task 8: The sample file check

**Files:** Create `$S/SampleFileCheck.java`; endpoint in `SettingsController`; test
`$T/service/settings/SampleFileCheckTest.java` (temp CSVs), controller test for the endpoint.

**Step 1: Failing test.** `SampleFileCheck(Function<File, CSVFileValidationResult> validator, Supplier<List<String>> expectedHeaders)`:
- a missing file → `exists=false`, one blocking problem `SettingsPage.sampleFile.missing`.
- a CSV of 3 plots with a header row (first cell `id`) → `plots=3`, `rows` the 3 rows, `points` the 3 (lat, lon) pairs
  from columns 2 and 3 (Y then X, the Collect Earth order), `foundColumns` the header; without a header row (first
  cell not ID / PLOT_ID / PLOT, case-insensitive, as `JPlotCsvTable` decides) → `foundColumns` empty.
- the validator's result: INVALID_FILE_TYPE / INVALID_NUMBER_OF_COLUMNS → blocking `JPlotCsvTable.expectedFileType`;
  INVALID_HEADERS → not blocking `JPlotCsvTable.expectedColumns` formatted with the expected ones;
  INVALID_NUMBER_OF_PLOTS_TOO_LARGE / _WARNING → not blocking `JPlotCsvTable.tooLargeError/Warning` with the count;
  INVALID_VALUES_IN_CSV → blocking `JPlotCsvTable.contentIncorrect` with the rows' messages; no rows → not blocking
  `JPlotCsvTable.noPlotInfo` (§5: a missing file or no rows never blocked; the design wants problems shown).
- `rows` are at most 20, `points` at most 5000, read with `CsvReaderUtils.getCsvReader`.

**Step 2: Implement**; in the app the validator is `new CollectEarthGridTemplateGenerator().validate(file, survey,
params)` with `validateOnlyFirstLines(false)` and the survey of `EarthSurveyService`, the headers
`getExpectedHeaders(survey)`. `POST /api/settings/sampleFile` → the check as JSON.

**Step 3:** Tests PASS. **Step 4:** Commit `POST /api/settings/sampleFile: the plots file checked against the survey`.

---

### Task 9: Projects

**Files:** Create `$C/ProjectsController.java`; test `$T/server/api/ProjectsControllerTest.java`.

**Step 1: Failing test.** `GET /api/projects` lists `EarthProjectsService.getProjectList()` sorted by name, `active`
when `CollectEarthUtils.getMd5FromFolder(folder)` equals `active_project_definition`, which holds the MD5 of the active
project's folder (`EarthProjectsService.setProjectDefinitionMD5`). `POST /api/projects/load` with a folder of the list →
`loadProjectInFolder`; true → `{restart: true}` and the `RestartService` runs; false → `{restart: false}`, no restart;
an `IOException` → 400 `projects.load` with its message (`OptionWizard.55` as the message, the exception's as details);
a folder not in the list → 400 `projects.unknown` (the page only sends listed ones; a stray path is refused).

**Step 2: Implement.** **Step 3:** Tests PASS. **Step 4:** Commit `GET /api/projects and POST /api/projects/load`.

---

### Task 10: Open backup folder

**Files:** Modify `$C/ActionsController.java`, its test.

**Step 1:** Failing test: `POST /api/actions/openBackupFolder` runs the action; `quit` still does; `fly` is 404.

**Step 2:** `ActionsController` takes a `Map<String, Runnable>` of actions (package-private constructor), built by the
`@Autowired` one from `QuitService` and `BackupSqlLiteService` + `CollectEarthUtils.openFolderInExplorer` (an
`IOException` → 500 through the handler, logged).

**Step 3:** PASS. **Step 4:** Commit `POST /api/actions/openBackupFolder`.

---

### Task 11: Frontend model of the settings

**Files:** Create `$F/settings.ts`, `$F/settings.test.ts`.

**Step 1: Failing test:**
- `holds(condition, values)` for each condition kind and the combinations (the cases of Task 2); undefined → true.
- `fieldLabel(field, values)`: the first `labels` entry that holds, else `label`.
- `changes(stored, current, fields)`: the keys whose value differs, as a map; hidden fields are left out.
- `restartNeeded(fields, changes)`: true when one of the changed fields is `restart`.
- `matches(field, texts, query)`: the query against the label and tooltip texts (case-insensitive, accent-insensitive
  through `normalize("NFD")`), and `sectionsMatching(sections, texts, query)`.
- `proposeReferenceDistance(values, plot)`: the recommended distance when the distance is blank or below the minimum,
  else null (the rule of §1.2, applied by the page only after a change of the buffer shape).
- `monthLabel(value)`: "2021/03" for "2021-03", "2015/12 - 2016/05" for "2015-12_2016-05".

**Step 2: Implement** with the types `Section`, `Field`, `Condition`, `Validation`, `PlotFigures`, `SampleFileCheck`,
`Project` of the API section. **Step 3:** PASS, typecheck clean. **Step 4:** Commit `Frontend: the model of the settings page`.

---

### Task 12: Frontend settings API and the validate-while-typing helper

**Files:** Create `$F/settingsApi.ts`, `$F/settingsApi.test.ts`.

**Step 1: Failing test:** `latestOnly(fn)` wraps an async function so that the answer of a call started before a later
one is dropped (`undefined`), and `debounced(fn, ms)` calls it once after the last call (fake timers).

**Step 2: Implement:** `loadSettings`, `validateSettings`, `saveSettings`, `checkSampleFile`, `testDatabase`,
`testCloud`, `listProjects`, `loadProject`, `chooseFile(mode, extensions, suggested)` (`POST files/choose`, null when
cancelled), `openBackupFolder`, through `apiClient`. **Step 3:** PASS. **Step 4:** Commit `Frontend: the client of /api/settings`.

---

### Task 13: The plot preview

**Files:** Create `$F/plotPreview.ts`, `$F/plotPreview.test.ts`, `$F/components/settings/PlotPreview.tsx`.

**Step 1: Failing test:** `plotDrawing(values)` gives, in metres from the centre: the outline (`{kind: "square", half}`,
`{kind: "circle", r}`, `{kind: "hexagon", r}`), the sample points (`{x, y, side}`: the grid of √n × √n at the distance,
centred; one at the centre for 1 point; none for 0), the central plot for SQUARE_WITH_LARGE_CENTRAL_PLOT, the
reference area (`{kind, half|r}` at the distance, when the shape has one and it is not NONE), and `extent`, the half
width the drawing needs. Round plots: outline r = radius + 5 (`CircleKmlGenerator.MARGIN_CIRCLE`), the central point only: the
other points are placed at random by the generator (`getRandomSamplePoint`), which the caption under the preview says
(`SettingsPage.preview.randomPoints`). NFI shapes (`NfiCirclesKmlGenerator.getKmlForTract`): circles of the radius at
the centre, east (2r + d, 0) and north (0, 2r + d), the fourth at (2r + d, 2r + d), each with its central dot of the
inner side. Polygon shapes: nothing (`null`).

**Step 2: Implement** `plotPreview.ts`; `PlotPreview.tsx` draws it as an SVG scaled to its box (the plot colour of the
map, `#fbc02d`-like yellow from `theme.ts`/the map, the reference area dashed), with a scale bar, and the areas
(`OptionWizard.131`, `OptionWizard.1026`, from the `plot` figures of the last validation) under it.

**Step 3:** PASS. **Step 4:** Commit `Frontend: the plot drawn to scale from the plot settings`.

---

### Task 14: The settings page

**Files:** Create `$F/components/settings/SettingsPage.tsx`, `SettingField.tsx`, `SampleFileCard.tsx`,
`ProjectsCard.tsx`, `RestartingOverlay.tsx`; modify `$F/App.tsx`, `$F/appBar.ts` (+ test), `$F/components/AppBar.tsx`,
`$F/menus.ts`; Messages (`SettingsPage.*` texts of the page chrome).

**Step 1:** `appBar.test.ts`: the `properties` entry has the action `settings`, and is no longer coming soon.

**Step 2: Implement:**
- `App.tsx`: a `page` state `"main" | "settings"`; the app bar's `settings` action opens it; the page's Close returns.
  The map, list and form stay mounted under it (`display: none`), so the controller keeps its state.
- `SettingsPage`: loads `/settings`; left a `List` of the sections (a `Drawer`-like column; on a narrow window a `Select`
  above), right the fields of the open section; a search `TextField` over them all (`matches`), which shows the fields
  found with their section as a subheader; `SettingField` per type: `TextField`, password with the eye toggle,
  number (`type="number"`, min/max), `Switch`, `Select`, file/folder (`TextField` + Browse → `chooseFile`), date
  (`type="date"`); the tooltip as `helperText` and the error or warning in its place (`error` colour, warning
  `warning.main`). A `restart` field carries a small `Chip` `SettingsPage.restartBadge`.
- Validation: on every change, `validateSettings` debounced 300 ms with `latestOnly`; the answers drive the messages
  and the preview figures. After a change of `buffer_shape`, `proposeReferenceDistance` on the next answer.
- The bottom bar: `SettingsPage.changes` ("{0} changes not applied", formatted), `OptionWizard.15` Apply (disabled
  with errors or no changes), `SettingsPage.discard`. Apply → `saveSettings(changes)`; `{restart: true}` → the
  `RestartingOverlay` (`SettingsPage.restarting`); else a `Snackbar` `PropertiesDialog.settingsApplied` and the stored
  values become the saved ones. A 400 `settings.invalid` shows its errors at the fields.
- Each section: `SettingsPage.restoreDefaults` sets its visible fields to their `default`.
- Project section: `SampleFileCard` (the `csv` field, then `checkSampleFile` on each change of the path: plots,
  columns found and expected, the problems as `Alert`s, the first rows in a small `Table`, the points as an SVG dot map
  in a box) and `ProjectsCard` (`listProjects`: cards with name, folder, `OptionWizard.56` Load; the active one marked
  `SettingsPage.project.active`; Load → `loadProject` → overlay when restarting). A blocking problem of the sample file
  disables Apply (§5).
- Plot section: the fields left, `PlotPreview` right (stacked when narrow).
- Storage section: `info.computerIp` (`OptionWizard.4`), with POSTGRESQL a `OptionWizard.135` Test connection button
  whose answer shows in an `Alert`; with SQLITE `OptionWizard.10` Open backup folder (`openBackupFolder`).
- Collaboration: `DatabaseServerPanel.cloudTestButton` likewise.
- Leaving the page with changes asks `SettingsPage.unsavedChanges` (a `Dialog`: discard or stay).

**Step 3:** `npx tsc --noEmit` clean; `npx vitest run` all pass. **Step 4:** Commit `Frontend: the settings page`.

---

### Task 15: Full build and check in the real app

**Step 1:** From `collect-earth-app`: `mvn -q install -DskipTests` (with npm); `mvn -q test "-Dskip.npm"`; `npx vitest run`.

**Step 2:** On JRE 21 against the Swing dialog, fixing what fails (test first where it can be tested):
1. Settings opens from the menu, every section draws, the texts are in the UI language (switch to Spanish).
2. Plot: changing the shape shows and hides the right fields; the preview and the areas follow; a distance under the
   minimum is refused at the field and blocks Apply; choosing a reference area proposes the distance.
3. Sample file: Browse opens the native dialog; a wrong file says so and blocks; the right one shows plots and the map.
4. Apply without a restart setting: no restart, the KML is regenerated and the plots reopen; earth.properties has only
   the changed keys changed (compare before and after).
5. Apply with the browser changed: the page says it restarts, Collect Earth restarts, the new one opens its window.
6. Load a recent project: restart; load the active one: no restart, the message says so.
7. Test connection with a wrong PostgreSQL host answers within ~10 s; Open backup folder opens it.
8. Discard, Restore defaults, the search box, leaving with changes.

**Step 3:** Commit fixes; update `docs/plans/2026-10-28-html-ui-design.md` ("Stages: 2 done" and what stage 2 left to
later stages), and the frontend README (the settings page); commit `HTML UI stage 2: the settings page replaces the
properties dialog`.
