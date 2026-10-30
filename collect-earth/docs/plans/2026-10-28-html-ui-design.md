# HTML user interface — Design

**Date:** 2026-10-28 · **Status:** validated with product owner · **Branch:** feature/html-ui

## Purpose

Replace the Swing desktop UI (53 classes, ~13 000 lines: `CollectEarthWindow`, `CollectEarthMenu`, `PropertiesDialog`
and its six panels, the import/export, utility and progress dialogs) with HTML pages that are more flexible to build
on and feel current. The properties dialog in particular is reorganised: today it is grouped by technology rather
than by what the user is doing.

## Decisions (from brainstorming)

- **Scope:** all of the Swing UI, built in stages on one branch.
- **Where it runs:** pages of the existing React + MUI app (`collect-earth-app/src/main/frontend`), in the browser
  Collect Earth already drives. No embedded browser (JCEF would add 100+ MB per installer), no Electron/Tauri.
- **The main window:** its menus move into an app bar of the plots map app. With the Google Earth Pro viewer the
  same app opens on a home page with that bar and no map. A tray icon reopens the app or quits it.
- **Transition:** the branch replaces Swing outright and is merged into master once everything has moved; master
  keeps the Swing UI until then.

## Architecture

- **One app, two shells.** The plots map (`map.html`) gains an app bar with the menus Project, Data, Tools,
  Utilities, Settings and Help. With the Google Earth Pro viewer, the app opens on a home page with the same bar.
  The form page (`form.html`) is unchanged.
- **The back end does the work.** Each Swing action already calls a service (`DataImportExportService`,
  `EarthProjectsService`, `LocalPropertiesService`, …). New Spring REST controllers under `/earth/api`
  (`org.openforis.collect.earth.app.server.api`) put those services behind JSON; the pages call them.
- **Files stay on the user's disk.** A page that needs a path asks `/earth/api/files/choose`; Java shows a native
  file dialog on the same machine and returns the path. File contents never go through the browser.
- **Start and quit.** `EarthApp` starts the server as now, then opens the app page instead of building
  `CollectEarthWindow`. An AWT `SystemTray` icon offers Open Collect Earth and Quit, as closing the browser no longer
  ends the app; where there is no tray (some Linux desktops) the Project menu has Quit.
- **Unchanged:** Jetty, the browser control (Selenium), Google Earth/KML, the services and the database layer. Only
  `view/*`, the Swing parts of `desktop/EarthApp` and the dialogs go.

## Screens

The menus keep the order of the Swing menu bar, so existing users find things where they were.

