# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Collect Earth is a desktop application for augmented visual interpretation that integrates with Google Earth to enable data collection through satellite imagery. It's a Maven multi-module Java project that combines a Swing desktop UI with an embedded Jetty web server to communicate with Google Earth via dynamically generated KML files.

**Key Technologies**: Java 11, Spring 5.3.27, Jetty 9.4.58, GeoTools 24.4, Collect Framework 4.0.109

## Build Commands

### Basic Build and Run
```bash
# Full clean build
mvn clean install

# Build without running tests
mvn clean install -DskipTests

# Run the application (from collect-earth-app module)
cd collect-earth-app
java -jar target/CollectEarth.jar

# Generate Javadoc
mvn javadoc:javadoc
```

### Testing
```bash
# Run all tests
mvn test

# Run tests for a specific module
mvn test -pl collect-earth-core

# Run a single test class
mvn test -Dtest=YourTestClass

# Run a single test method
mvn test -Dtest=YourTestClass#testMethod
```

### Release Process
The project uses Maven Release Plugin with Bitrock InstallBuilder for creating installers. Release commands must be run from the `collect-earth-app` module directory (not the repo root) and activate the `assembly` profile defined in `maven_settings.xml`:

```bash
cd collect-earth-app

# Prepare release (updates versions, creates git tags)
mvn -P assembly release:clean release:prepare

# Rollback if preparation fails
mvn release:rollback

# Perform release (builds and deploys installers)
# The retry handler matters: the installers are ~1 GB in total and a single
# dropped connection otherwise throws away the whole 35-minute upload.
mvn -P assembly release:perform -Dmaven.wagon.http.retryHandler.count=3

# Resume failed perform from a specific module.
# NOTE: release:perform forks a new Maven run inside target/checkout, so a bare
# -rf applies to the outer invocation and does nothing. It has to be passed
# through with -Darguments.
mvn -P assembly release:perform -Darguments="-rf :collect-earth-installer"
```

Notes:
- Requires Bitrock InstallBuilder and a configured `maven_settings.xml` (root of repo) with installer paths and Nexus/GitHub credentials.
- **Where a release goes.** The Java artifacts — `collect-earth-core`, `-sampler`, `-app` and the parent pom —
  go to Maven Central, which is what a Maven repository is for and where Collect resolves
  `collect-earth-core` from. The installers do **not**: they are attached as assets of the GitHub release
  for the tag, by the `publish-installers-to-github` execution, and that is where the autoupdate manifest
  points. `gh` has to be on the PATH and authenticated; the step never fails the build, and says what to
  upload by hand when it cannot.

  Sending the installers to Central is what made every release a 35-minute upload that then failed while the
  Portal validated a gigabyte — three times running, and once it took the whole release with it, leaving
  1.23.16 tagged but published nowhere. `-Dinstaller.deploy.skip=false` puts them back on Central for one
  release if ever needed; the manifest keeps Central as a second download location, so versions published
  either way stay reachable.

  **Never skip the deploy of `collect-earth-installer`** (`skipNexusStagingDeployMojo`, `maven.deploy.skip`).
  `nexus-staging-maven-plugin` uploads the staged artifacts of every module from the *last* module of the
  reactor, which is the installer one, and it checks the skip flag before doing that. Skipping it there
  silently skips the upload of core, sampler and app too: that is how 1.23.18 was released with nothing on
  Central. The installers are kept off Central by not attaching them (`skipAttach`), so the module deploys
  only its pom. After a release, check
  `https://repo1.maven.org/maven2/org/openforis/collect/earth/collect-earth-core/maven-metadata.xml` (once the
  Portal deployment is published), or the log for `Uploading locally staged artifacts`.

  Each installer goes up in its own `gh` call with three attempts, updaters first. The manifest and the download
  pages are uploaded only after that step, and only once each updater answers a `HEAD` request from its GitHub
  address: 1.23.19 was announced as `major` while its GitHub upload had failed in a network outage, so every
  installation was sent to files that were not there. When the build says the updaters cannot be downloaded,
  upload the files from `target/checkout/collect-earth/collect-earth-installer/target/github-release` with
  `gh release upload <tag> --repo openforis/collect-earth --clobber <file>`, one file at a time, then copy the
  manifest and `download*.html` from `target/installer` to `/opt/fileadmin/installer` by hand.

  The asset names must be the Maven ones (`collect-earth-installer-<version>-windows-updater.exe`), not the
  InstallBuilder ones, because that is what the manifest asks for. The step renames them on the way.

  The release also carries `SHA256SUMS` and `SHA256SUMS.asc`, signed with the same key and settings
  (`gpg.executable`, `gpg.passphrase`, optionally `gpg.keyname`) that sign the artifacts on Central — the
  installers are not attached to the Maven build, so this is their only signature. If signing fails, the
  installers and checksums are still published and the log says how to sign and upload `SHA256SUMS.asc` by hand.
