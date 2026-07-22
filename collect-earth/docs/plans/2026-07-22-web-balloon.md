# Web Balloon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven execution) task-by-task. Implementation subagents run on Opus.

**Goal:** A modern Bootstrap 5 data-entry form (`balloon_web.html`) inside the demo CEP, served to the Leaflet map's form panel instead of the GEP-era balloon, with autosave/submit protocol parity and save→auto-advance map integration.

**Architecture:** New optional CEP key `balloon_web` → new `EarthProperty` → `BalloonServlet` serves the web form when the Leaflet page requests `web=true`. The form is a pure client of the existing endpoints (`/placemark-info-expanded`, `/save-data-expanded`); postMessage links it to the map page. Legacy balloon and GEP path untouched.

**Tech Stack:** Java 8/Spring 5.3 (3 small server changes), Bootstrap 5.3 + vanilla ES6 (vendored in CEP `webFiles/`), demo CEP repackaged (zip).

**Design doc:** `docs/plans/2026-07-22-web-balloon-design.md` — read it first; it is the requirements contract.
**Branch:** `feature/gew-viewer`. Maven root: nested `collect-earth/`. Never `git add -A` (untracked .docx files at repo root).

**Reference extraction:** unzip `collect-earth-app/resources/demo_survey.cep` to a scratch folder; `balloon.html` in it is the source of truth for the survey's fields, steps, code lists and `$[...]` defaults; `earthFiles/js/earth_new.js` for the protocol behaviors being re-implemented.

---

### Task 1: `balloon_web` property plumbing (core)

**Files:**
- Modify: `collect-earth-core/src/main/java/org/openforis/collect/earth/app/service/LocalPropertiesService.java`

Steps:
1. Add enum constant `BALLOON_TEMPLATE_KEY_WEB("balloon_web")` next to `BALLOON_TEMPLATE_KEY("balloon")` (line ~45).
2. Add `getBalloonFileWeb()` next to `getBalloonFile()` (line ~152), same `convertToOSPath(getValue(...))` shape.
3. VERIFY how CEP import moves `project_definition.properties` keys into earth.properties: grep `EarthProjectsService` / `EarthProjectsService.loadCompressedProjectFile` for the bulk key copy. If keys are copied wholesale by matching property names, `balloon_web` needs nothing more; if there is an explicit whitelist, add the new key to it. Report which it was.
4. Compile core; commit `feat: balloon_web project property for the web form`.

### Task 2: BalloonServlet serves the web form

**Files:**
- Modify: `collect-earth-app/src/main/java/org/openforis/collect/earth/app/server/BalloonServlet.java`

Steps:
1. In `returnBalloon(...)` add `@RequestParam(value="web", required=false) Boolean web`. When `web == Boolean.TRUE`: use `localPropertiesService.getBalloonFileWeb()` if non-blank AND the file exists; else fall back to the legacy balloon file (old CEPs degrade gracefully).
2. Extend the asset path rewrite: alongside the existing `earthFiles/` → `generated/earthFiles/` replace, add `webFiles/` → `generated/webFiles/`.
3. Find where `earthFiles` is copied into the `generated/` folder that Jetty serves (`KmlGeneratorService`, around the `FOLDER_COPIED_TO_KMZ` handling / line ~540) and mirror it for a `webFiles` folder when it exists in the project directory (constant e.g. `FOLDER_WEB_FILES = "webFiles"` in `EarthConstants`). This must happen in ALL modes (the Leaflet mode skips nothing today — verify `generateKmlFile` runs in Leaflet mode; it does, per the final review of the previous feature).
4. Compile; commit `feat: BalloonServlet web=true variant + webFiles asset serving`.

### Task 3: map.js — web param + postMessage integration

**Files:**
- Modify: `collect-earth-app/src/main/resources/leafletmap/map.js`

