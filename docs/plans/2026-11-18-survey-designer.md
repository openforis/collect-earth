# A survey designer in the dashboard

Date: 18 November 2026. Branch `ce-2026-GEW`. **A plan: nothing here is built yet.**

## Goal

Today a Collect Earth survey is made in Open Foris Collect's Survey Designer, a separate program,
and uploaded to the dashboard as a project file (`.cep`). The coordinator should be able to make
and change the survey in the dashboard itself, with a designer much simpler than Collect's,
because Collect Earth uses a small part of what Collect's designer offers.

The upper limit of what the designer must handle is set by the owner: the most complex Collect
Earth surveys are roughly Collect's own templates (basic, multipurpose, IPCC).

This plan records what was found, what to keep, what to drop, and the stages proposed. The
decisions the owner still has to take are at the end.

## What was studied

1. Collect's Survey Designer, from its source (`openforis/collect`, 4.0.112-SNAPSHOT).
2. The three Collect Earth templates Collect ships
   (`collect-server/src/main/resources/org/openforis/collect/designer/templates/`), measured
   with a script.
3. What this repository already does with surveys: the cloud server, the dashboard and the
   desktop's generated form.

## 1. What Collect's designer is

A general tool for field inventories of any shape. It is about 21,000 lines of Java and 7,300
lines of screens, on a survey model of another 17,000 lines.

| Area of Collect's designer | What it offers | Do Collect Earth surveys use it? |
| --- | --- | --- |
| Survey info | Name, title and description per language, languages, target | Yes |
| Spatial reference systems | A list of them, custom WKT | One, fixed |
| Units and precisions | Units with conversions, decimals per unit | No |
| Versions | Each question and list item valid from/until a version | No |
| Code lists | Flat or with named levels, import and export, images, "specify" items | Yes: flat, or two levels |
| Species lists | Taxonomies with import | No |
| Sampling point data | Import of sampling designs | No (one fixed lookup list) |
| Schema tree | Entities nested to any depth, single, multiple, virtual | One plot, at most two tables under it |
| Attribute types | Boolean, code, coordinate, date, time, number, range, taxon, text, file | Six of the ten (below) |
| Per-question options | About 40: keys, counts, layout columns and widths, eight kinds of label, phases... | About ten |
| Checks | Comparison, custom expression, pattern, uniqueness, distance | Comparison and custom |
| Expressions | An XPath-like language with five function libraries | Simple comparisons; one formula block |
| Lifecycle | Draft and published copies, publish with compatibility checks, clone | A project is a draft, then active |
| Export | Project file with a generated balloon, a KML template, an analysis cube, test plots, 57 assets | See section 3 |

**Collect's designer already narrows itself for Collect Earth.** When the survey's target is
Collect Earth it hides the species, sampling, versions, units and SRS screens, offers only six
attribute types, allows entities only directly under the plot, hides nearly every layout option,
and calls relevance "Visible in UI". Our designer continues in that direction.

**The rules a Collect Earth survey must meet** (`CollectEarthSurveyValidator`, `SurveyValidator`),
which the designer has to enforce because the desktop checks them when it opens the project:

- The root entity is named `plot` and holds `id` (text), `operator` (text), `location`
  (coordinate), `plot_file` (text), `actively_saved` (yes/no) and `actively_saved_on` (date).
- One to three key attributes.
- Entities only directly under the plot.
- Names are lower case letters, digits and `_`, start with a letter, and do not end in `_` or
  `_<digits>`. A name with its entity's name is at most 63 characters.
- No empty entity. A code question's list and level exist.
- Every expression parses and none refers to itself in a circle.
- Against a survey already in use: a question's type, its parent and multiple-to-single may not
  change, and an item of a list that gives a table its rows may not be removed.

## 2. What Collect Earth surveys use (measured)

| | Basic | Multipurpose | IPCC |
| --- | --- | --- | --- |
| Questions the interpreter sees | 13 | 54 | 41 |
| Hidden fields (internal, from the plot file, calculated) | 5 | 14 | 107 |
| Tables or repeated blocks | 0 | 2 | 2 |
| Pages (tabs) | 2 | 5 | 8 |
| Answer lists | 5 | 25 | 16 |
| Answer lists with two levels | 0 | 1 | 3 |
| "Show when" conditions | 3 | 30 | 26 |
| Validation rules | 2 | 4 | 15 |
| Calculated fields | 3 | 13 | 108 |
| Formulas and default values | 17 | 60 | 563 |
| Languages | 4 | 4 | 4 |

