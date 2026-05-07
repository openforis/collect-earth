# Module Guidelines: collect-earth-sampler

## Scope

This module owns sampling and geospatial helper behavior used by Collect Earth. It depends on `collect-earth-core` and geospatial libraries such as GeoTools. Follow the root `AGENTS.md` for shared repository rules.

## Structure

- Java sources: `src/main/java/org/openforis/collect/earth/sampler`
- Maven artifact: `collect-earth-sampler`
- GeoTools repository configuration is declared in this module's `pom.xml`.

## Build and Test

- `mvn -pl collect-earth-sampler -am test`: compiles the sampler and runs available tests.
- `mvn -pl collect-earth-sampler -am package`: packages the sampler and required reactor modules.

For geometry, projection, KML, GeoJSON, or coordinate-related changes, add focused tests under `src/test/java` when practical and include representative input data in test resources.

## Change Guidance

Be careful with dependency upgrades in this module; geospatial libraries often bring transitive dependency conflicts. Keep sampling logic free of desktop UI assumptions. Prefer structured geometry and JSON APIs already in the dependency set over manual string construction.
