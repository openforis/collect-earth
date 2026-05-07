# Module Guidelines: collect-earth-app

## Scope

This module owns the desktop application, embedded Jetty server, Swing UI, browser and Google Earth integration, logging setup, and runtime resources. Follow the root `AGENTS.md` for repository-wide rules.

## Structure

- Java sources: `src/main/java/org/openforis/collect/earth/app`
- Main entry point: `org.openforis.collect.earth.app.desktop.EarthApp`
- Runtime resources: `src/main/resources`
- Images and UI assets: `src/main/resources/images`
- Web and servlet resources: `src/main/resources/WEB-INF`

## Build and Run

- `mvn -pl collect-earth-app -am package`: builds this module and required dependencies.
- `java -jar collect-earth-app/target/CollectEarth.jar`: runs the packaged desktop app from the repository root.

The package step copies runtime dependencies to `target/earth-libs`; do not edit that generated directory.

## Change Guidance

Keep UI changes consistent with the existing Swing and FlatLaf patterns. Use the existing service classes for project, property, KML, and update behavior before adding new global helpers. For visible UI, browser automation, update checks, or Google Earth launch changes, include manual smoke-test notes in the pull request.