- **Question types:** choice, yes/no, number, text, date, and the plot's own coordinate. Time,
  range, species and file are never used.
- **Structure:** one plot. Under it at most two entities, always "one row per item of a list"
  (`collect:enumerate`), shown as a table or as a block of questions repeated per item. Nothing
  is nested deeper.
- **Pages:** one flat set of tabs. Some tabs are hidden ones for internal, plot-file and
  calculated fields.
- **Answer lists:** mostly flat, up to 65 items, typically 5 to 13. Items have a code, a label
  and sometimes a description. No images, no "specify" items.
- **Conditions:** every "show when" is a comparison of a question with an answer
  (`land_use_category = 'F'`), a yes/no question (`presence_trees`), or a few of those joined by
  `and`/`or`. Two use `starts-with`.
- **Validation rules:** a number between two bounds, a comparison with another question, and the
  sum of a table's column (`sum(parent()/land_cover/percentage) >= 80`).
- **Calculated fields:** the IPCC template's 563 formulas build the land-use time series. They
  are a generated block, not something a person writes question by question.
- **Never used:** units, versions, species, more than one spatial reference system, pattern,
  uniqueness and distance checks, layout columns and widths.
- **The same in all three:** `id`, `location`, `operator`, `plot_file`, `actively_saved`,
  `actively_saved_on`, and the plot-file values `elevation`, `slope`, `aspect` with
  `calculated_elevation_range`.

## 3. What this repository already has

- **Readers.** The server reads the survey three ways: `surveyInfo` (keys, lists),
  `surveyOutline` (one entry per question, for quality, training and the AI) and `analysisModel`
  (tables, columns, lists with levels, labels in every language). None reads tabs, checks,
  formulas or the content of an expression.
- **A writer.** The import from Collect Earth Online writes a whole survey (`src/ceo/idml.ts`,
  `writeIdml`) from a small model: choice, number and text questions, one language, flat lists,
  three kinds of check, one table. `madeProjectFile` wraps any survey text into a project file,
  and `acceptCep` is the one path every project file goes through.
- **Exact edits.** `addRound`, `addNote` and `addPeriodStatus` insert an attribute into an
  existing survey by editing its text in place, keeping every other byte.
- **A proven test pattern.** The surveys `writeIdml` produces are read in the desktop's tests by
  Collect's own parser, validator and expression validator, and turned into the form
  (`CeoSurveyIdmlTest`). The designer's output can be checked the same way.
- **The form is generated.** Since Collect Earth 2.0 the desktop builds the data entry form from
  the survey when the project opens (`SurveyFormModelBuilder`). The balloon HTML, the KML
  template and the analysis cube of a project file are no longer read by the desktop. The
  cloud still expects the balloon and template stubs when it adds the round and the note.
- **Rules run in Java.** Show-when, required, checks and calculated values are evaluated by
  Collect inside the desktop at every save. The Node server has no expression engine.
- **The dashboard.** Setup › Survey form is today the project file upload; no screen shows the
  questions. The Projects page already has a disabled "Design the survey here: Coming soon"
  entry.
- **A gap.** Collect Earth downloads the project file only when a person joins, or opens the
  project from their list of projects. Plot layout and imagery changes reach running desktops
  (every two minutes), a changed survey does not.

## Principles

1. **The survey stays Collect's file.** The designer edits the same `placemark.idm.xml` inside
   the project file. Everything that reads surveys today keeps working: the desktop, backups,
   the analysis, the IPCC package, Collect itself. A survey made in Collect's designer opens in
   ours, and the other way round.
2. **Nothing is lost.** The designer changes what it understands and carries everything else
   through untouched: a formula, an option it has no control for, an attribute type it does not
   offer. Opening and saving a survey without a change gives the same survey.
3. **A form builder, not a schema editor.** The words are pages, questions, answer lists,
   tables, "show when" and rules. Nobody sees entities, attributes, annotations or XPath unless
   they open the advanced part.
4. **The fixed fields are not the coordinator's concern.** The designer adds and protects the
   six required fields and the ones the server adds (`round`, the note, the period status).
5. **One path in.** A save goes through `acceptCep`, like an upload: the same checks, the same
   round, the same removal of keys and passwords.
6. **Collect's designer stays possible.** Uploading a project file made elsewhere keeps working.

## The designer

### Where

- **Setup › Survey form** shows the survey: its pages and questions, as the interpreter meets
  them. "Edit" opens the designer. "Upload a project file" stays, below.
- **Projects › New project › "Design the survey here"** starts a project from a template or a
  blank survey.

