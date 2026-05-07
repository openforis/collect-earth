# Module Guidelines: collect-earth-installer

## Scope

This module builds platform installers and updater metadata. Treat it as release-sensitive. Follow the root `AGENTS.md` for general repository guidance.

## Structure

- Installer resources: `src/main/resources`
- Main InstallBuilder definitions: `CollectEarthWithSaiku.xml`, `CollectEarthUpdater.xml`, and `CollectEarthMain.xml`
- Update metadata: `collectEarthUpdateJRE11.xml`, `collectEarthUpdateMvn.xml`, and `update.ini`
- Installer and launcher images: `*.ico`, `*.icns`, `*.png`, and `of-logo.svg`

## Build

- `mvn -pl collect-earth-installer -Passembly package`: generates installer artifacts.

This command requires local Maven settings with InstallBuilder paths, output directories, and release credentials. Do not expect it to work in a fresh checkout without local configuration.

## Change Guidance

Do not commit real credentials, API keys, local filesystem paths, or generated installer binaries. Keep placeholder tokens such as `PROJECT_VERSION`, `GOOGLE_MAPS_API_KEY`, and `PLANET_MAPS_CE_KEY` intact unless intentionally changing the replacement flow. For installer changes, verify at least one platform build or document why it was not run.
