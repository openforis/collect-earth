# A bridge from Collect Earth Online to Collect Earth

Date: 9 November 2026. Branch `ce-2026-GEW`. **Status: plan, for the owner to approve.**

## Goal

Let a coordinator start a Collect Earth project from a Collect Earth Online (CEO) project: its survey, its rules and
its plots, translated, with a report of what came across and what did not. Later, optionally, its collected answers.

The other direction already exists: since 2024 CEO imports a Collect Earth project file (`.cep`). This plan only adds
a check of our project files against what that import keeps (Part D), so coordinators know before they upload.

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
(https://collect-earth-online-doc.readthedocs.io/en/latest/project/rules.html), whose JSON keys are to be confirmed
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
- Decide with the owner: Part B's scope, and whether Part C (answers) is wanted at all.

## Part B: the survey and the plots (about 2 weeks)

In `collect-earth-cloud/src/ceo/`, as pure functions with unit tests, the way `plotDesign.ts` is written:

### B1. The survey (`survey.ts`, `idml.ts`)

CEO's survey becomes a Collect survey (IDML), built on the skeleton Collect Earth expects: the `plot` root entity with
its `id` key, the attributes Collect Earth fills itself (`operator`, `location`, `plot_file`, `actively_saved`,
`actively_saved_on`; `SurveyFormModelBuilder.BUILT_IN_ATTRIBUTE_NAMES`), the plot file's extra columns as "from CSV"
attributes, and one tab.

| CEO | Collect |
| --- | --- |
| `button`, `radiobutton`, `dropdown` with `dataType: text` | code attribute and its code list; layout buttons, radio or dropdown |
| `dataType: boolean` | boolean attribute |
| `input`, `dataType: number` | real number attribute (integer when every rule bound and example is whole) |
| `input`, `dataType: text` | text attribute |
| `required` | `required="true"` |
| child question (`parentQuestionId`, `parentAnswerIds`) | `relevant="parent = 'a' or parent = 'b'"`, nested to any depth |
| `question` / `questionLabel` | label / attribute name (made a valid Collect name: lower case, `_`, unique) |
| answer `color` | dropped (Collect code items have none); said in the report |
| hidden question or answer | left out; said in the report |
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

- The `.cep` is made with `zipCep` of `src/cep.ts`: `placemark.idm.xml`, `project_definition.properties` and the
  plot file. No `balloon.html` or `kml_template.fmt`: the plots map and Google Earth Web build the form from the
  survey, so such a project does **not** open in Google Earth Pro. The report says so. (Generating a balloon is
  the Collect Survey Designer's work; a coordinator who needs Google Earth Pro opens the survey there and exports
  the `.cep` again.)
- The cloud dashboard: "New project from Collect Earth Online", on the projects page. Two files (the saved JSON,
  the shapefile zip or plot CSV) and the choice of answers per plot; then the report; then "Create", which makes the
  project and stores the `.cep` and the plot file through the existing upload paths (`PUT /cep`, the plot-file
  upload), so the round, the note and the checks of an upload apply as they do to any project.
- Route `POST /v1/projects/from-ceo/preview` (the report, nothing stored) and `POST /v1/projects/from-ceo`, for those
  allowed to create projects (`projectCreation`).
- Imagery: CEO's `imageryId` names an institution's layer we cannot read. The report lists it, and suggests Collect
  Earth's nearest source (Planet monthly: Planet; Sentinel-2 or Landsat: Earth Engine and Earth Map).

### B5. The report

As CEO's importer does (`report.clj`): each question, rule and setting with what became of it: imported, imported
with a change (said), or left out (why). Shown before "Create", and kept with the project (its log).

### B6. Tests

- Unit tests per module, on the fixtures of Part A.
- **The survey must load in Collect:** a Java test in `collect-earth-app` reads each generated `placemark.idm.xml`
  with `CollectSurveyIdmlBinder` and builds its form with `SurveyFormModelBuilder`, as
  `SurveyFormModelBuilderTest` does with `test_survey.idm.xml`. The fixtures are generated by the cloud's tests and
  checked in, so the Java test needs no Node.
- A real run: import a CEO project, join it from Collect Earth, fill some plots, check the export.

## Part C: the answers (optional, about 1 week)

CEO's sample CSV into the new project's records, for a project moved mid-way or to compare the two tools:

- one answer per plot: a plot's samples agree, or the answer of most samples is taken (reported per plot);
- one record per plot and CEO collector, under a name the coordinator maps to the project's members, or a
  pseudonym (`src/anonymize.ts`);
- `collection_time` and `analysis_duration` become the record's time and time spent; `flagged` and `confidence` are
  kept as extra columns until Collect Earth has flags and confidence of its own;
- written through the records' path with their summaries, so the dashboard counts them like any record.

## Part D: will a Collect Earth project open in CEO? (2–3 days)

On the project file page of the dashboard, a check of the uploaded `.cep` against what CEO's import keeps
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

## Questions for the owner

1. Who is it for: organisations moving from CEO to Collect Earth, or projects run in both? (Part B and C, or Part D,
   first.)
2. Is a project that opens only in the plots map and Google Earth Web (no Google Earth Pro) acceptable, or must the
   import make a balloon too?
3. Part C: wanted?
4. Should we ask the CEO team for a documented project export (survey and rules as a file)? It would make Part B
   independent of their internal address.

## Order and size

Part A, then B1–B2 with their tests, B3, B4–B5, B6; C and D after, on the owner's answers. About three weeks for
A and B, one more for C, a few days for D.
