# Repository Guidelines

## Project Structure & Module Organization

Collect Earth is a multi-module Maven Java project. The root `pom.xml` defines the active reactor modules: `collect-earth-core`, `collect-earth-app`, `collect-earth-sampler`, `collect-earth-grid` (a developer tool that nothing ships), and `collect-earth-installer`. Core domain and shared services live under `collect-earth-core/src/main/java`. The desktop application, embedded server and runtime resources are in `collect-earth-app/src/main/java` and `collect-earth-app/src/main/resources`; its user interface is web pages (React and MUI, `collect-earth-app/src/main/frontend`) over a JSON API (`org.openforis.collect.earth.app.server.api`), shown in the browser Collect Earth drives beside Google Earth Web. Swing is left only for the file dialog, the splash, the tray icon and the messages shown when there is no server. Sampling and geospatial helpers are in `collect-earth-sampler/src/main/java`. Installer definitions, update metadata, and installer image assets are in `collect-earth-installer/src/main/resources`. Avoid editing generated `target/` content.

## Build, Test, and Development Commands

- `mvn clean verify`: builds the full reactor and runs any Maven test phase checks.
- `mvn -pl collect-earth-app -am package`: builds the desktop app plus required modules; dependencies are copied under `collect-earth-app/target/earth-libs`.
- `java -jar collect-earth-app/target/CollectEarth.jar`: runs the packaged desktop application after packaging.
- `mvn -pl collect-earth-installer -Passembly package`: builds installers, but requires InstallBuilder paths and credentials configured through Maven settings.

Use Maven 3.6.3 or newer (as Collect) and a JDK 17 or newer. The source and target Java level is 17 (`java.release`), as Collect's.

## Coding Style & Naming Conventions

Follow the existing Java style: tabs for indentation in Java/XML files, braces on the same line, `PascalCase` classes, `camelCase` methods and fields, and uppercase constants. Keep packages under `org.openforis.collect.earth.*` and place new code in the module that owns the behavior. Prefer existing services and utilities before adding new abstractions. Resource bundles, images, XML, and web resources should stay under the matching module's `src/main/resources` tree.

## Testing Guidelines

Each module's tests are under its `src/test/java` (JUnit 5) and run with `mvn test` or `mvn clean verify`; the web UI's are beside its sources in `collect-earth-app/src/main/frontend` (Vitest, `npm test`). Add tests there for new testable behavior, and name test classes after the class or feature under test, for example `KmlGeneratorServiceTest`. For UI, installer, or Google Earth Web integration changes, document manual smoke-test steps in the pull request.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries such as `update to 1.23.0-SNAPSHOT` and Maven release-plugin messages. Keep commits focused and mention the affected area when useful, for example `collect-earth-app: fix update dialog`. Pull requests should include a concise description, linked issue or support-forum context when available, test results or manual verification notes, and screenshots for visible UI changes. Call out installer, update XML, credential, or external-service changes explicitly.

## Security & Configuration Tips

Do not commit local Maven credentials, Google Maps keys, Planet keys, Nexus credentials, or InstallBuilder paths. Keep machine-specific values in local Maven settings, using `maven_settings.xml` only as a template.
