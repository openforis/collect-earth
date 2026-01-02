# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Collect Earth is a desktop application for augmented visual interpretation that integrates with Google Earth to enable data collection through satellite imagery. It's a Maven multi-module Java project that combines a Swing desktop UI with an embedded Jetty web server to communicate with Google Earth via dynamically generated KML files.

**Key Technologies**: Java 8, Spring 5.3.27, Jetty 9.4.58, GeoTools 24.4, Collect Framework 4.0.101

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
The project uses Maven Release Plugin with Bitrock InstallBuilder for creating installers:

```bash
# Prepare release (updates versions, creates git tags)
mvn release:clean release:prepare

# Rollback if preparation fails
mvn release:rollback

# Perform release (builds and deploys installers)
mvn release:perform

# Resume failed perform from specific module
mvn release:perform -rf:collect-earth-installer
```

Note: Requires Bitrock InstallBuilder and configured `maven_settings.xml` with installer paths and credentials.

## Module Architecture

The project is organized into 5 Maven modules with clear separation of concerns:

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

### 4. collect-earth-grid
Grid generation utilities for systematic global sampling. Contains implementations for creating systematic grids with different storage backends (Hibernate, JDBC, CSV).

### 5. collect-earth-installer
Packaging and installer generation using Bitrock InstallBuilder. Produces Windows .exe, Linux .run, and macOS .dmg installers with bundled JRE.

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
- Java version: 1.8
- Spring: 5.3.27
- Collect Framework: 4.0.101 (provides survey schema and record management)
- GeoTools: 24.4 (geospatial operations)
- Jetty: 9.4.58 (embedded server)
- Jackson: 2.15.2 (JSON processing)
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
