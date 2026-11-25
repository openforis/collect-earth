# The survey guide as an address (25 Nov 2026)

A survey's guide is the document that tells people how to interpret the plots. Until now it was a file inside the
project file (`survey_guide.pdf`), which Collect Earth opened from Help > "Open the Survey Guide": megabytes that every
person downloaded with the project file and that the cloud kept twice (the IPCC demo survey's guide is 8.0 MB of an
8.6 MB project file), in a place few people found.

## What changed

- **The project file carries an address.** `survey_guide_url` in `project_definition.properties` is the address of the
  guide: any `http(s)` address a browser opens. A project file of before, with `survey_guide.pdf` inside, still works;
  with both, the address wins.
- **Collect Earth** (`service/SurveyGuide`): a book button in the top bar, in sight beside the form, opens the guide in
  the browser (the Help menu's entry stays). A project without a guide does not keep the one of the project opened
  before. In a cloud project the guide is asked for during the sync, every two minutes (`GET /survey-guide`), and a
  guide set, changed or taken away on the dashboard is told in a notice; the button shows or goes with it.
- **The cloud** (`src/surveyGuide.ts`, `src/routes/surveyGuide.ts`, migration 054): a project has one guide, a PDF the
  server keeps (25 MB at most, counted in the project's space) or a link to one kept elsewhere. A PDF is served at
  `/guide/<project>/<token>` with no login, as a browser opens it: the token guards it, stays the same when the PDF is
  replaced (the project files people hold keep working) and is left out of the logs. A change rewrites
  `survey_guide_url` in the stored project file, as a change of the plot layout does.
- **A project file uploaded with a guide inside** is kept without it: the PDF becomes the project's guide and the
  upload's answer says so (`guideMoved`). The demo survey's project file is then served at 1.0 MB instead of 8.6 MB.
- **The dashboard**: Setup › Survey form has a "Survey guide" card (see it, upload a PDF, give a link, remove it);
  collectors and reviewers get a "Survey guide" button on their project page.

## Checked for real

On PostgreSQL: the demo project file (8,589,555 bytes) uploaded to a new project is kept at 994,894 bytes, with
`survey_guide_url` in its settings; the address answers 200 `application/pdf` with the 8,030,378 bytes that were inside.

## Not done

- The demo survey shipped with Collect Earth still has its guide inside: it needs a public address to live at (the
  Open Foris web site, say); with one, set `survey_guide_url` in `resources/demo_survey.cep` and take the PDF out.
- A guide per language. One address per project for now.
- Local mode (the dashboard inside Collect Earth) has no guide routes: alone, the guide is the project file's own.
