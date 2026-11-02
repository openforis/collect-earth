# HTML UI, Stage 6 (Removal) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Swing user interface is gone: `view/*`, its property panels, the IPCC wizard, `JSwingAppender`, the
Swing paths of the services and of `EarthApp`, and the libraries only they used (FlatLaf, SwingX, g-wiz, Ikonli).
What stays Swing is what has no page to live in, and is listed below.

**Conventions:** as the earlier stage plans. `A=collect-earth-app/src/main/java/org/openforis/collect/earth/app`,
`I=collect-earth-app/src/main/java/org/openforis/collect/earth/ipcc`, `T=collect-earth-app/src/test/java/org/openforis/collect/earth/app`.

## What stays Swing or AWT, and why

| What | Why |
|---|---|
| `SwingNativeFileChooser` with `ShellFolderFallback` and `PlainFileSystemView` | `/api/files/choose`: the pages ask Java for a path, and Java shows the dialog on the same machine (design: "Files stay on the user's disk"). The two helpers move from `view` to `service`, with their tests. |
| `AppShell`'s tray icon | Opens the page again or quits (stage 1). AWT. |
| The splash screen (`SplashScreen`, set in the manifest) | Shown by the JVM before any page can be. |
| `JOptionPane`s of `EarthApp` and `ServerController` | Shown when there is no server, so no page: the server cannot start, another instance holds the port, the restart failed, a message before the context exists (`EarthApp.notify`'s fallback). And the Google Earth Web trial question asked at start, before the page opens. |
| `CollectEarthUtils.setFontDependingOnLanguaue` | The fonts of Lao and Hindi for the dialogs above. |

The look and feel of these is the system's (`UIManager.getSystemLookAndFeelClassName()`), which is what makes the file
chooser look native on Windows and macOS; FlatLaf only existed for the Swing window.

## What goes

- `$A/view/*` except nothing: `Messages` lives in `collect-earth-core` and stays. `$A/view/properties/*`.
- `$I/view/*` (the LULUCF wizard and its bundle `Messages*.properties` under `resources/.../ipcc/view`).
- `$A/logging/JSwingAppender.java`, `$A/ad_hoc/FixMissingPlotsFileInfo.java` (only the Swing missing-plots listener
  called it), `DataFormat` (only the Swing choosers, the drop handler and the preload used it).
- `KmlImportService.prompToOpenKml/loadFromKml`, `IPCCGeneratorService.prepareDataForAnalysis` (the wizard path),
  `GenerateDatabase.prepareDataForAnalysis` as an abstract method (only `AnalysisSaikuService`'s is called, by the
  Saiku job), `EarthApp`'s Swing preload, FlatLaf set-up and `executeKmlLoadAsynchronously`.
- The `SwingUtilities.invokeLater` around the progress messages of the analysis services: the progress is a job's
  now, which takes it from any thread. `LoadProjectFileServlet` loads the double-clicked project on a thread of its own
  instead of the Swing event thread.
- From the pom of `collect-earth-app`: `swingx-core`, `g-wiz`, `ikonli-swing`, `ikonli-materialdesign-pack`, `flatlaf`.
  `GAlogger` takes `StringUtils` from commons-lang3 instead of FlatLaf.

The texts of `Messages*.properties` stay: the pages use the Swing keys, and the keys only the Swing UI used are
harmless; pruning them is a separate change with its own check of every key the pages and the services ask for.

## Checking without the full build

This environment cannot resolve GeoTools, Selenium and JAXB, so the module never compiles whole here. The check is a
comparison: every main source of `collect-earth-app` and `collect-earth-sampler` is compiled against the local jars
before and after, and each error (file, message, symbol) is listed; the removal must add no error that is not
about the missing libraries. Then the API and service tests run in the harness as in the earlier stages.

### Task 1: Remove the Swing UI and its libraries

Commit `Remove the Swing user interface: the window, its dialogs, the IPCC wizard and the libraries only they used`.

### Task 2: Docs

`CLAUDE.md` (root and `collect-earth-app`): the UI is the pages; the design doc ("Stages ... done"; what is left
before merging); the frontend README.

Commit `HTML UI stage 6: the Swing user interface is gone`.

At home: `mvn -q install` with the tests; start Collect Earth with each viewer; a file chooser from the settings page
on Windows and Linux (it now has the system look); the installers build (`earth-libs` loses the five jars).