- **Project** (today's File): Import CEP file (a job with progress), Join cloud project, Cloud sync status,
  Language, Quit.
- **Data** (today's Data Import/Export): one **Export dialog** — format (CSV, KML, Collect backup, XML), filter
  (all, since the last export, from a date, by key or summary attribute), save path — replaces nine menu items and
  their dialogs. Import new data from ZIP; update records from CSV.
- **Tools:** Saiku analysis, stand-alone Saiku tool, LULUCF/IPCC package, load points from KML, open data folder,
  open plots map (Google Earth Pro viewer only).
- **Utilities:** find missing plots (a report page with a table), divide large CSV files, delete plots using a CSV:
  each a small form that runs a job.
- **Settings:** a full page, see below.
- **Help:** survey guide, user manual, about, disclaimer, technical support, application log, check for updates.

Shared pieces:

- **Job panel** for every long action: progress, log lines, Cancel, the result with Open folder.
- **File field:** a path with Browse, which calls `/files/choose`.
- **Notices:** announcements, update offers and errors as MUI dialogs and snackbars on whichever page is open.
- **Texts:** `Messages*.properties` stays the single source of translations, served through
  `/earth/api/messages?lang=`; the nine languages keep working with nothing translated twice.

### Settings, reorganised

Sections on the left, the open section on the right, and a search box over every setting's label and tooltip.

1. **Project:** the current project, recent projects as cards (name, last used, Load), Import CEP. The sample file
   lives here, as it belongs to the project; once picked it is checked: number of plots, columns found, problems
   (no coordinates, wrong separator) and a small map of the plots.
2. **Plot design:** the shape chosen from picture cards; only the fields that shape uses; a live preview of the
   plot to scale with its subplots and reference area, and the areas in hectares. Rules such as "the reference area
   must be larger than the plot" are shown at the field while typing.
3. **Imagery and viewer:** viewer (Google Earth Pro / plots map / Google Earth Web), window layout, map engine; each
   imagery source a card with a switch, its options (dates, Planet key and TFO months, URLs) shown only when on.
4. **Data storage:** SQLite or PostgreSQL; the connection fields only for PostgreSQL, with Test connection;
   automatic backup with Open backup folder.
5. **Collaboration:** cloud sync server, project, token and status.
6. **Advanced:** browser to use, form in the browser or the balloon, server port and IP, Saiku folder.

Changes are applied from a bar at the bottom ("3 changes not applied", Apply, Discard). Settings that need a restart
carry a badge, and applying them asks once whether to restart now. Each section has Restore defaults.

### Other improvements

- **Home page** (Google Earth Pro viewer): project and progress (done / partial / remaining plots), last export, and
  the next steps as large buttons (open Google Earth, export).
- **Light and dark theme** following the system, with the plots map's palette and the yellow plot colour.
- **Keyboard:** shortcuts for the frequent actions and a command palette (Ctrl+K) that finds any action by name.

## API and data flow

All under `/earth/api`, JSON in and out:

| Endpoint | Purpose |
|---|---|
| `GET /app` | App bar and home page: project, survey, operator, viewer, language, plot counts by status, version, update offered |
| `GET /messages?lang=` | UI texts from `Messages*.properties`, with a version for caching |
| `GET /settings`, `POST /settings/validate`, `POST /settings` | Settings as sections of typed fields (type, value, choices, range, restart flag, visibility); errors per field; save returns `{restartNeeded}` |
| `POST /files/choose` | `{mode: open\|save\|folder, filters, suggested}` → `{path}` or `{cancelled: true}` |
| `POST /jobs/{action}`, `GET /jobs/{id}`, `DELETE /jobs/{id}` | Start a long action (export, import, divide, delete, Saiku, IPCC, KML load) → `{id}`; `{state, progress, messages[], result}`; cancel |
| `POST /actions/{name}` | Quick actions: open data folder, log, manual; open Google Earth; check for updates; quit |

- **Settings from one description.** Instead of panels listing their fields by hand, one Java description per section
  names its `EarthProperty`s, their type, their rules (moved out of `PropertyValidators`) and when each is shown
  (`shape == CIRCLE`). The page draws itself from it: a new setting is one line, and its form, validation and texts
  follow.
- **Jobs.** A `JobService` runs each job on a worker thread, keeps its progress and messages, and forgets it a while
  after it ends. A small adapter turns the services' existing progress monitors and listeners into job progress, so
  the services do not change. One job of each kind at a time, as the blocking Swing dialogs did.
- **Status.** The app bar polls `/app` the way the page already polls plot statuses and Google Earth Web: no
  websockets.
- **Who can call it.** The API can export, delete plots and change settings, so another site the user visits must not
  be able to drive `localhost:8028`. Rather than a token handed to the page (decided while planning stage 1), `/api/*`
  is guarded the way `/googleEarthWeb/*` already was: `OwnPagesOnlyFilter` (`Sec-Fetch-Site`, `Origin`, `Host`), and
  `ApiHeaderFilter`, which requires an `X-Collect-Earth: 1` header. A page of another site cannot send that header
  without a CORS preflight, and both filters refuse the preflight before the cross-origin filter sees it. That protects
  as well as a token, with no secret to hand out.

## Errors

- Failed calls answer `{error, message, details}`, the message in the UI language. Expected problems (an unreadable
  file, a wrong CSV separator, PostgreSQL refusing the connection) get a dialog saying what to do; unexpected ones say
  what failed, offer Open log, and go to Sentry as now.
- A failed job keeps its log lines, so the user sees where it stopped.
- When the server stops answering (a restart after applying settings, a crash) the page says Collect Earth is
  restarting and reconnects by itself.
- Errors before the server runs (no browser, the port held by another instance) still need a native message box:
  the one place a plain AWT/JOptionPane dialog stays.

## Testing

- **Java:** MockMvc tests for every endpoint; tests of the settings description (visibility, validation, restart
  flags), taking over from the validator tests; `JobService` tests for progress, cancel, failure and clean-up.
- **Frontend:** Vitest for the API client, the settings form (fields per shape, errors per field), the export dialog
  and the job panel, as the existing `*.test.ts`.
- **End to end:** a few browser tests with the existing Selenium setup behind `-Dce.browserTests` (open the app,
  change a setting, export to a temporary folder).
- Each stage is checked by hand in the real app on JRE 21 against the Swing screen it replaces.

## Stages

1. **Foundation** (done): `/earth/api` controllers behind the header check, `/app`, `/messages`, `/files/choose`, `JobService`; the app bar
   in the plots map and the home page; tray icon and Quit. `EarthApp` opens the page instead of the Swing window.
2. **Settings:** section descriptions, server-side validation, the new settings page with plot preview and sample
   file check.
3. **Data:** export dialog, imports, job panel.
4. **Tools and Utilities:** Saiku, IPCC, KML load, divide CSV, delete plots, missing plots report.
5. **Project, Help and notices:** CEP import, cloud join and sync, help items, announcements, updates.
6. **Removal:** delete `view/*` and the other Swing classes, FlatLaf and Swing-only dependencies; update `CLAUDE.md`,
   and the installers if what they ship changes.

### Left by stage 1 for the later stages

What the Swing main window did at startup and the pages do not do yet. Each must be in place before the branch is
merged:

- **Cloud login** when cloud sync is on and nobody is logged in (`CollectEarthWindow.promptCloudLogin`), stage 5. The
  operator chip refuses changes in cloud mode, so until then a cloud user with no operator has no way in.
- **Window title** with the project name and the cloud suffix, and the **drag and drop** of files onto the window.
- **Logged errors** are still shown in a Swing dialog (`JSwingAppender`), set up by `AppShell`; they move to the
  pages' notices in stage 5, along with the "Show exception errors" toggle (Help).
- **Without a system tray** (some Linux desktops) a closed home page cannot be opened again: a second start of
  Collect Earth should then open it.
- The Swing dialogs still used have no parent window, so they can open behind the browser, until they move to pages.