- The generated `collectEarthUpdateJRE11.xml` is uploaded to the web server by the build, at the `deploy`
  phase, by the `upload-autoupdate-manifest` execution of maven-antrun-plugin. It goes over scp with a key to
  `/opt/fileadmin/installer`, which is what `https://www.openforis.org/fileadmin/installer/` is served from
  and is the default in `collect-earth-installer/pom.xml`. The three values that are not in the repository -
  `openforis-update-host`, `-user` and `-keyfile` - belong in the `assembly` profile of your own
  `settings.xml`; `maven_settings.xml` documents them. Use forward slashes in the key path, since Ant reads a
  backslash as an escape. Build with `-Dautoupdate.upload.skip=true` to produce installers without touching
  the server.

  This file is what tells an installed Collect Earth that a new version exists. It used to be copied up by
  hand and was forgotten twice in a row: the live manifest still advertised 1.23.13 while 1.23.14 and
  1.23.15 had been released, so no existing installation was ever offered them.

  **`<versionId>` must equal the build number of the release it describes.** `UpdateIniUtils` offers the
  update when `onlineBuild > installedBuild`, comparing the manifest's `<versionId>` against `version_id`
  in the installed `update.ini` — nothing else, not the version name. Set it higher than the build it
  describes and everyone who installs that build is offered it again on the next start, downloads ~110 MB,
  reinstalls the same thing and is offered it again: a permanent loop. A hand-edited manifest for 1.23.15
  carried `202609241540` against an installed `202609241140` and did exactly that until it was corrected.

  Let the build substitute `BUILD_NUMBER`, which is the only way to be sure it matches. If you must write
  one by hand, the installed number is in `update.ini` next to the application, and Sentry carries it as
  the `ReleaseDate` tag on every event — `search_events` with `fields=["release","ReleaseDate","count()"]`
  gives the number that release is really reporting from the field.

#### Recovering a `release:perform` that failed during the upload

Artifacts are deployed to the Sonatype Central Portal through the OSSRH Staging API
bridge (`ossrh-staging-api.central.sonatype.com`, server id `ossrh-staging-api`).
Maven reads `~/.m2/settings.xml` by that name; a copy called anything else is only
read when `-s` names it on **every** invocation, including the build that
`release:perform` forks — a deploy with no settings Maven can see is an anonymous
one, and the bridge answers `401 Unauthorized`. The credential is a Central Portal
**user token**, not the account password.

The upload takes ~35 minutes, so **never re-run `release:perform` or `deploy`
before checking what actually failed** — doing so rebuilds all three installers and
uploads a second gigabyte into a *new* staging repository, leaving the first one
orphaned. Two open repositories for the same version make validation fail later.

`autoReleaseAfterClose` is **false**, so a successful `release:perform` ends with the
staging repository closed and nothing published: publishing is always the separate
Portal step below. It was true until 1.23.14, which made the build hold a connection
open for minutes on `/staging/profiles/org.openforis/finish` while the bridge
validated and published; that ended twice in `Remote staging finished with a failure:
java.net.SocketException: Connection reset` after the upload had already succeeded.
A reset at that point never means the upload has to be redone.

Read the tail of the log first:

- `Upload of locally staged artifacts finished.` followed by `Closing staging
  repository with ID "..."` means **every file already uploaded** and only the
  close failed. Nothing needs re-uploading — just redo the close (below).
- A failure while an individual artifact is being uploaded is the only case that
  needs a re-deploy, and even then build from the existing `target/checkout` (the
  installers are already built and signed there) rather than via `release:perform`:
  `cd target/checkout/collect-earth && mvn -P assembly deploy -DskipTests`

#### Finishing a release: close, check, publish

