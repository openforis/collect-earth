# Module Guidelines: collect-earth-core

## Scope

This module contains shared domain logic and services used by the application and sampler modules. Follow the root `AGENTS.md` for general build, style, and pull request expectations.

## Structure

- Java sources: `src/main/java/org/openforis/collect/earth`
- Maven artifact: `collect-earth-core`
- External Open Foris dependencies are managed through the root `pom.xml`.

## Build and Test

- `mvn -pl collect-earth-core -am test`: compiles this module and runs any tests added here.
- `mvn -pl collect-earth-core -am package`: builds the module with upstream reactor dependencies.

Add new tests under `src/test/java` when introducing reusable logic or fixing regressions.

## Change Guidance

Keep this module independent from desktop UI concerns. Do not add Swing, installer, or application-launch behavior here. Preserve Java 8 compatibility and use existing package boundaries when adding services or utilities. Public methods used by other modules should remain stable unless the dependent modules are updated in the same change.
