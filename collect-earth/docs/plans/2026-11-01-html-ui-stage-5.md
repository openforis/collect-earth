# HTML UI, Stage 5 (Project, Help and notices) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Project and Help menus of the app bar work, and what the Swing window showed by itself reaches the
pages: the announcements, the offer of a new version, the errors logged (when the user wants them), the server's
start-up warnings and the cloud login. With this every entry of the Swing menu bar is built, and the Swing dialogs
left are only the ones stage 6 deletes.

**Architecture:** A `NoticeService` (`service/notices`) keeps the notices the server wants the pages to show, each
with its options; the pages poll `GET /api/notices` and answer `POST /api/notices/{id}/answer`, which runs what the
option does on the server (the updater, "do not remind me", the announcement marked as read). A log4j appender
(`NoticeAppender`) turns the errors logged into notices, as `JSwingAppender` turned them into dialogs. A
`StartupNotices` bean does at each start what `EarthApp` did after the server started (announcements after 5 s, the
update check after 20 s). `CloudService` holds the join, login and status flows of the Swing dialogs, behind
`CloudController`. The Help entries are quick actions and one text endpoint; the version, build and Java of the About
dialog come with `/api/app`.

**Tech stack, conventions:** as the earlier stage plans. `S=collect-earth-app/src/main/java/org/openforis/collect/earth/app/service`,
`C=collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/api`, `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`,
`F=collect-earth-app/src/main/frontend/src`, `D=collect-earth-app/src/main/java/org/openforis/collect/earth/app/desktop`.

## What the Swing window did (inventory)

**File menu** (`CollectEarthMenu.getFileMenu`, the Project menu of the app bar):

| Entry | What happens |
|---|---|
| `CollectEarthMenu.0` Import CEP | A `.cep` chosen (`DataFormat.PROJECT_DEFINITION_FILE`), `earthProjectsService.loadCompressedProjectFile(file)` (unzips into the projects folder, loads it as `loadProjectInFolder`), then `restartEarth()`. An `IOException` (not a project) is shown with `OptionWizard.51` and logged at warn; other errors at error. |
| `CollectEarthMenu.joinCloudProject` | `joinCloudProject`: an input dialog for the invitation link (`CloudJoin.urlPrompt`), which must contain `/join/`; `cloudApiClient.getJoinPreview(baseUrl, token)` (`CloudJoin.inviteInvalid` when not valid); a confirmation (`CloudJoin.previewMessage` with the project name and role); `CloudLoginDialog` with Log in and Register (the invite token); `downloadCep(baseUrl, projectId, token)`, `loadCompressedProjectFile`, the properties saved (`saveCloudSyncUrl`, `saveCloudProjectId`, `saveCloudSyncToken`, `saveOperator`, `setCloudSyncEnabled(true)`, `saveCollectDBDriver(CLOUD)`), then `restartEarth()`. Errors: `CloudJoin.errorTitle`. |
| `CloudSyncStatusDialog.menuItem` | A dialog with the project id, pending, failed, synced, last sync, last error (`cloudSyncService.getStatusSnapshot()`), refreshed every 3 s; Sync now (`syncNowAsync`, `CloudSyncStatusDialog.syncNowStarted`), Refresh, Close. `CloudSyncStatusDialog.notEnabled` when cloud sync is off. |
| `CollectEarthWindow.2` Language | A radio per `UI_LANGUAGE` (its label); `setUiLanguage`, the font, then the window disposed and opened again. |
| `CollectEarthWindow.11` Quit | Stage 1. |

**Help menu** (`getHelpMenu`):

