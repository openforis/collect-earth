# Plots map web UI

React + MUI + Vite app for the Collect Earth plots map: the plot list and the form, in a panel of the
Google Earth Web page Collect Earth drives (`javascript_plots_map_panel.fmt`), Google Earth Web being the map.
It is served by the embedded Jetty server at `http://localhost:8028/earth/map`
(`LeafletMapController`) and talks to the same endpoints as before: `/mapConfig`,
`/plotsGeoJson`, `/plotStatuses`, `/openAuxiliaryWindows`, and `/googleEarthWeb/*` for the page around it.

A second page, `form.html` (`/earth/form?id=<plot id>&lang=<language>`), is the data entry
form shown in the panel. It is generated at runtime from the survey: `/surveyForm` describes
the tabs and fields (`SurveyFormModelBuilder`), `/surveyForm/plot` gives the plot file values,
and the data goes through the balloon endpoints (`/placemark-info-expanded`,
`/save-data-expanded`, `/create-entity`, `/delete-entity`). With `web_form=balloon` in
`earth.properties` the panel shows the CEP balloon (`/balloon`) instead. See
`docs/plans/2026-10-20-generated-web-form.md`.

This app replaces the Swing main window (see `docs/plans/2026-10-28-html-ui-design.md`): the panel has an
app bar (menus, operator, Quit) on top. The app bar talks to the JSON API under `/earth/api`
(`server.api` in the Java code): every call must send `X-Collect-Earth: 1`, which `apiClient.ts`
does. Its texts are those of the Swing UI (`Messages*.properties`), read from `/earth/api/messages`
(`serverTexts.ts`).

The Settings entry of the app bar opens the settings page (`src/components/settings/`), which replaces
the Swing properties dialog. It draws itself from `GET /earth/api/settings` (`SettingsModel` in Java
describes every setting, its type, when it is shown and its texts), validates what the user types through
`POST /earth/api/settings/validate` while typing, and saves only the changes with `POST /earth/api/settings`,
which restarts Collect Earth when a setting needs it. `src/settings.ts` holds the pure logic (the
visibility conditions, the changes, the search), `src/plotPreview.ts` the drawing of the plot, and
`src/settingsApi.ts` the calls.

The Data menu (`src/components/data/`) has the export dialog (one dialog for the formats and the records
filters of the nine Swing entries), Import new data from ZIP and Update records from CSV. The long actions
run as jobs of the server (`POST /earth/api/jobs/export`, `importSummary`, `import`, `updateCsv`), which
`JobPanel.tsx` follows through `GET /earth/api/jobs/{id}` (`src/jobs.ts`), with Cancel and, at the end,
Open file / Open folder (`POST /earth/api/files/open`, `reveal`). The ZIP import reads the files first and
asks about the records already in the database before importing (`src/importDialog.ts`).

The Tools and Utilities menus (`src/components/tools/`) open the dashboard's analysis page (Tools > Analyse the
data, which downloads its stand-alone file too) and run the LULUCF package as jobs (`POST /earth/api/jobs/ipccPrepare`,
`ipccOutputs`), asking first whether to generate the dataset again when `GET /earth/api/tools/analysis` says one exists; the LULUCF form of
`IpccDialog.tsx` replaces the Swing wizard (`src/tools.ts` holds its logic). Load points from KML
(`POST /earth/api/tools/loadKml`) restarts Collect Earth under the restart overlay. The utilities are jobs too
(`missingPlots`, `divideCsv`, `deletePlots`), with the checks of the Swing dialogs made by the server first
(`GET /earth/api/tools/divideCsv/columns`, `POST /earth/api/settings/sampleFile`,
`POST /earth/api/tools/deletePlots/check`). Open data folder is a quick action
(`POST /earth/api/actions/openDataFolder`).

The Project menu (`src/components/project/`) imports a CEP (`POST /earth/api/projects/import`, then the restart
overlay), joins a cloud project in the steps of the Swing menu (`POST /earth/api/cloud/preview`, `join`), shows the
cloud sync status (`GET /earth/api/cloud/status`, polled while open) and changes the language
(`PUT /earth/api/app/language`, then the page reloads). In cloud mode with nobody logged in the app bar asks for the
cloud login first (`POST /earth/api/cloud/login`). Next to the project's name the project chip says where it keeps its data,
from `GET /earth/api/cloud/state` (`src/cloud.ts`, read every 15 s in a cloud project): on this computer, or the cloud
project, its server and its sending (waiting, offline, failed, sign in again), and the "you" chip your role there; the
settings list the accounts signed in
there, with Sign out (`POST /earth/api/cloud/signOut`), and the form says a plot is sent only once
`GET /earth/api/cloud/recordSync` does. The Help menu (`src/components/help/`) opens the survey guide, the
manual, the support site and the updater as actions, shows the disclaimer and the log (`GET /earth/api/help/text`),
About (from `/earth/api/app`) and switches the showing of the errors logged (`PUT /earth/api/help/errorsShown`).
The notices of the server (`src/components/notices/NoticeDialog.tsx`: announcements, the update offer, the errors
logged, the server's warnings) are polled from `GET /earth/api/notices` every few seconds and answered with
`POST /earth/api/notices/{id}/answer`. A file dropped on the page is uploaded (`POST /earth/api/files/upload`) and
then imported (a `.cep`), loaded (a KML) or offered as the plots file (a `.csv`/`.ced`).

## Build

The Maven build of `collect-earth-app` builds it automatically (`frontend-maven-plugin`
downloads a local Node into `node/`, runs `npm ci` and `npm run build`). The output goes
to `target/classes/leafletmap/` and ends up in the jar. Use `-Dskip.npm` to skip it.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173/ - the panel alone, data endpoints proxied to a running Collect Earth on :8028
npm test           # unit tests (plot list logic, form protocol logic)
npm run typecheck
npm run build      # rebuilds target/classes/leafletmap (reload Google Earth Web's page to see it)
```

## Structure

- `src/controller.ts` - owns plots, statuses, selection and polling;
  React subscribes to it with `useSyncExternalStore`
- `src/plots.ts` - pure list logic (filter, next unfinished, neighbours, counts)
- `src/components/` - the virtualized plot list, the form panel and the app bar (`AppBar.tsx`)
- `src/apiClient.ts`, `src/serverTexts.ts`, `src/appInfo.ts`, `src/menus.ts`, `src/appBar.ts` -
  the API client, the Swing texts, `/api/app`, the menus and their pure logic
- `src/settings.ts`, `src/settingsApi.ts`, `src/plotPreview.ts`, `src/components/settings/` - the
  settings page: its model, its calls, the plot preview and its components
- `src/jobs.ts`, `src/dataApi.ts`, `src/exportDialog.ts`, `src/importDialog.ts`, `src/components/data/` -
  the jobs, the Data menu's calls and dialogs, and the job panel
- `src/tools.ts`, `src/toolsApi.ts`, `src/components/tools/` - the Tools and Utilities menus: the LULUCF
  form's logic, the calls, the dialogs
- `src/project.ts`, `src/projectApi.ts`, `src/notices.ts`, `src/noticesApi.ts`, `src/components/project/`,
  `src/components/help/`, `src/components/notices/` - the Project and Help menus and the notices of the server
- `src/form/` - the generated data entry form: `model.ts` (pure protocol logic: value
  formats, response merges, hierarchical codes, errors), `store.ts` (server traffic, serialized
  autosave, submit), `FormApp.tsx` / `fields.tsx` (UI)

No CDN: fonts (Roboto), icons and Leaflet (the plot preview of the settings page) are bundled.
