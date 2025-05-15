# Collect Earth Development Guidelines

## Build Commands
- Build project: `mvn clean install`
- Run application: `java -jar target/CollectEarth.jar`
- Generate JavaDoc: `mvn javadoc:javadoc`
- Create release: `mvn release:prepare release:perform`

## Code Style Guidelines
- **Naming**: Use camelCase for methods/variables, PascalCase for classes
- **Imports**: Organize by package hierarchy, avoid wildcard imports
- **Exception Handling**: Use specific catch blocks, log errors with SLF4J logger
- **Logging**: Use SLF4J with appropriate log levels (error, warn, info, debug)
- **UI**: Use SwingUtilities.invokeLater() for UI updates from background threads
- **Comments**: JavaDoc for public methods and classes
- **Internationalization**: Use Messages.getString() for UI text

## Project Structure
- src/main/java: Application code
- src/main/resources: Configuration files, templates, static resources
- resources/: External resources (templates, scripts, etc.)

## Error Handling
- Log errors with appropriate context
- Use try-with-resources for closeable resources
- Handle UI errors with user-friendly messages