# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

### Basic Build and Run
- Build the project: `mvn clean install`
- Run the application: `java -jar collect-earth-app/target/CollectEarth.jar`
- Run the application from Eclipse: Create a Java Application run configuration with main class `org.openforis.collect.earth.app.desktop.EarthApp`

### Development Tasks
- Clean and compile: `mvn clean compile`
- Run tests: `mvn test`
- Generate JavaDoc: `mvn javadoc:javadoc`

### Release Management
- Prepare a release: `mvn -Passembly release:clean release:prepare`
- Perform the release: `mvn -Passembly release:perform`
- Rollback a release (if prepare fails): `mvn release:rollback`
- Resume release (if perform fails): `mvn release:perform -rf:collect-earth-installer`

## Project Architecture

### Core Components

1. **Desktop Application**
   - Entry point: `org.openforis.collect.earth.app.desktop.EarthApp`
   - Main window: the web pages of `src/main/frontend` (the plots map, or the home page with the Google Earth Pro viewer), opened in the browser Collect Earth drives; a tray icon (`desktop.AppShell`) opens them again or quits
   - The pages call the JSON API of `org.openforis.collect.earth.app.server.api`; see `docs/plans/2026-10-28-html-ui-design.md`

2. **Embedded Web Server** (Jetty)
   - Managed by: `org.openforis.collect.earth.app.desktop.ServerController`
   - Serves web-based forms and handles data collection
   - Provides REST API endpoints for data exchange

3. **Data Model**
   - Survey definition and management
   - Attribute handlers in `org.openforis.collect.earth.core.handlers`
   - Data storage in SQLite or PostgreSQL

4. **Integration Components**
   - Google Earth integration via KML/KMZ files
   - Web browser integration for forms
   - Saiku integration for data analysis

### Key Services

1. **LocalPropertiesService**: Manages application configuration and settings
2. **EarthSurveyService**: Handles survey definitions and data
3. **KmlGeneratorService**: Creates KML/KMZ files for Google Earth visualization
4. **DataImportExportService**: Manages import/export of data in various formats
5. **BrowserService**: Handles browser integration for forms
6. **IPCCGeneratorService**: Specialized processing for climate change reporting

### Data Flow

1. Application starts and initializes components:
   - EarthApp initializes UI and ServerController
   - ServerController starts Jetty with Spring MVC
   - KML files generated for visualization in Google Earth

2. Data collection process:
   - User clicks a placemark in Google Earth
   - Form opens in browser or Google Earth balloon
   - User inputs data via form
   - Data sent to server via HTTP and saved to database
   - UI updated to reflect saved state

3. Data analysis:
   - Data exported to various formats (CSV, KML, etc.)
   - Integration with Saiku for data analysis
   - IPCC-specific processing for reporting

## Project Structure

- **collect-earth-app**: Main application module
  - Web UI (`src/main/frontend`) and its API, server controller, and service implementations
  - Entry point, configuration, and integration logic

- **collect-earth-core**: Core components and utilities
  - Data model, attribute handlers, and survey utilities
  - Common utilities shared across modules

- **collect-earth-sampler**: Sampling and point generation
  - Tools for generating sampling points
  - Coordinate calculation utilities

- **collect-earth-grid**: Grid and plot management
  - Grid generation and management
  - Plot data structures and storage

- **collect-earth-installer**: Installer packaging
  - InstallBuilder configuration
  - Packaging and distribution resources

## Code Style Guidelines

- **Naming**: Use camelCase for methods/variables, PascalCase for classes
- **Imports**: Organize by package hierarchy, avoid wildcard imports
- **Exception Handling**: Use specific catch blocks, log errors with SLF4J logger
- **Logging**: Use SLF4J with appropriate log levels (error, warn, info, debug)
- **UI**: The UI is the web pages; a long action is a job (`service.jobs.JobService`) the page follows, and a message for the user is a notice (`service.notices.NoticeService`), not a dialog
- **Comments**: JavaDoc for public methods and classes
- **Internationalization**: Use Messages.getString() for UI text