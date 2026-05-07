# Module Guidelines: collect-earth-grid

## Scope

This module contains global grid generation code and database resources. It has its own `pom.xml`, but it is not listed in the current root Maven reactor modules. Follow the root `AGENTS.md` where applicable.

## Structure

- Java sources: `src/main/java/org/openforis/collect/earth`
- Resources: `src/main/resources`
- Database setup files: `createTable.sql` and `createTableSqlite.sql`
- Hibernate configuration: `hibernate.cfg.xml`

## Build and Test

- `mvn -f collect-earth-grid/pom.xml test`: builds and tests this standalone module from the repository root.
- `mvn -f collect-earth-grid/pom.xml package`: packages the grid artifact.

Check parent-version compatibility before building; this module may lag behind the root project version.

## Change Guidance

Keep database changes synchronized between PostgreSQL and SQLite scripts where behavior should match. Avoid embedding credentials or environment-specific connection details in `hibernate.cfg.xml`. For grid generation changes, document input assumptions and validate output against a small sample dataset when possible.