| Entry | What happens |
|---|---|
| `CollectEarthWindow.70` Survey guide | Only when `earthSurveyService.getSurveyGuide()` exists and is readable: `CollectEarthUtils.openFile`. |
| `CollectEarthWindow.56` About | `AboutDialog`: "Collect Earth v. <version> ( built <date>) - JRE v. <java>", `AboutDialog.3`, the link to openforis.org (`AboutDialog.5`), the change log link (`AboutDialog.4`), Ok. |
| `CollectEarthWindow.17` Disclaimer | `OpenTextFileListener`: the text of `resources/disclaimer_<lang>.txt` (or `disclaimer_en.txt`) in a dialog titled `CollectEarthWindow.4`; `CollectEarthWindow.8` when missing. |
| `CollectEarthWindow.50` User manual | `UserManual.pdf` in the working folder opened; `CollectEarthMenu.userManualNotFound` otherwise. |
| `CollectEarthWindow.64` Support | `https://www.openforis.support` in the browser. |
| `CollectEarthWindow.52` Log | `OpenTextFileListener` of `<data folder>/earth_error.log`, titled `CollectEarthWindow.53`. |
| `CollectEarthMenu.9` Show exception errors | A check box: `localPropertiesService.setExceptionShown`, `JSwingAppender.setExceptionShown`. |
| `CollectEarthWindow.51` Check for updates | `CheckForUpdatesListener`: runs the `autoupdate` executable of the platform (next to the application or in `autoupdate/`); only logs when it is missing. |

**Shown by itself:**