Every release ends here, not only a failed one: the build uploads and stops. The bridge's own
REST API does all of it with `curl` and the `ossrh-staging-api` credentials from `settings.xml`
(`$USER:$PASS` below, the Central Portal user token). This is what finished 1.23.19.

```bash
BRIDGE=https://ossrh-staging-api.central.sonatype.com

# 1. What is there. "description" names the version, "state" is open (uploaded, not closed),
#    closed (handed to the Portal, portal_deployment_id set) or released. Read the warnings:
#    they carry the organisation's publishing-size limit notices.
curl -s -u "$USER:$PASS" $BRIDGE/manual/search/repositories | python -m json.tool

# 2. Close the repository of the version being released: hands it to the Portal as a
#    deployment and publishes NOTHING (user_managed). The key is the full "key" value from
#    step 1, slashes included. The answer carries the new portal_deployment_id (step 1
#    shows it afterwards too).
curl -s -u "$USER:$PASS" -X POST \
  "$BRIDGE/manual/upload/repository/eBm0csMA/any/org.openforis--<uuid>?publishing_type=user_managed"

# 3. Check the deployment: deploymentState must be VALIDATED with errors {} and purls
#    listing the four Java artifacts only (parent, core, sampler, app, plus the installer
#    module's pom). The Portal API takes the same token, base64 of "user:token".
TOKEN=$(printf '%s:%s' "$USER" "$PASS" | base64 -w0)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "https://central.sonatype.com/api/v1/publisher/status?id=<portal_deployment_id>" | python -m json.tool

# 4. Publish, which is irreversible: press Publish on
#    https://central.sonatype.com/publishing/deployments, or
#    curl -s -X POST -H "Authorization: Bearer $TOKEN" \
#      https://central.sonatype.com/api/v1/publisher/deployment/<portal_deployment_id>
#    Central lists the version some time later; the maven-metadata.xml above is the check.

# 5. Drop a repository that will never be published - an open one left by a failed or
#    abandoned release. Irreversible, and answers 204.
curl -s -u "$USER:$PASS" -X DELETE "$BRIDGE/manual/drop/repository/eBm0csMA/any/org.openforis--<uuid>"
```

The Maven way still works and is what the earlier releases used, with its gotchas:

```bash
mvn org.sonatype.plugins:nexus-staging-maven-plugin:1.6.14:rc-close \
  -DnexusUrl=https://ossrh-staging-api.central.sonatype.com/ \
  -DserverId=ossrh-staging-api \
  -DstagingRepositoryId=<org.openforis--...> \
  -s ~/.m2/settings.xml
```

- `rc-list` and `rc-release` return **400 Bad Request** — the Portal bridge does not
  implement those legacy Nexus endpoints. Only `rc-close` works, and it is the same call
  as step 2.
- Run the `rc-*` goals with **JDK 11**. On JDK 17+ the plugin's bundled XStream
  fails with `No converter available ... module java.base does not "opens
  java.util"`. The `curl` calls above have no such constraint.
- Leaving a repository open is not free: 1.23.16 and 1.23.17 sat open for a week, one of
  them with a gigabyte of installers, until they were dropped. Close or drop after every
  release, and read the warnings in step 1 — Central enforces a monthly publishing-size
  limit per organisation from October 2026, and the installers that used to go there are
  what exhausted it.

## Module Architecture

The project is organized into **5 Maven modules** in the reactor build — `collect-earth-core`, `collect-earth-app`, `collect-earth-sampler`, `collect-earth-grid` and `collect-earth-installer` (see `<modules>` in the root `pom.xml`).

### 1. collect-earth-core
Core business logic and data handling. Contains:
- **Service Layer**: `AbstractEarthSurveyService` for survey record management, validation, and data persistence
- **Attribute Handlers**: Type-specific handlers (Text, Code, Date, Boolean, Coordinate, Real, Integer, Range, Time) in `org.openforis.collect.earth.core.handlers`
- **Data Models**: `PlacemarkObject` and related models in `org.openforis.collect.earth.core.model`
- **Database Schema**: RDB schema management in `org.openforis.collect.earth.core.rdb`
- **Utilities**: CSV parsing, survey utilities, coordinate transformations

This module has no UI dependencies and can be reused in other contexts.

