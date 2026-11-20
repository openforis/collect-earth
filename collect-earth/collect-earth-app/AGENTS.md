# Module Guidelines: collect-earth-app

## Scope

This module owns the desktop application, embedded Jetty server, the web user interface (`src/main/frontend`, React and MUI) and the JSON API it calls (`server.api`), the browser Collect Earth drives (Google Earth Web and the imagery window), logging setup, and runtime resources. Follow the root `AGENTS.md` for repository-wide rules.

## Structure

- Java sources: `src/main/java/org/openforis/collect/earth/app`
- Main entry point: `org.openforis.collect.earth.app.desktop.EarthApp`
- Runtime resources: `src/main/resources`
- Images and UI assets: `src/main/resources/images`
- Web and servlet resources: `src/main/resources/WEB-INF`
- Web user interface (the plots map, the form and every menu's pages): `src/main/frontend` (see its README)

## Build and Run

- `mvn -pl collect-earth-app -am package`: builds this module and required dependencies.
- `java -jar collect-earth-app/target/CollectEarth.jar`: runs the packaged desktop app from the repository root.

The package step copies runtime dependencies to `target/earth-libs`; do not edit that generated directory.

## Change Guidance

Make UI changes in the web pages of `src/main/frontend` and the API under `server.api`: a long action is a job (`service.jobs`), a message for the user a notice (`service.notices`), and every text is in `Messages*.properties` (or the frontend's `i18n.ts`) in the five languages. Swing is left only for the file dialog, the splash, the tray icon and the messages shown when there is no server; add no new Swing UI. Use the existing service classes for project, property, KML, and update behavior before adding new global helpers. For visible UI, browser automation, update checks, or Google Earth launch changes, include manual smoke-test notes in the pull request.