| What | Where |
|---|---|
| Announcements | `EarthApp.checkForAnnouncements`, 5 s after the server started: `AnnouncementManager` fetches `announcements.json`, keeps the ids shown in `<data folder>/shown_announcements.txt`, shows each valid one not shown yet in a dialog (title, message as HTML, severity info/warning/critical), then marks it read. |
| Update offer | `EarthApp.checkForUpdates`, 20 s after: `UpdateIniUtils.shouldWarnUser` (a newer build online, and either a major update not ignored or an installation older than a month); `EarthApp.57` with the version date (`EarthApp.58/6`); Remind me later (`EarthApp.3`), Update now (`EarthApp.4`, the updater; on a Mac `EarthApp.51` Download installer opens the DMG's URL), Do not remind me again (`EarthApp.5`, `LAST_IGNORED_UPDATE`). |
| Errors logged | `JSwingAppender` on the root logger at ERROR (installed by `AppShell`): when `isExceptionShown`, the event's text in a dialog "Error has been logged"; one at a time, the errors logged meanwhile counted and reported once (`MORE_ERRORS_MESSAGE`). |
| Server start | `EarthApp`'s server listener: `SERVER_STARTED_WITH_DATABASE_CHANGE_EVENT` (PostgreSQL unreachable, SQLite used) and `SERVER_STARTED_NO_DB_CONNECTION_EVENT` as `showMessage`; the KML generation errors too (`generateKml`). `handleFatalRestartFailure` stays a Swing dialog: there is no page to show it on. |
| Cloud login | `CollectEarthWindow.promptCloudLogin`: in cloud mode with no operator, `CollectEarthWindow.cloudNotLoggedIn` OK/Cancel, then `CloudLoginDialog` (`cloudApiClient.login(url, user, password)`); the token and the operator saved. The operator chip of stage 1 refuses changes in cloud mode (`operator.cloud`). |
| Window title | `CollectEarthWindow.19` + " - " + the project name + `CollectEarthWindow.cloudTitleSuffix` in cloud mode. |
| Dropped files | `CollectEarthTransferHandler`: one file dropped on the window, a `.cep`, a plots file (`COLLECT_COORDS`) or a KML. |
| Client mode | `serverMenuItems`: the entries hidden when Collect Earth acts as a client of another instance (left by stage 3). |

## Decisions

- **Notices** (`$S/notices/Notice.java`, `NoticeService.java`): a notice is `{id, kind, severity, title, message, options: [{id, label}], html}`;
  kinds `announcement`, `update`, `error`, `server`, `cloudLogin`. `NoticeService.post(notice, answerer)` keeps it until
  answered; `pending()` lists them oldest first; `answer(id, option)` removes it and runs the answerer with the option
  (the updater, the ignored build, the announcement read). An option-less notice has one option, `ok`. The pages poll
  `GET /api/notices` every 5 s while visible and show the first pending as a dialog; `POST /api/notices/{id}/answer {option}`.
  The texts of the options are the Swing ones (`EarthApp.3/4/5/51`, `AboutDialog.8` for Ok).
- **`NoticeAppender`** (`logging/NoticeAppender.java`): the log4j appender of the pages, installed by `AppShell`
  instead of `JSwingAppender` (which stays, unused, for stage 6): at ERROR, when the exception-shown setting is on, an
  `error` notice with the event's text; while one is pending the later errors are counted and one more notice
  (`MORE_ERRORS_MESSAGE`, now a key) follows its answer. The `NoticeService` is given to it by `AppShell`, which gets it
  from the context; the setting is read through `LocalPropertiesService` as before.
- **`StartupNotices`** (`$S/notices/StartupNotices.java`, an `ApplicationListener<ContextRefreshedEvent>` bean):
  a daemon thread that posts the announcements after 5 s (`AnnouncementService`, the fetch and the file of
  `AnnouncementManager` moved there, the dialog replaced by a notice per announcement marked read on answer) and the
  update offer after 20 s (`UpdateService`: `shouldWarnUser` → a notice with the three options; `runUpdater()` is
  `CheckForUpdatesListener` moved, and says when the executable is missing). `EarthApp.checkForAnnouncements/checkForUpdates`
  go; the `AnnouncementManager` and the listener stay for stage 6. Headless or not, the checks run: they need no window.
- **Server events as notices:** `EarthApp`'s listener posts the two start-up events and the KML errors through the
  `NoticeService` of the new context (`ServerController` gives the context; `EarthApp.reloadPlots` of stage 2 shows
  how) instead of `showMessage`; the Swing `showMessage` stays for the restart failure.
- **`/api/app`** grows: `cloud` (cloud sync on), `cloudLoginNeeded` (cloud and no operator), `errorsShown`, `surveyGuide`
  (there is one), `manual` (the PDF is there), `build` (the build date), `java`, `languages: [{code, label}]`, `client`
  (Collect Earth as a client of another instance: the Data, Tools and Utilities entries that `serverMenuItems` hid go).
  The page sets `document.title` from it.
- **Help:** `GET /api/help/text?name=disclaimer|log` → `{path, text}` (the log's last 200 KB: the file grows to
  megabytes); 404 `help.missing` with `CollectEarthWindow.8` for a disclaimer that is not there. Actions:
  `openSurveyGuide`, `openManual` (400 `help.manualMissing`, `CollectEarthMenu.userManualNotFound`), `openSupport`
  (`CollectEarthUtils.openUrl`), `runUpdater` (400 `help.updaterMissing`). `PUT /api/help/errorsShown {shown}` sets the
  setting and the appender. About is a dialog of the page from `/api/app`.
- **Language:** `PUT /api/app/language {language}` saves it and sets `Messages`' locale; the page reloads itself, as
  the Swing window was opened again (the plots map's config, the texts and the form's language all come from the server).
- **Import CEP:** `POST /api/projects/import {path}` → `loadCompressedProjectFile`, then the restart; 400
  `projects.import` with `OptionWizard.51` and the message. No job: the unzip takes a moment and reports nothing.
- **Dropped files:** the browser gives no path, so the page uploads the file: `POST /api/files/upload?name=<name>`
  with the bytes as the body (no multipart resolver to configure) writes it in the temporary folder and answers
  `{path}`; `.cep` then goes to the import, `.kml` to the Load KML dialog, a `.csv`/`.ced` to the settings' plots file
  (the page opens the settings with it, as the transfer handler set `SAMPLE_FILE` and restarted: check `importData`).
- **Cloud** (`$S/cloud/CloudService.java`, `$C/CloudController.java`): `POST /api/cloud/preview {url}` parses the link
  (`/join/<token>`, the query and trailing slashes dropped) and answers `{baseUrl, inviteToken, projectId, projectName, role}`;
  400 `cloud.invalidUrl`, `cloud.inviteInvalid`. `POST /api/cloud/join {baseUrl, inviteToken, projectId, username, password, register}`
  logs in or registers, downloads the CEP, loads it, saves the properties, restarts: `{restart: true}`; 400 `cloud.login`
  with the server's message (`CloudLoginDialog.failed` when it has none), `cloud.noToken`. `POST /api/cloud/login {username, password}`
  for the prompt at start: the token and the operator saved, `{operator}`. `GET /api/cloud/status` → `{enabled, project, pending, failed, synced, lastSync, lastError}`;
  `POST /api/cloud/syncNow`. The page's `CloudLoginDialog` serves both the prompt and the join.
- **Texts:** the Swing keys; new keys `NoticesPage.*` (error title, more errors, the server notices), `HelpPage.*`,
  `ProjectPage.*` (import, language, drop) in English and Spanish.

## API

| Endpoint | Body | Answer |
|---|---|---|
| `GET /notices` | – | `{notices: [{id, kind, severity, title, message, html, options: [{id, label}]}]}` |
| `POST /notices/{id}/answer` | `{option}` | – (404 when gone) |
| `GET /app` | – | + `cloud, cloudLoginNeeded, errorsShown, surveyGuide, manual, build, java, languages, client` |
| `PUT /app/language` | `{language}` | – |
| `GET /help/text?name=` | – | `{path, text}` |
| `PUT /help/errorsShown` | `{shown}` | – |
| `POST /actions/openSurveyGuide`, `openManual`, `openSupport`, `runUpdater` | – | – |
| `POST /projects/import` | `{path}` | `{restart: true}` |
| `POST /files/upload?name=` | the bytes | `{path}` |
| `POST /cloud/preview` | `{url}` | `{baseUrl, inviteToken, projectId, projectName, role}` |
| `POST /cloud/join` | `{baseUrl, inviteToken, projectId, username, password, register}` | `{restart: true}` |
| `POST /cloud/login` | `{username, password}` | `{operator}` |
| `GET /cloud/status` | – | `{enabled, project, pending, failed, synced, lastSync, lastError}` |
| `POST /cloud/syncNow` | – | – |

---

### Task 1: Notices

**Files:** `$S/notices/{Notice,NoticeService}.java` (+test), `logging/NoticeAppender.java` (+test),
`$C/NoticesController.java` (+test), `$D/AppShell.java` (installs the appender), the bean in `applicationContext.fmt`.

Commit `Notices: what the server wants the pages to show, with their options; the errors logged as notices`.

### Task 2: The start-up notices and the server events

**Files:** `$S/notices/{AnnouncementService,UpdateService,StartupNotices}.java` (+tests: the parsing and filtering
of the announcements with a file in a temp folder, the update notice's options), `EarthApp` (the server listener posts
notices; the two check methods go), `ActionsController` (`runUpdater`).

Commit `The announcements, the update offer and the server's start-up warnings as notices`.

### Task 3: Help and the app info

**Files:** `$C/AppInfoController.java` (+test: the new fields, the language), `$C/HelpController.java` (+test),
`ActionsController` (`openSurveyGuide`, `openManual`, `openSupport`), texts.

Commit `GET /api/app with what the Help menu and the title need; the Help texts and actions; the language`.

### Task 4: Project: the CEP import, the upload, the cloud

**Files:** `$C/ProjectsController.java` (`import`, +test), `$C/FilesController.java` (`upload`, +test),
`$S/cloud/CloudService.java` (+test with a `CloudApiClient` stub in the harness), `$C/CloudController.java` (+test).

Commit `Project: import a CEP, upload a dropped file, join a cloud project, the cloud login and the sync status`.

### Task 5: Frontend

**Files:** `$F/appInfo.ts` (+test), `$F/notices.ts` (+test), `$F/noticesApi.ts`, `$F/components/notices/NoticeDialog.tsx`,
`$F/project.ts` (+test: the invitation link, the dropped file's kind), `$F/projectApi.ts`,
`$F/components/project/{ImportCepDialog,JoinCloudDialog,CloudLoginDialog,CloudStatusDialog,LanguageDialog}.tsx`,
`$F/components/help/{AboutDialog,TextDialog}.tsx`, `$F/components/DropZone.tsx`, `appBar.ts`, `menus.ts`,
`components/AppBar.tsx`, `App.tsx` (the title, the notices, the drop zone).

Commit `Frontend: the Project and Help menus, the notices, the dropped files`.

### Task 6: Check in a browser against the mock, then in the real app

The mock gets the notices (one of each kind), the cloud and help endpoints; the smoke runs each dialog and answers
each notice. Then the design doc ("Stages ... done", "Left by stage 5") and the README.

Commit `HTML UI stage 5: the Project and Help menus and the notices`.

At home, with the real application: the announcements and the update offer after a start, an error with "Show
exception errors" on, the cloud join with a real invitation, the login prompt in cloud mode, a dropped CEP.