### What a coordinator works with

| In the designer | In Collect's file | Notes |
| --- | --- | --- |
| Page | Tab | Add, rename, reorder, delete when empty |
| Question | Attribute | Types below; move within and between pages |
| Answer list | Code list | Items: code, label, help text; reorder; used by several questions |
| Sub-list | Second level of a list | "Land use, then its subdivisions": the second question shows the items of the first's answer |
| Table | Enumerated entity, table layout | One row per item of an answer list; the columns are questions |
| Repeated block | Enumerated entity, form layout | The same questions asked for each item of a list |
| Show when | `relevant` | Built by picking, below |
| Required | `required` | "Always" or "When it is shown" |
| Rule | Check | A message in each language, error or warning |
| Information from the plot file | `collectearth:fromcsv` | A column of the plot file kept in the record; optionally shown to the interpreter |
| Calculated value | `calculated` with its formulas | Advanced; see below |

**Question types offered:** one answer from a list, several answers from a list, yes/no, whole
number, decimal number, short text, long text, date. A choice is shown as buttons, or as a
searchable list when the coordinator asks for one, as the form does today.

**Not offered, but kept and shown when a survey has them:** time, range, coordinate (other than
the plot's), species, file, entities that are not "one per item of a list", units, versions.

### Show when

A condition is built from rows, joined by "all of" or "any of":

- *question* **is** / **is not** *answer* (choice);
- *question* **is yes** / **is no** (yes/no);
- *question* **is answered** / **is not answered**;
- *question* **is less than / at most / at least / more than** *number*.

This covers every condition of the three templates but the two `starts-with`. A condition the
builder cannot show is displayed as text under "Advanced condition" and kept as it is.

### Rules

- A number **between** two values, **at least**, **at most**.
- A question **compared with another** (the year of change after the base year).
- In a table: **the column adds up to** at least, at most or exactly a number. The form already
  shows that total under the column.
- Anything else: kept, shown as text.

### Calculated values

A calculated value is a hidden field the form fills by itself from other answers, never asked to
the interpreter: the IPCC template has 105 of them, with 561 formulas between them (563 default
values in all), which build the land-use time series from the land use, its subdivision and the
year of change: `ipcc_2000_subdivision`, for one, has 11 formulas, each a value *if* a condition
such as `land_use_category_has_changed and land_use_subcategory_year_of_change > 2000`. The IPCC
package and the analysis read these fields.

They stay in a collapsed "Calculated values (advanced)" list, with their names, their formulas
as text, and the questions they depend on. **At first a formula is shown, not edited**: the
coordinator can keep or delete the calculated value, rename its label, and it keeps working, but
cannot type a new formula. A formula with one wrong character makes the whole survey fail to
open in Collect Earth, and the server cannot check one yet: Collect's checker is Java. Editing a
formula as text comes with a check of its syntax (stage 7, see "Expressions"). The questions a
formula uses are known, so deleting or renaming one of them warns that the formula would break.

### Languages

One language is edited at a time, with a switch at the top and a count of what is not translated
yet. Adding a language adds it to the survey. Labels can go out and come back as a spreadsheet
(Collect's designer has this, and translators need it).

### Preview

1. **In the designer:** the page as the form will show it, with each condition written under
   its question ("shown when Land use is Forest"). Conditions made with the builder also work
   live, since the builder's small grammar can be evaluated in the browser.
2. **In Collect Earth:** a draft project already takes training answers. The coordinator opens
   the draft in Collect Earth, makes a training set of a few plots, and tries the real form.
   Nothing new is needed for this but saying so in the designer.
3. **Later, if wanted:** the desktop's own form shown in the dashboard. It needs the form's
   files shared between the two apps and its model builder written again in TypeScript, and it
   would still not run formulas or advanced conditions.

### Changing a survey that is in use

A draft project is edited freely. Once the project has records, **every change is allowed**
(decided 18 Nov), and the designer says before saving, in plain words and with numbers, what it
does to the plots already collected:

| Change | What the coordinator is told before saving |
| --- | --- |
| Labels, help texts, translations, messages | Nothing: the answers are untouched |
| A new page, question, list item, rule or condition | The plots already done do not have the new answer; they are not reopened by themselves |
| Reordering pages, questions, list items | Nothing |
| Making a question required, or a rule stricter | How many plots already collected break it, and that they are flagged when reopened |
| A new "show when" | How many plots have an answer that would now be hidden; the answers stay in the records |
| Deleting a question | How many plots answered it; their answers stay in the records and the exports of before, but no longer appear in the form, the exports or the analysis |
| Deleting a list item | How many plots chose it, the same way |
| Changing a list item's code | How many plots chose it; their answers keep the old code, which then matches no item |
| Renaming a question's internal name | How many plots answered it; to Collect those answers belong to a question that no longer exists, so they disappear from the form and the exports |
| Changing a question's type, its list, or the table it is in | The same, as Collect cannot read the old answers as the new type |
| Changing the keys | The strongest warning: every plot's record is identified by its keys |

The warnings for the last five are shown in a dialog the coordinator confirms, with the count of
plots affected and a download of the answers concerned (CSV) before the change.
Collect's designer refuses these changes on a published survey; here they are the coordinator's
choice, made knowingly.

Each save keeps the previous survey, so a change can be undone, and the Activity tab says who
changed what.

**Collect Earth must take the new survey.** This is new work on the desktop: during the cloud
sync it asks whether the project file changed and, when it did, downloads it and loads it again
(as it does today for the plot layout), with a notice. Until that exists, a changed survey
reaches only the people who join after it, or who open the project again from their list.

## How it is built

### The model

- The server parses the survey into an ordered tree (the parser it already uses) and keeps the
  tree whole. A **designer model** is read from it: pages, questions, lists, tables, conditions,
  rules, each with the id of its node.
- An edit is an operation on the tree ("rename this label", "add a question after that one").
  The tree is then written back. What the designer model does not describe is never touched.
- The types the dashboard and the server exchange go in `src/wire/survey.ts`.
- This replaces the narrow model of the Collect Earth Online import in time: `writeIdml` becomes
  "build a designer model, write it".

### Routes (coordinators)

- `GET /v1/projects/:pid/survey/design`: the designer model, its warnings, and what may be
  changed now.
- `POST /v1/projects/:pid/survey/design`: a list of operations with the version they apply to;
  answers the new model, or what was refused and why. 409 when someone else saved meanwhile.
- `GET /v1/projects/:pid/survey/versions`, and a restore.
- `POST /v1/projects` with a template, for "Design the survey here".

Each gets its cross-project 404 case in `test/isolation.test.ts`. In the local mode (the
dashboard inside Collect Earth) the designer is off at first.

### Expressions

- The builder writes expressions itself, so they are right by construction: the questions exist
  and the values are items of their lists.
- For expressions kept as they are, the server only needs to **read** them enough to know which
  questions they name, so that deleting or renaming is refused or carried through. A small
  reader of the subset the templates use is enough for that.
- Free-text editing of formulas needs a true syntax check, because a survey with a broken
  expression does not open in Collect Earth. Collect's parser is Java. So formulas stay
  read-only until that check exists: a parser of Collect's expression language in TypeScript
  (parsing only, not evaluating).

### The project file

The designer writes what Collect Earth 2.0 reads: the survey, `project_definition.properties`,
and the two small stubs the server's own steps expect. The plot layout, the imagery windows, the
plot files and the areas are already set on the dashboard.

**Dropped from Collect's export:** the balloon generator (1,650 lines and 57 assets), the
analysis cube, the KML template's content, the test plots.

**Consequence:** a project file made by the designer is for Collect Earth 2.0 and later. An
older Collect Earth needs the balloon, which only Collect's designer makes. Cloud projects need
2.0 anyway.

### Templates

The three templates are copied from Collect (both are MIT, Open Foris). "Blank" is the six
fixed fields, the plot-file values and one empty page. The multipurpose and IPCC templates name
years (a list of 26 or 27 years, "LU 2026"): a later step asks the first and last year and fills
them in.

## What is dropped, and why

| Dropped | Why |
| --- | --- |
| Species lists, sampling point data, units, versions, several SRS | No Collect Earth template uses them |
| Time, range, file, species questions; free multiple entities; nesting | Not used; kept if a survey has them |
| Layout columns, widths, label kinds, phases | Not used; the form lays itself out |
| Pattern, uniqueness and distance checks | Not used |
| Draft and published copies of a survey | The project's own draft and active states do this |
| Balloon, cube, KML content, test plots | Collect Earth 2.0 does not read them |
| A general formula editor | 563 formulas travel with the IPCC template; nobody types them |

## Stages

Each stage is useful by itself and can stop there.

| Stage | What the coordinator gets | Main work |
| --- | --- | --- |
| 0. Trial | Nothing visible | The tree model reads and writes the three templates, the demo survey and real project files with no loss; checked by Collect's own parser and validator in the desktop's tests. Go or no-go for the approach |
| 1. See | Setup › Survey form shows pages, questions, lists, tables, conditions in plain words | The designer model, read-only |
| 2. Words | Edit labels, help texts, list item labels; translations; add a language | The first operations; versions and undo; the rules for a survey in use |
| 3. Questions | Add, move and delete pages, questions and answer lists; required; plot-file columns | Names made from labels; Collect's survey rules |
| 4. Logic | Show when, rules, sub-lists, tables and repeated blocks | The condition builder and its small reader |
| 5. New | "Design the survey here": blank or a template; years for multipurpose and IPCC | Templates in the repository |
| 6. In use | Collect Earth takes a changed survey by itself; preview that reacts | Desktop work; the browser evaluation of builder conditions |
| 7. Later | Formulas as text, labels as a spreadsheet, the desktop's form as preview | A TypeScript parser of Collect's expressions |

Stage 0 is small and decides the rest. Stages 1 and 2 already answer the most common need:
seeing what the survey asks and fixing its wording without another program.

## Tests

- **Round trip:** every fixture survey read and written with no change gives the same tree;
  the written file is read by Collect's parser in the desktop's tests (the `CeoSurveyIdmlTest`
  pattern), passes its validator and its expression validator, and becomes the web form.
- **Operations:** each one on a small survey, with the expected file.
- **Rules of a Collect Earth survey:** one test per rule of section 1.
- **A survey in use:** each row of the table above.
- **Isolation** and the PostgreSQL smoke for the new store methods.

## Risks

| Risk | What it would mean | What is done about it |
| --- | --- | --- |
| The tree does not write back exactly what it read | A survey silently changed | Stage 0, on real project files, before anything else |
| An expression the designer wrote is wrong | The project does not open in Collect Earth | Only the builder writes expressions; Collect's validator runs on every fixture in the tests |
| A change breaks records already collected | Answers no longer match the survey | The table of allowed changes; versions; the count of affected plots shown before deleting |
| People keep an old survey | Two people answer different forms | Stage 6; until then the designer says who the change reaches (new joiners, and people who open the project again) |
| The simple designer cannot show a real survey | A coordinator cannot edit it | Everything unknown is kept and shown as text; the upload path stays |

## Decisions (18 November 2026)

1. **Collect Earth 2.0 and later only** for surveys made by the designer: yes.
2. **Formulas:** shown, not edited, at first (see "Calculated values"): to be confirmed.
3. **Changes to a survey in use:** all allowed, with warnings that say how the data already
   collected is affected (the table above).
4. **Preview:** in the designer and in Collect Earth through a draft project first.
5. **Time questions:** later.
6. **Stages 0 and 1** go ahead.

## Progress

**Stage 0, done (18 Nov).** `collect-earth-cloud/src/survey/xmlTree.ts` reads a survey into a
tree that keeps every byte; `edit.ts` makes the designer's changes on it (labels, help texts, new
questions and lists, list items, show when, required, number ranges, moves, deleting a question
nothing uses). Read and written without a change, the three templates, the demo project's
survey, the desktop's test survey and the 14 CEO imports come back byte for byte. A change
touches only its own lines: an attribute changes inside the start tag as it was laid out (the
multipurpose template puts its root's attributes on lines of their own), new elements take
their siblings' indentation (tabs or spaces) and line breaks, and Collect's element order. The
templates with the trial changes (`collect-earth-app/src/test/resources/designer/`) pass, in
`DesignedSurveyIdmlTest`, Collect's IDML schema, Collect's `SurveyValidator` with the rules of
`CollectEarthSurveyValidator` (managers mocked), and become the web form; the test reports a
wrong condition, a name ending in `_2` and a missing `plot_file` when they are planted. Go.

**Stage 1, done (18 Nov).** `src/survey/design.ts` reads the designer model (`src/wire/survey.ts`)
and `condition.ts` the conditions as rows. On the three templates every condition reads as rows
but the two `starts-with`, one nested group (IPCC) and the rules' conditions that look into a
table's rows; they show as written. `GET /v1/projects/:pid/survey/design` (coordinators) serves
it, and Setup › Survey form shows it above the project file: the survey's pages, folding, with
each question's type, help text, answers, when it is shown, when required and its rules in
words; a switch between the survey's languages with the count of texts not translated; folded
cards for the plot file's values, the calculated values (formulas as text, and what they use),
the hidden fields and the answer lists.

Measured on the way: the IPCC template's formulas are 561, over 105 calculated values (up to 11
each), not 563 in one.
