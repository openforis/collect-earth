# Explorer Configuration: Dashboard Editor and Desktop Pass-through Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A coordinator sets up a survey's Explorer in the cloud dashboard (layers, charts, their parameters), and Collect Earth passes that configuration to the Explorer for every plot.

**Architecture:** The configuration is one JSON document stored as the project property `explorer_config` in `project_definition.properties`, next to `open_gee_app`. The dashboard's Imagery card edits it through the existing `PUT /v1/projects/:pid/imagery` route, building its form from the Explorer's public catalogue (`GET /api/catalogue`). Collect Earth already syncs the imagery properties (`CloudCoordinatorSettings`); it appends the property to the address `BrowserService.geeAppUrl` builds. Neither the cloud server nor the desktop interprets the document; the Explorer does.

**Tech Stack:** Explorer: Node 22 Express + `node:test`. Cloud: Fastify + TypeScript + vitest; dashboard React + MUI + vitest. Desktop: Java 11, JUnit 5, Maven.

**Background to read first**
- `collect-earth-explorer/docs/plans/2026-11-16-explorer-customization-design.md` (the document format, fallbacks, amendments) and `collect-earth-explorer/README.md` "Customizing per survey".
- `collect-earth-explorer/functions/catalogue.json`: the types, parameters (`type`: `choice`, `int`, `date`, `year`, `yearRange`, `bool`, `text`, `formula`), defaults, `indices`, `bands`, `standard`.
- `collect-earth-cloud/CLAUDE.md`; `collect-earth-cloud/src/imagery.ts`; `collect-earth-cloud/web/src/project/ImageryCard.tsx` and `imageryView.ts`.
- Desktop: `BrowserService.geeAppUrl` and `openGEEAppURL`, `SettingsModel.imagery()`, `CloudCoordinatorSettings`, `LocalPropertiesService.EarthProperty`.

**Rules for every task**
- TDD: failing test, see it fail, implement, see it pass, one commit per task. Commit messages in the repo's style (a plain sentence saying what changed for the user).
- All files keep their line endings (LF in the Explorer and the cloud; check `git diff --stat` shows no whole-file rewrites). `.properties` files: mind the encoding gotchas recorded in the project memory.
- UI texts in all five languages: en, es, fr, pt, tr (Turkish glossary in the project memory). Stale translations are not caught by tests, so check each language by hand.
- No deploy, no push, no release without the user asking.

**Order:** Part A (Explorer, one small task) → Part B (cloud server and dashboard) → Part C (desktop). B and C are independent of each other; A must be deployed before B is usable against the live Explorer.

---

## Part A: Explorer

### Task A1: The catalogue answers any origin

The dashboard runs on other origins (the hosted cloud server, self-hosted servers, `localhost:5173`), and the Explorer's CORS allowlist only names its own hosts. The catalogue is public and read-only.

**Files:** `collect-earth-explorer/functions/routes.js`, `functions/test/routes.test.js` (or `test/app.test.js`, where the CORS tests are).

1. Test: `GET /api/catalogue` with `Origin: https://anything.example` answers 200 with `Access-Control-Allow-Origin: *`; a data endpoint (`POST /api/tiles/sentinel2`) with that origin still gets no CORS header.
2. Run `node --test functions/test/routes.test.js`: FAIL.
3. Implement: in the catalogue handler, `res.set("Access-Control-Allow-Origin", "*")` before `res.json`. Check the app-level CORS middleware in `functions/app.js` does not override or duplicate the header for this route (read it; adjust the route, not the allowlist).
4. `npm --prefix functions test`: all pass.
5. Commit `collect-earth-explorer: the catalogue can be read from any origin`.

---

## Part B: Cloud server and dashboard (`collect-earth-cloud/`)

### Task B1: The server stores `explorer_config`

**Files:** `src/imagery.ts`, `test/imagery.test.ts`.

