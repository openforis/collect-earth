# A bridge from Collect Earth Online to Collect Earth

Date: 9 November 2026. Branch `ce-2026-GEW`. **Status: approved, with the owner's decisions below (9 Nov 2026); not
started.**

## Goal

Let an organisation move a Collect Earth Online (CEO) project to Collect Earth: its survey, its rules, its plots and
its collected answers, translated, with a report of what came across and what did not.

The other direction (CEO importing a Collect Earth `.cep`) exists since 2024 and is not part of this plan.

## Owner decisions (9 Nov 2026)

1. **For organisations moving from CEO to Collect Earth.** Not for projects run in both tools: Part D is not planned.
2. **No Google Earth Pro.** It will not be used any more; a project that opens in the plots map and Google Earth
   Web only is what is wanted, so no balloon is generated (B4).
3. **The answers are imported too** (Part C is part of the work, not optional): an organisation moves its finished
   and ongoing projects with what was collected.
4. **The CEO team is not asked for a documented export.** We read the definition CEO's pages load (`get-project-by-id`),
   saved by the coordinator; Part A keeps real files as test fixtures, so a change on CEO's side shows in our tests.

## What CEO offers to read (checked 9 Nov 2026)

- **No export of a survey.** CEO's documentation lists no download of the survey or of the project's definition;
  a survey can only be copied to another project inside CEO
  (https://collect-earth-online-doc.readthedocs.io/en/latest/project/management.html).
- **The project's definition as JSON**, from the address CEO's own pages load it from: `get-project-by-id`
  (`src/clj/collect_earth_online/routing.clj` and `db/projects.clj` of github.com/openforis/collect-earth-online). Its
  answer has `surveyQuestions`, `surveyRules`, `plotShape`, `plotSize`, `plotDistribution`, `numPlots`,
  `sampleDistribution`, `samplesPerPlot`, `sampleResolution`, `allowDrawnSamples`, `imageryId`, `designSettings` and
  `projectOptions`. It is not a documented API: CEO can change it, and it uses CEO's login cookie. So the coordinator
  saves it from their logged-in browser as a file, and we read the file; we never call CEO.
  Tried on 9 Nov 2026: `https://app.collect.earth/get-project-by-id?projectId=1` (a public project) answers without
  a login, as JSON: `surveyQuestions` is an object keyed by question id, each with `question`, `answers` (keyed by
  answer id, `{answer, color}`), `componentType`, `dataType`, `cardOrder`, `parentQuestionId` and `parentAnswerIds`,
  as CEO's importer builds them. It also has `learningMaterial` (the interpretation guide, Markdown: it can become the
  survey guide), `type` (`regular` or `simplified`), `aoiFeatures`, `plotSpacing`, `privacyLevel` and
  `designSettings` (`sampleGeometries`, `userAssignment`, `qaqcAssignment`: the assignments and checks, worth
  reporting). A private project needs the coordinator's login, hence the saved file.
- **The plots**, from the project's "Download Shape File" (a zip with `plot-shape-file` and `sample-shape-file`) or
  "Download Plot Data" (CSV: `plotid`, `center_lon`, `center_lat`, `size_m`, `shape`, `sample_points`, the uploaded
  columns as `pl_…`, then the answers as percentages per `QUESTION:ANSWER`).
- **The answers**, from "Download Sample Data" (CSV, one row per sample: `plotid`, `sampleid`, `lon`, `lat`,
  `email`, `flagged`, `collection_time`, `analysis_duration`, `imagery_title`, `sample_geom`, `confidence`, one column
  per question named by its text).

### The survey JSON

CEO's own importer of Collect Earth projects (`src/clj/collect_earth_online/generators/ce_project/survey.clj`) builds
questions keyed by id, each with:

- `question` (the text), `questionLabel` (the export name);
- `componentType`: `button`, `input`, `radiobutton` or `dropdown`; `dataType`: `text`, `number` or `boolean`;
- `answers`, keyed by id, each `{answer, color}` (`required` too for an `input`);
- `parentQuestionId` (`-1` at the top) and `parentAnswerIds` (`[]` at the top): a child question shown when its
  parent has one of those answers;