Steps:
1. Form URL: append `&web=true` to the `/balloon?` iframe src.
2. Add a `window.addEventListener("message", ...)` handler:
   - Accept only events where `event.origin === window.location.origin`.
   - `{type:"ce:saved", plotId}`: if `plotId !== activeId` ignore; else `setStatus(plotId,"saved")` is wrong while active (active keeps cyan) — instead store `plots[plotId].status = "saved"`, update its list dot, then auto-advance by invoking the same logic as the "next-unfinished" button (factor that button's handler into a named function `goToNextUnfinished()` and call it).
   - `{type:"ce:dirty", plotId}`: if not active plot ignore; set `plots[plotId].status = "partial"` + list dot (map polygon color untouched while active/cyan).
3. `node --check` map.js; commit `feat: map auto-advance on web-form save (postMessage)`.

### Task 4: Author the web form into a CEP staging folder

**Files (staging, new):** `collect-earth-app/resources/demo_survey_web/` — staging dir committed to the repo so the form is reviewable as text; Task 5 zips it into the CEP.
- `balloon_web.html`
- `webFiles/bootstrap/bootstrap.min.css` + `bootstrap.bundle.min.js` (5.3.x, downloaded from jsdelivr/unpkg)
- `webFiles/css/earth_web.css`
- `webFiles/js/earth_web.js`
- `webFiles/img/` — copy the banner/logo images from the CEP's earthFiles/img

Authoring contract (from the design doc + legacy balloon.html):
- Recreate EVERY input of `balloon.html` with identical `name` attributes (`collect_text_id`, `collect_code_*`, `collect_entity_topography[N]_*`, multi-values `===`-joined on submit, `collect_boolean_actively_saved` hidden field, `EXTRA_ID_ATTRIBUTES = ['collect_text_id','collect_code_round']`). Cross-check the full input list by grepping `name="collect_` in the legacy balloon; the new form must submit a superset of none / subset of none — the SAME set.
- Steps as Bootstrap nav-pills fieldsets mirroring the legacy wizard sections; per-step error badges; free navigation; Review & submit step.
- `$[...]` tokens used: `$[host]` + the plot data tokens the legacy form uses for defaults (grep `\$\[` in balloon.html and keep the ones that are per-plot data, DROP `$[next_id]`).
- `earth_web.js`: load record via `GET {HOST}placemark-info-expanded?...` (same id params as legacy — check earth_new.js for the exact query construction); debounced 1s autosave POST (`actively_saved=false`); Submit → `actively_saved=true`; render server validation as `is-invalid` + feedback + step badges; header save-state pill; unreachable-server banner with retry; `parent.postMessage({type:"ce:saved"|"ce:dirty", plotId}, window.location.origin)`; already-filled → read-only summary + "Edit anyway".
- Beautify: card sections, typographic scale, Open Foris banner, smooth step transitions, status colors matching the map.
- Localization: keep file-level approach; Lao font-face block carried over.

Verify: `node --check` on earth_web.js; open balloon_web.html served via a quick static check is not possible without the server — rely on Task 6.
Commit `feat: modern Bootstrap 5 web form for demo survey (staging)`.

### Task 5: Repackage demo_survey.cep

Steps:
1. Script (PowerShell or python) that: extracts `collect-earth-app/resources/demo_survey.cep` to temp, adds `balloon_web.html` + `webFiles/` from the staging folder, adds the line `balloon_web=${project_path}/balloon_web.html` to `project_definition.properties`, re-zips PRESERVING the original entries and structure, replaces the .cep. Keep the script in `collect-earth-app/resources/demo_survey_web/repackage.ps1` so the cep can be rebuilt from staging any time.
2. Sanity: list the zip entries — original entries all present + the new ones; properties file contains both `balloon` and `balloon_web` lines.
3. Commit `feat: demo_survey.cep ships balloon_web.html for the Leaflet viewer`.

### Task 6: Build + acceptance

1. `mvn -q install "-DskipTests" "-Dgpg.skip=true"` → exit 0; `mvn test -pl collect-earth-app` → all pass.
2. Manual walk (user): re-import demo CEP → Leaflet mode → click plot → NEW form appears (Bootstrap 5) → edit → yellow ≤5s + pill state → invalid submit → field errors + step badges → valid submit → green + auto-advance to next unfinished → revisit saved plot → summary + Edit anyway. Old CEP (without balloon_web) → legacy form. GEP mode regression with same CEP.
3. Protocol parity check: fill one plot in GEP mode, one identical plot via web form; export both records and diff.

## Out of scope (YAGNI)
- Regenerating balloons for other surveys (demo CEP is the template; survey-designer generator support is a follow-up).
- Client-side validation rules (server remains the source of truth).
- RTL languages, dark mode.