1. Tests in `test/imagery.test.ts`:
   - `explorer_config` is an imagery key: `imageryOf` returns it; `checkImagery` accepts `''` (reset) and `'{"v":1,"layers":[{"type":"landsat"}]}'`.
   - Refused with a reason: not JSON; JSON that is not an object (`[]`, `"x"`, `null`, `5`); `v` present and not `1`; `layers` or `charts` present and not an array; longer than 2,000 characters; control characters.
   - The stored value is the compact form (`JSON.stringify(JSON.parse(value))`), so spacing typed by a client does not count against the limit or change the file needlessly.
   - `rewriteProperties` round trip: a document with a label containing `ç`, `=`, `:`, `\` and a formula containing `+ - * /` is written and read back identical (extend the existing escape test).
   - Route test: `PUT /v1/projects/:pid/imagery` with `explorer_config` answers it back; a collector (non-coordinator) is refused as for the other keys.
2. `npx vitest run test/imagery.test.ts`: FAIL.
3. Implement in `src/imagery.ts`: add `'explorer_config'` to `IMAGERY_KEYS`; in `checkImagery` a branch for it with the rules above (`EXPLORER_CONFIG_MAX = 2000`). The server checks shape only: it does not know the catalogue, and the Explorer skips what it does not understand.
4. `npm test && npm run typecheck`: pass.
5. Commit `Imagery settings: the Explorer's configuration of a project`.

### Task B2: The document as a form model (pure functions)

**Files:** create `web/src/project/explorerConfig.ts` and `web/src/project/explorerConfig.test.ts`.

Types: `Catalogue` (the JSON's shape), `Entry = { type: string; params: Record<string, unknown> }`, `Doc = { layers: Entry[]; charts: Entry[] }`.

Functions and their tests:
- `parseDoc(stored: string, catalogue): { doc: Doc; unknown: boolean }`: `''` or unreadable gives the catalogue's `standard` (params empty); a missing half gives the standard half; entries keep only what was stored (defaults are not filled in here); `unknown` is true when the stored text has an entry type or parameter the catalogue lacks, so the editor can warn before overwriting it.
- `serialiseDoc(doc, catalogue): string`: compact JSON `{"v":1,"layers":[…],"charts":[…]}` with parameters equal to their catalogue default left out, empty strings left out; returns `''` when the result equals the standard configuration (so an untouched or reset editor stores nothing).
- `entryErrors(kind, entry, catalogue, thisYear): Record<paramName, MessageKey>`: the catalogue's rules per parameter type (range for `int`, real date for `date`, year bounds, `yearRange` from ≤ to, `text` length and no `<` `>`, `formula` length); the cross-field rules of the Explorer: Sentinel-2 `start` and `end` together, start before end, at most 1,096 days; `formula` excludes a non-default `index`; Sentinel-2 `year`/`years` exclude `start`/`end` (if that feature is in the catalogue: check `functions/catalogue.json` at implementation time).
- `docSize(doc, catalogue): number` (length of the serialised text) and `EXPLORER_CONFIG_MAX = 2000`.
- `previewUrl(base, doc, catalogue, samplePlot)`: `${base}/?geoJson=<encoded point>&plot_id=Preview&config=<encodeURIComponent(serialised)>`; without `config` when the serialised text is `''`.
- `move(list, index, delta)`, `remove(list, index)`, `add(list, type)` helpers, each returning a new array.

Round-trip test: for a document using every parameter type, `parseDoc(serialiseDoc(doc))` equals `doc`. Formula syntax is not checked here: the Explorer is the authority, and Preview shows its notice.

Steps: tests, `cd web && npx vitest run src/project/explorerConfig.test.ts` FAIL, implement, pass, commit `Dashboard: the Explorer configuration as a form model`.

### Task B3: Loading the catalogue

**Files:** `web/src/api/explorer.ts` (new), `web/src/project/imageryView.ts` (add `explorer_config` to `KEYS`), tests beside them; `web/vite.config.ts` or env docs if a variable is added.

- `EXPLORER_URL`: `import.meta.env.VITE_EXPLORER_URL ?? "https://collectearth.web.app"` (change the default to `https://explorer.collectearth.org` once that domain serves the Explorer). Document the variable in `DEPLOY.md` and `SELF-HOSTING.md` (one line each): a self-hosted server can point at its own Explorer.
- `getCatalogue(): Promise<Catalogue>`: `fetch(`${EXPLORER_URL}/api/catalogue`)`, plain GET, no credentials, 10 s timeout; rejects on a non-200 or a body without `layers`, `charts` and `standard`.
- Check the server sends no Content-Security-Policy that blocks the request (none was found in `src/` when this plan was written; if one exists, add the Explorer origin to `connect-src`).
- Test with a mocked `fetch`: success, HTTP error, malformed body.

Commit `Dashboard: reads the Explorer's catalogue`.

### Task B4: The Explorer section of the Imagery card

**Files:** create `web/src/project/ExplorerSection.tsx`; modify `web/src/project/ImageryCard.tsx`, `web/src/i18n.ts`; component tests if the folder has them for cards (follow what exists for `ImageryCard`; otherwise the logic is covered by B2).

Behaviour:
- Shown inside the Imagery form only when `open_gee_app` is on, under the two date fields. Heading "Explorer window" with one explaining line.
- Loads the catalogue with `useLoad`. While loading: the usual `Loading`. On failure: an info alert "The Explorer could not be reached; its settings are unchanged." and nothing else; the stored `explorer_config` is not touched and Save still works for the other fields.
- Two lists, "Imagery layers" and "Charts". Each row is a small card:
  - a type select (the catalogue's types for that half; label from i18n `file.explorer.type.<type>`, falling back to the catalogue's `title`);
  - one field per catalogue parameter of that type, generated from the spec: `choice` → select, `int` → number field with min and max, `date` → date field, `year` → number field, `yearRange` → two number fields, `bool` → switch, `text` → text field, `formula` → text field (monospace, full width) with the helper text listing the bands of `catalogue.bands[type]` and the allowed functions. Labels from i18n `file.explorer.param.<name>`, falling back to the parameter name. Parameters at their default show the default as placeholder or selected value and are not stored;
  - up, down and remove icon buttons with accessible names ("Move up", "Move down", "Remove").
- "Add layer" and "Add chart" buttons (a menu of types). A type may be added more than once.
- Under the lists: "Preview" (opens `previewUrl` in a new tab; uses the project's first plot's location if an existing API gives it cheaply, otherwise a fixed sample point: decide at implementation, do not add an endpoint for it), "Reset to standard" (sets the document to the standard; Save then stores `''`), and a size line shown only above 1,500 characters ("1,620 of 2,000 characters").
- Errors from `entryErrors` show on their fields; any error, or a size above the limit, disables the card's Save (the form's `errors` object gains an `explorer_config` entry).
- If `parseDoc` reported `unknown`, a warning: "This project's Explorer settings contain items this dashboard does not know. Saving will remove them."
- The section's value joins the form's `values` as `explorer_config` (the serialised text), so the existing `imageryChanges` and `setImagery` send it with the other changes; nothing new in the save path.
- The card's fold line (`on.join(" · ")`) is unchanged.