### 2. collect-earth-app
Main desktop application and embedded web server. Contains:
- **Entry Point**: `org.openforis.collect.earth.app.desktop.EarthApp` - main class that launches the application
- **Server Management**: `ServerController` manages Jetty lifecycle, database connections, and Spring context initialization
- **Spring Controllers**: `PlacemarkDataController` handles HTTP requests from Google Earth balloons
- **Services**: `KmlGeneratorService`, `EarthProjectsService`, `DataImportExportService`, `LocalPropertiesService`
- **UI Components**: Swing dialogs and forms in `org.openforis.collect.earth.app.view`
- **IPCC Export**: Specialized IPCC report generation in `org.openforis.collect.earth.ipcc`
- **Integrations**: Google Analytics, Sentry error tracking, Planet imagery

### 3. collect-earth-sampler
Geospatial utilities for sampling and KML generation. Contains:
- **KML Generators**: Abstract `KmlGenerator` base class with implementations for different plot shapes (Circle, Square, Hexagon, Polygon, NFI layouts)
- **Coordinate Transformations**: `GeoUtils` handles EPSG code conversions using GeoTools
- **Template Processing**: `FreemarkerTemplateUtils` for generating KML/HTML from templates
- **KMZ Compression**: `KmzGenerator` for creating compressed KML files

### 4. collect-earth-installer
Packaging and installer generation using Bitrock InstallBuilder. Produces Windows .exe, Linux .run, and macOS .dmg installers with bundled JRE.

### 5. collect-earth-grid
Grid generation utilities for systematic global sampling (Hibernate, JDBC, CSV backends). It is built with the rest of the reactor, but **nothing ships it**: neither `collect-earth-app` nor `collect-earth-installer` depends on it, so it is a developer tool rather than part of the application.

It used to sit outside `<modules>`, which meant the release plugin never moved its `<parent>` version. It stayed pinned at `1.22.5-SNAPSHOT`, that snapshot was superseded by the `1.22.5` release and never installed again, and the module quietly stopped building. Keep it in the reactor so its parent version stays in step.

Because it is not shipped, its dependencies (Hibernate, the JDBC drivers) lag behind the ones of the application and are reported separately by Dependabot. Weigh those alerts as build-time only.

## Application Flow

1. **Startup** (`EarthApp.main()`):
   - Initializes FlatLAF Look & Feel and Sentry error tracking
   - Loads configuration from `${collectEarth.userFolder}/earth.properties`
   - Starts embedded Jetty server via `ServerController`

2. **Server Initialization** (`ServerController.startServer()`):
   - Tests PostgreSQL connectivity, falls back to SQLite if unreachable
   - Generates `applicationContext.xml` from Freemarker template with database configuration
   - Starts Jetty on port 8028
   - Loads Spring WebApplicationContext from `WEB-INF/dispatcher-servlet.xml`

3. **KML Generation** (`KmlGeneratorService`):
   - Reads survey CSV with plot coordinates
   - Uses appropriate `KmlGenerator` implementation based on plot shape
   - Generates KML with HTML balloon forms for data entry
   - Creates KMZ file that Google Earth loads

4. **Data Collection**:
   - User clicks placemark in Google Earth → balloon (HTML form) appears
   - User enters data → JavaScript sends HTTP POST to local server
   - `PlacemarkDataController.saveDataExpanded()` validates and saves to database via `EarthSurveyService`
   - Response includes validation messages and updated field information

## Spring Configuration

- **Runtime Generation**: `applicationContext.xml` is generated at startup from `resources/applicationContext.fmt` template
- **Location**: Generated file stored in `${collectEarth.userFolder}/generated/applicationContext.xml`
- **Web Config**: `WEB-INF/web.xml` and `WEB-INF/dispatcher-servlet.xml` configure servlets, filters, and Spring MVC
- **Database Injection**: Freemarker templates inject database configuration (PostgreSQL or SQLite connection details)

## Database Layer

The application supports dual database configurations with automatic fallback:

- **Primary**: PostgreSQL (configurable via `LocalPropertiesService`: host, port, dbname, username, password)
- **Fallback**: SQLite (automatic if PostgreSQL unreachable)
- **Connection Test**: `ServerController.isPostgreSQLReachable()` checks connectivity before server start
- **Multiple Databases**: Main DB + Saiku analysis DB + IPCC analysis DB (for SQLite, suffixes added to filename)

Database configuration stored in: `${collectEarth.userFolder}/earth.properties`

## Key Configuration Properties