- `cardOrder` (top-level questions only) and `required`.

Its rules (`rules.clj`) are `{id, ruleType, …}` with `text-match` (`questionId`, `regex`), `numeric-range`
(`questionId`, `min`, `max`) and `incompatible-answers` (`questionId1`, `answerId1`, `questionId2`, `answerId2`).
CEO also has sum of answers, matching sums and multiple incompatible answers
(https://collect-earth-online-doc.readthedocs.io/en/latest/project/rules.html), whose JSON keys were confirmed
on real projects (Part A).

## The one real difference: what an answer belongs to

CEO answers each question **per sample point** (a collector selects points and clicks an answer; "nothing selected"
answers all of them). Collect Earth answers **per plot**, and a survey that wants answers per point has a table with
one row per point (as its land-cover tables do). Two translations:

1. **One answer per plot** (Part B): each CEO question becomes a plot question. Right for the CEO projects whose
   collectors answer all samples at once, which is common. The import report says so plainly.
2. **One row per sample point** (later, Part E): a table entity keyed by the point number, the questions as its
   columns. Keeps point answers, but a 25-point plot becomes a 25-row table.

The coordinator chooses at import. Part B does the first only.

## Part A: a short study (1–2 days)

- Save the JSON and the downloads of a few CEO projects (public ones, and one of ours): button, radio, dropdown and
  input questions, child questions, each rule type, gridded, random and centre samples, circle and square plots,
  uploaded plots with extra columns, a simplified project.
- Write down the exact shapes (the rules not built by CEO's importer, the answers' keys, the samples' settings) and
  keep the files as test fixtures under `collect-earth-cloud/test/fixtures/ceo/`.
- Include projects with collected answers (several collectors, flagged plots, confidence values) for Part C.

### Part A results (10 Nov 2026)

**Done for the public projects; waiting for the organisations' files.** All 630 public projects were read (628
definitions, two listed twice) with a pause between requests. 14 of them, chosen to cover every case below, are the
fixtures in `collect-earth-cloud/test/fixtures/ceo/` (its README says what each one is for). The plot and answer
downloads are only given to a project's administrators (403 without their login), so they are still to come from the
organisations moving their projects.

What the 628 hold (a feature may occur several times in one project):

- **Questions** (4,196): `button`/`text` 3,206, `input`/`number` 205, `dropdown`/`text` 166, `button`/`number` 154,
  `input`/`text` 148, `radiobutton`/`text` 112, `radiobutton`/`boolean` 84, `dropdown`/`number` 71,
  `dropdown`/`boolean` 46, `radiobutton`/`number` 4. Every question has `question`, `answers`, `componentType`,
  `dataType`, `parentQuestionId` and `parentAnswerIds`; `cardOrder` only on some, `hideQuestion` on about half,
  `questionLabel` and `required` on 5 (the newest projects). `surveyQuestions` is always an object keyed by id.
- **Answers**: `{answer, color}`, plus `hide` (a hidden answer, 5,657) and `required` (on an `input`'s single answer,
  330). Ids are strings in the JSON (`"1"`), numbers in the rules.
- **Answers that are numbers**: a `button`, `dropdown` or `radiobutton` question with `dataType: number` offers numbers
  ("80", "20") as its answers, and the sum rules add the chosen numbers. In Collect: a code list whose codes are those
  numbers, and checks that turn them into numbers (`number(q16) + number(q17) = 100`).
- **Child questions**: in 258 projects, up to 19 levels deep (a chain in project 37956); B1's nested relevance takes
  any depth.
- **Rules** (1,530), all with kebab-case `ruleType` and an `id`:
  - `incompatible-answers` 1,262: `questionId1`, `answerId1`, `questionId2`, `answerId2`;
  - `numeric-range` 169: `questionId`, `min`, `max`;
  - `multiple-incompatible-answers` 48: `answers` (an object question id → answer id, all of them together),
    `incompatQuestionId`, `incompatAnswerId`;
  - `sum-of-answers` 31: `questionIds`, `validSum`;
  - `matching-sums` 20: `questionIds1`, `questionIds2`;
  - `text-match`: none in the public projects; kept in B2 from CEO's documentation and its importer.
- **Plots**: from a CSV 385, random 116, shapefile 72, gridded 50, GeoJSON 2, simplified 3; square 519, circle 109
  (a shapefile's plots have size 0: their own outlines).
- **Samples per plot**: one in 331 projects (centre 253), so answering per plot (Part B) is exactly what more than
  half of them do. Then 25 and 9 (70 each), 49 (25), 16 (18), up to 225. Gridded 220, random 99, from a shapefile 26,
  from a CSV 22, GeoJSON 2, none 6. Drawn samples allowed in 136.
- **Project options**: confidence collected in 176 (Part C keeps it), plot information shown in 163, the Earth Engine
  script link in 240, learning material in 17 (it becomes the survey guide).
- **Assignments and QA/QC**: plots given out equally in 31, by percent in 18; overlap QA/QC in 11, subject-matter
  experts in 1. Reported by the import; the coordinator sets them again in Collect Earth's division and checks.
- **Simplified projects**: 6, refused (Part E).

## Part B: the survey and the plots (about 2 weeks)

In `collect-earth-cloud/src/ceo/`, as pure functions with unit tests, the way `plotDesign.ts` is written:

### B1. The survey (`survey.ts`, `idml.ts`)

**Done (10 Nov 2026)**, with B2: `collect-earth-cloud/src/ceo/` (`project.ts` reads the file, `survey.ts`, `rules.ts`,
`idml.ts`, `report.ts`, `index.ts` with `ceoSurvey()`), tested in `test/ceo.test.ts`. Run over the 628 public projects:
622 translated (the 6 simplified ones refused), no failure; 4,159 questions imported as they are, 19 with a change
(hidden answers left out), 4 left out (hidden); 1,527 of the 1,530 rules became checks, the 3 others naming a hidden
question. All 622 surveys were read by Collect, passed its checks of names and expressions, and made a form
(`CeoSurveyIdmlTest`, with `-Dceo.idml.dir`); the surveys of the 13 importable fixtures are kept in
`collect-earth-app/src/test/resources/ceo/`, written by the cloud's test (`UPDATE_CEO_IDML=1` after a change) and read
by that test at every build.

CEO's survey becomes a Collect survey (IDML), built on the skeleton Collect Earth expects: the `plot` root entity with
its `id` key, the attributes Collect Earth fills itself (`operator`, `location`, `plot_file`, `actively_saved`,
`actively_saved_on`; `SurveyFormModelBuilder.BUILT_IN_ATTRIBUTE_NAMES`), the plot file's extra columns as "from CSV"
attributes, and one tab.

| CEO | Collect |
| --- | --- |
| `button`, `radiobutton`, `dropdown` with `dataType: text` | code attribute and its code list; layout buttons, radio or dropdown |
| `dataType: boolean` (as buttons, radio or dropdown) | code attribute with its two answers: CEO's "booleans" are often not yes/no ("bosque" / "plantaciones forestales"), so their labels are kept |
| `button`, `radiobutton`, `dropdown` with `dataType: number` | code attribute whose codes are the numbers offered, so the sum rules can add them |
| `input`, `dataType: number` | real number attribute (integer when every rule bound and example is whole) |
| `input`, `dataType: text` | text attribute |
| `required` | `required="true"` |
| child question (`parentQuestionId`, `parentAnswerIds`) | `relevant="parent = 'a' or parent = 'b'"`, and the parent's own relevance, to any depth (a hidden parent may keep an answer); no answer named (424 of 3,020 children): `not(idm:blank(parent))`, any answer |
| `question` / `questionLabel` | label / attribute name (made a valid Collect name: lower case, `_`, unique) |
| answer `color` | dropped (Collect code items have none); said in the report |
| answer text | the code is the text made a Collect code (`Bare Surface` → `bare_surface`), unique in its list; a number answer keeps its number |
| an `input`'s single answer | its placeholder ("insert comment here", "9999"), kept as the question's description; its `required` says whether the input is needed |
| hidden question (`hideQuestion`) or answer (`hide`) | left out; said in the report |
| `cardOrder` | the attributes' order |

### B2. The rules (`rules.ts`)

All of CEO's rule types have a Collect check, which is not so the other way:

| CEO rule | Collect check, on the question named (the last one for rules over several) |
| --- | --- |
| `text-match` | pattern check, the regex as it is (JavaScript and Collect's Java patterns differ in corners: a regex that does not compile in Java is reported and left out) |
| `numeric-range` | compare check, `gte` and `lte` |
| sum of answers | custom check `a + b + … = n` (XPath's `sum()` takes one node set, not a list of values) |
| matching sums | custom check `a + b = c + d` |
| incompatible answers | custom check `not(q1 = 'x' and q2 = 'y')` |
| multiple incompatible answers | one custom check over the set |

Each check gets the message CEO shows for the rule, or a plain one ("Answers X and Y cannot go together").
Every check is an error, as CEO's rules block saving.

### B3. The plots (`plots.ts`)

- From the shapefile zip (`readShpPolygons`, `readDbf` of `src/shapefile.ts`) or the plot CSV: the plot id
  (`plotid`), its centre, and the uploaded columns (`pl_…`, without the prefix) as extra columns.
- Written with `plotFileCsv` of `src/plotDesign.ts`: the plot-file format Collect Earth reads, elevation, slope and
  aspect 0 (as the plot design does).
- Shape: CEO's `circle` and `square` with `plotSize` become Collect Earth's `CIRCLE` and `SQUARE` and their size in
  `project_definition.properties`; uploaded polygons go into the plot file as WKT, which Collect Earth already reads
  (`PolygonWktGenerator`).
- Samples: `center` is one point; `gridded` becomes Collect Earth's grid when its count is a square (4, 9, 16, 25…),
  else the nearest square, reported; `random` and uploaded samples cannot be reproduced by Collect Earth's fixed
  patterns: the nearest grid, reported. Since Part B answers per plot, the points are only a guide for the eye.

### B4. The project file and the page

**Done for the survey (10 Nov 2026)**, with B5; the plots wait for B3 (CEO's plot files need an admin's download).
What was built, and where it differs from the plan below:

- `src/ceo/projectFile.ts` makes the `.cep`: `placemark.idm.xml`, `project_definition.properties` (CIRCLE or
  SQUARE from CEO's plot shape, EPSG:4326, `open_gee_app` from `showGEEScript`), `ceo_import_report.txt`, and **a stub
  `balloon.html` and `kml_template.fmt`** after all. Owner decision 2 still holds (nothing is shown in Google Earth
  Pro), but two readers need them: the cloud's upload path (`addRound`, `addNote` look for the balloon's
  `<!-- START OF EXTRA CSV DATA -->` marker and `EXTRA_ID_ATTRIBUTES`, and the template's marker line; without them
  the project has no `round` key and its quality checks cannot be told apart), and Collect Earth itself
  (`KmlGeneratorService` makes the KML at every start from the template and balloon, and copies `earthFiles/`). The
  balloon only says the form is in the plots map and Google Earth Web; the template is the demo's
  (`src/ceo/kmlTemplate.ts`) with the `EXTRA_` data of elevation, slope, aspect and the plot file's columns.
- `PUT /cep`'s work was moved into `acceptCep` (`src/routes/platform.ts`), which both routes call: the import's file
  takes the same path as any uploaded one (size limit, round, note, survey checks). Checked: the round is `added` for
  every importable fixture.
- `src/routes/ceoImport.ts`: `POST /v1/projects/from-ceo/preview` (any signed-in account; nothing stored) and
  `POST /v1/projects/from-ceo` (`{ceoProject, name?}`; the rules of `POST /v1/projects`). The caller becomes its
  coordinator; a refused project file deletes the project again. Off in local mode.
- The dashboard: "From Collect Earth Online" beside "New project" (`web/src/pages/CeoImportDialog.tsx`). One file
  for now, the saved JSON; the CEO project number gives a link to `get-project-by-id` to save it from (signed in to
  CEO for a private project). Then the report, the name (CEO's), and Create, which opens the new project on its
  getting-started checklist, whose next step is the plots: a plot file, or the plot design.
- Not yet: the plot file (B3), CEO's `plotSize`, the answers-per-plot choice (one answer per plot is the only
  translation so far), the imagery suggestion.

The plan as written:

- The `.cep` is made with `zipCep` of `src/cep.ts`: `placemark.idm.xml`, `project_definition.properties` and the
  plot file. No `balloon.html` or `kml_template.fmt`: the plots map and Google Earth Web build the form from the
  survey, and Google Earth Pro is no longer used (owner, 9 Nov 2026).
- The cloud dashboard: "New project from Collect Earth Online", on the projects page. Two files (the saved JSON,
  the shapefile zip or plot CSV) and the choice of answers per plot; then the report; then "Create", which makes the
  project and stores the `.cep` and the plot file through the existing upload paths (`PUT /cep`, the plot-file
  upload), so the round, the note and the checks of an upload apply as they do to any project.
- Route `POST /v1/projects/from-ceo/preview` (the report, nothing stored) and `POST /v1/projects/from-ceo`, for those
  allowed to create projects (`projectCreation`).
- Imagery: CEO's `imageryId` names an institution's layer we cannot read. The report lists it, and suggests Collect
  Earth's nearest source (Planet monthly: Planet; Sentinel-2 or Landsat: Earth Engine and Earth Map).

### B5. The report

**Done (10 Nov 2026).** `src/ceo/report.ts`, shown in the dialog before Create: the counts, then only what changed,
was left out, or is a note ("Show everything" lists every question and rule). The details are the server's, in
English; the dialog's own words are in the four languages. Kept with the project twice: `ceo_import_report.txt` in
its project file, and a `project.imported` entry in its log (`{source: 'ceo', ceoProjectId, questions,
questionsChanged, questionsSkipped, rules, rulesSkipped}`, migrations 012 and 015), shown as "… made this project
from Collect Earth Online project N" under the project files.

As CEO's importer does (`report.clj`): each question, rule and setting with what became of it: imported, imported
with a change (said), or left out (why). Shown before "Create", and kept with the project (its log).

### B6. Tests

- Unit tests per module, on the fixtures of Part A.
- **The survey must load in Collect:** a Java test in `collect-earth-app` reads each generated `placemark.idm.xml`
  with `CollectSurveyIdmlBinder` and builds its form with `SurveyFormModelBuilder`, as
  `SurveyFormModelBuilderTest` does with `test_survey.idm.xml`. The fixtures are generated by the cloud's tests and
  checked in, so the Java test needs no Node.
- A real run: import a CEO project, join it from Collect Earth, fill some plots, check the export.

## Part C: the answers (about 1 week)

CEO's sample CSV into the new project's records, so a project moves with what was collected, finished or mid-way:

- one answer per plot: a plot's samples agree, or the answer of most samples is taken (reported per plot);
- one record per plot and CEO collector, under a name the coordinator maps to the project's members, or a
  pseudonym (`src/anonymize.ts`);
- `collection_time` and `analysis_duration` become the record's time and time spent; `flagged` and `confidence` are
  kept as extra columns until Collect Earth has flags and confidence of its own;
- written through the records' path with their summaries, so the dashboard counts them like any record.

## Part D: will a Collect Earth project open in CEO? (not planned)

Not planned: the bridge is for organisations leaving CEO (owner, 9 Nov 2026). Kept as a note. On the project file
page of the dashboard, a check of the uploaded `.cep` against what CEO's import keeps
(`survey.clj`, `rules.clj`, `plots.clj`): the questions it would skip (calculated, hidden, range, coordinate, entities
the collector adds rows to), the ones it would change (conditionally required made optional, multiple answers over
15 items), the checks it cannot translate, and that it imports plot outlines but not sample points. Only a report: the
file stays as it is. It goes out of date when CEO's importer changes, so it says which version it describes.

## Part E: later

- One row per sample point (the second translation above).
- Simplified CEO projects (collectors draw their samples): refused for now; they need drawing, which is an idea for
  later (`2026-11-09-drawing-tools-idea.md`).
- A live link (projects kept in step between the two): not without a documented CEO API with tokens. Raise it with
  the CEO team if wanted.

## Order and size

Part A, then B1–B2 with their tests, B3, B4–B5, B6, then C. About four weeks in all: A and B about three, C about
one.