i18n keys (en, then es, fr, pt, tr): section title and explanation, list titles, add/remove/move/preview/reset, the unreachable and unknown-items alerts, the size line, one `file.explorer.type.*` per catalogue type (6), one `file.explorer.param.*` per parameter (`label`, `start`, `end`, `bands`, `maxCloud`, `years`, `year`, `band`, `index`, `formula`, `name`, `collapsed`), choice labels for `bands` (`false-colour`, `true-colour`), and one message per error in `entryErrors`.

Steps: write the component against B2's functions; run `npm test`, `npm run build` in `web/`; run the dashboard (`npm run dev` at the root and in `web/`) and check by hand with a browser: add, reorder, remove, each field type, an error, the size limit, Preview, Reset, Save, reload, the unreachable case (block the request), a narrow window, and each language. Use the chrome-devtools tools for screenshots. Commit `Dashboard: set up a project's Explorer window on the Imagery card`.

### Task B5: Documentation

`README.md` (the imagery route's keys), `DEPLOY.md` and `SELF-HOSTING.md` (`VITE_EXPLORER_URL`), and the website guide if it describes the Imagery card (`ce-site` worktree, branch `gh-pages`: only with the user's go-ahead). Commit.

---

## Part C: Desktop (`collect-earth/`)

### Task C1: `explorer_config` is a coordinator's imagery setting

**Files:** `collect-earth-core/.../LocalPropertiesService.java` (`EarthProperty`), `collect-earth-app/.../service/settings/SettingsModel.java`, `SettingsValidator.java`, the message bundles of the five languages, `CloudCoordinatorSettingsTest.java`, the settings tests.

1. Tests: `CloudCoordinatorSettings.coordinatorsProperties(SettingsModel.IMAGERY)` contains `EXPLORER_CONFIG`; a fetched `explorer_config` differing from the local one is written to the properties (follow the existing test for `OPEN_GEE_APP`); the validator accepts blank and a JSON object up to 2,000 characters and refuses other text.
2. Implement: `EXPLORER_CONFIG("explorer_config")` in `EarthProperty`; in `SettingsModel.imagery()` a `Setting.text(EarthProperty.EXPLORER_CONFIG, "SettingsPage.explorerConfig")` with a tooltip, `visibleWhen(GEE_APP)`, placed after the two Earth Engine dates. It must be in the imagery section, because `coordinatorsSection` is what makes `CloudCoordinatorSettings` sync it. Label: "Explorer window settings (set on the dashboard)"; tooltip: what it is and that a cloud project's coordinator sets it. Messages in en, es, fr, pt, tr.
3. Check `describeImagery` in `CloudCoordinatorSettings` (the notice shown when the coordinator changes settings) reads sensibly when only this property changed; add a short phrase if it would otherwise say nothing.
4. `mvn -pl collect-earth-app -am test -Dtest=CloudCoordinatorSettingsTest,Settings*Test` (see the project memory for the exact build commands): pass.
5. Commit.

Not verified when this plan was written: whether a project file's `explorer_config` (a survey that is not a cloud project) reaches the local properties when the project is loaded, as its other properties do. Check it in this task; if it does, file-based surveys are covered with no more work, and say so in the commit message.

### Task C2: Collect Earth passes the configuration to the Explorer

**Files:** `collect-earth-app/.../service/BrowserService.java`, `AuxiliaryWindowUrlTest.java`.

1. Tests in `AuxiliaryWindowUrlTest`:
   - `geeAppUrl(base, plot, id, survey, from, to, config)` with a document ends with `config=<encoded>;` and the decoded value equals the document;
   - spaces are encoded as `%20`, never `+` (the Explorer decodes with `decodeURIComponent`, which leaves `+` as a plus sign): a label `"Dry season"` and a formula `"(nir - red) / (nir + red)"` survive a round trip through `URLDecoder` and through a `%20`-only decoder;
   - a blank or null configuration adds no `config` pair, and the two existing tests keep passing unchanged in meaning (they gain the extra argument).
2. Implement: a seventh parameter `String config`; when not blank, `url.append("config=").append(URLEncoder.encode(config.trim(), UTF_8).replace("+", "%20")).append(";")`. `openGEEAppURL` passes `localPropertiesService.getValue(EarthProperty.EXPLORER_CONFIG)`. The old Earth Engine app ignores a pair it does not know, so this is safe before the address changes.
3. Run the test class; then the wider browser tests named in the project memory.
4. Commit.

### Task C3: Collect Earth opens the Explorer instead of the Earth Engine app

**Decision needed from the user before this task:** which address, and when. `gee_app_url` is set in `collect-earth-installer/src/main/resources/earth.properties_initial` (new installs) and `earth.properties_forced_update` (written over every user's setting on update). Changing both moves every user to the Explorer with the release, so the Explorer must be ready for that load (Earth Engine quota of the `collectearth` project, the function's instance limits) and the chosen domain must be live (`https://explorer.collectearth.org/` needs its DNS record; `https://collectearth.web.app/` works today).