Managed by `LocalPropertiesService`:
- `UI_LANGUAGE`: Application language (en, es, fr, pt, vi, hi, lo, mn, tr)
- `SURVEY_NAME`: Current survey identifier
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`: PostgreSQL connection
- `COLLECT_DB_DRIVER`: "postgresql" or "sqlite"
- `OPERATOR`: Current user name
- `HOST`, `PORT`: Server network configuration (default: localhost:8028)
- `MODEL_VERSION_NAME`: Selected survey version

## Important Entry Points and Classes

| Class | Location | Purpose |
|-------|----------|---------|
| `EarthApp` | collect-earth-app/.../desktop | Main entry point, application launcher |
| `ServerController` | collect-earth-app/.../server | Jetty lifecycle, Spring context, DB connection |
| `EarthSurveyService` | collect-earth-app/.../service | Survey data management (extends core's `AbstractEarthSurveyService`) |
| `PlacemarkDataController` | collect-earth-app/.../server | Spring MVC controller for placemark HTTP endpoints |
| `KmlGeneratorService` | collect-earth-app/.../service | Orchestrates KML file generation |
| `LocalPropertiesService` | collect-earth-app/.../service | Configuration singleton |
| `AbstractEarthSurveyService` | collect-earth-core/.../service | Core survey operations (save, validate, load records) |
| `KmlGenerator` | collect-earth-sampler/.../processor | Abstract base for plot shape generators |

## Running from IDE (Eclipse)

1. Import as Maven project: File → Import → Maven → Existing Maven Projects
2. Select root `collect-earth` directory
3. Create Run Configuration:
   - Type: Java Application
   - Project: `collect-earth-app`
   - Main class: `org.openforis.collect.earth.app.desktop.EarthApp`
4. Run the configuration

## Localization

The application supports 9 languages through resource bundles:
- Location: `collect-earth-app/src/main/resources/org/openforis/collect/earth/app/view/Messages*.properties`
- Access pattern: `Messages.getString("key")`
- Supported languages: English (en), Spanish (es), French (fr), Portuguese (pt), Vietnamese (vi), Hindi (hi), Lao (lo), Mongolian (mn), Turkish (tr)

## Common Development Patterns

### Adding a New KML Plot Shape
1. Create subclass of `KmlGenerator` in `collect-earth-sampler/.../processor`
2. Implement `generatePoints()` method with geometric logic
3. Use `GeoUtils` for coordinate transformations
4. Add shape option to UI in `collect-earth-app/.../view`

### Adding a New Attribute Handler
1. Create class implementing appropriate handler interface in `collect-earth-core/.../handlers`
2. Register in Spring configuration
3. Update balloon template in `collect-earth-app/src/main/resources/templates`

### Adding a New Export Format
1. Create exporter class in `collect-earth-app/.../service`
2. Add UI trigger in `collect-earth-app/.../view`
3. Use `RecordManager` from Collect framework to access data

## Logging and Error Tracking

- **Log4j2 Configuration**: `collect-earth-app/src/main/resources/log4j2.xml`
- **Log File Location**: `${collectEarth.userFolder}/earth_error.log` (rolling file appender)
- **Error Tracking**: Sentry integration for crash reports (DSN configured in code)
- **Analytics**: Google Analytics integration via `GALogger` for usage tracking

## Dependencies and Version Management

Key dependencies are managed in parent `pom.xml`:
- Java release: 11 (`java.release` in the root `pom.xml`, compiled with `<release>` so it is checked against the real Java 11 API)
- Spring: 5.3.27
- Collect Framework: 4.0.109 (provides survey schema and record management)
- GeoTools: 24.4 (geospatial operations)
- Jetty: 9.4.58 (embedded server)
- Jackson: 2.18.9 (JSON processing) — set in BOTH the root `pom.xml` and `collect-earth-sampler/pom.xml`, which declares its own `jackson.version`; bump the two together
- Freemarker: 2.3.34 (template engine)

Maven enforces minimum version 3.9.3.

## Web Server Details

- **Port**: 8028 (configurable via properties)
- **Server**: Embedded Jetty 9.4.58
- **Context Path**: `/`
- **Key Endpoints**:
  - `/saveData` - Save placemark data (POST)
  - `/updateData` - Update existing placemark (POST)
  - Static resources served from webapp directory

## License

MIT License - See LICENSE file for details. Part of the Open Foris initiative (www.openforis.org).
