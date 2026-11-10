# Collect Earth Online project definitions (test fixtures)

Real project definitions from Collect Earth Online (CEO), for the CEO import of
`docs/plans/2026-11-09-ceo-bridge.md`. Each `project-<id>.json` is what
`https://app.collect.earth/get-project-by-id?projectId=<id>` answered on 10 November 2026, without a login: these are
public, published projects. Saved with sorted keys; nothing changed except where noted.

Picked from the 628 public projects so that, together, they hold every question type, rule type, plot design and
sample design that occurs (the counts are in the plan's Part A results):

| File | Project | Why it is here |
| --- | --- | --- |
| `project-1.json` | Mekong River Region | the simplest: random plots, circle 200 m, 15 random samples, one button question |
| `project-743.json` | FAO - Demo | gridded plots, 36 gridded samples, a child question |
| `project-2616.json` | Mexico Review | plots and samples from a shapefile (plot size 0), answers that are numbers (`button`/`number`), `incompatible-answers`, `sum-of-answers`, `matching-sums`, 29 questions |
| `project-5455.json` | PNG_LULUCF_2020_Demo | `dropdown`, `radiobutton`, booleans, numbers as dropdowns; plot information shown; confidence collected |
| `project-20170.json` | Nepal - Degradation Plot Review | uploaded plot CSV, one centre sample, `input` text and number, children three deep |
| `project-30918.json` | Session 5 - Point Interpretation practice V2 | `numeric-range` on number inputs, 49 gridded samples |
| `project-46643.json` | V1 - FAO - REDD+ Reporting Template | `multiple-incompatible-answers`, hidden answers, learning material, 49 questions |
| `project-53855.json` | Nigeria | hidden questions (`hideQuestion: true`) |
| `project-54724.json` | TFFF Indonesia Calibration & Training Survey | plots and samples from GeoJSON, children four deep |
| `project-17814.json` | MAP400_1 | two random samples per plot, plot information shown |
| `project-32770.json` | GLC_Bangladesh_200_A | plots given out equally, QA/QC by overlap |
| `project-33290.json` | Proyecto Rodrigo | QA/QC by subject-matter experts (`sme`) |
| `project-37956.json` | NREF Coherencia Espacial 2000 - 2022 | 429 questions, children 19 deep (stored without indentation) |
| `project-64113.json` | Reserva Natural Mar Chiquita | a simplified project (collectors draw their samples), to be refused; its `aoiFeatures` (180 KB of outline) replaced by their bounding box |
| `project-1-plots.json` | Mekong River Region | `get-project-plots?projectId=1`: the plots' centres, ids, status and flag |

What is **not** here, as CEO gives it only to the project's administrators (403 without their login): the downloads
of plots ("Download Shape File", "Download Plot Data") and of answers ("Download Sample Data"). Those come from the
organisations moving their projects, for Part B3 (plots) and Part C (answers).