1. Change `gee_app_url` in both files to the chosen address.
2. `BidiTabDriverIT` and any test or fixture naming the old address: update only where they assert the default.
3. Check by hand with the unattended launch described in the project memory: open a plot, confirm the Explorer tab shows the plot, its id and the survey's dates; open a second plot and confirm the tab changes (the Explorer reloads on a fragment-only navigation); in a cloud project with a configuration on the dashboard, confirm the layers and charts follow it after the next sync.
4. The settings labels that say "Google Earth Engine app" (desktop bundles, dashboard `file.imagery.open_gee_app`): rename to "Collect Earth Explorer" in the five languages, here and in the dashboard, in one commit each.
5. Commit; note the change for the release notes.

---

## Done criteria

- A coordinator changes layers and charts on the dashboard, saves, and a collector's Collect Earth shows them in the Explorer after its next sync, with no JSON seen by anyone.
- A project that never opened the section stores no `explorer_config` and gets the standard Explorer.
- An unreachable Explorer never loses a stored configuration.
- Older Collect Earth versions and the old Earth Engine app are unaffected by the new property.

## Open points

- Formula syntax is checked only by the Explorer (Preview shows its notice). A check endpoint on the Explorer could be added if coordinators stumble on it.
- The preview plot: the project's own first plot would be better than a fixed sample point if an existing API offers one.
- A file-based (non-cloud) editor for `explorer_config` in Collect Earth's own Settings page beyond the raw text field of Task C1.
