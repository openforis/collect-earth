# Web Balloon (balloon_web.html) — Design

**Date:** 2026-07-22 · **Status:** validated with product owner · **Branch:** feature/gew-viewer

## Purpose

The Leaflet map's form panel currently reuses the legacy balloon HTML, which was
built for Google Earth Pro's balloon runtime ($[next_id] balloonFlyTo, resize hacks,
2014-era jQuery/steps stack). This design introduces a second, modern form inside the
CEP — `balloon_web.html` — used by the Leaflet viewer, while `balloon.html` stays
untouched for GEP. The demo CEP (`collect-earth-app/resources/demo_survey.cep`) is
the reference adaptation. The Collect Earth server API is unchanged; the wire
protocol (collect_* field naming, ===-joined multivalues) is preserved exactly.

## Decisions (from brainstorming)

- **Stack:** Bootstrap 5.3 + vanilla ES6 (no jQuery), vendored into the CEP under
  `webFiles/`. Native date inputs (drops moment/datetimepicker), styled selects
  (drops selectBoxIt), hand-rolled nav-pills stepper (drops jquery-steps).
  Beautify: typography scale, card sections, Open Foris/FAO banner, smooth step
  transitions, status colors consistent with the map (red/yellow/green).
- **Selection:** new optional `project_definition.properties` key
  `balloon_web=${project_path}/balloon_web.html` (mirrors the `balloon` key).
  Missing key → legacy balloon served (old CEPs degrade gracefully).
- **After save:** auto-advance — the form postMessages the map, which flies to the
  next unfinished plot (replaces GEP `window.open("#"+NEXT_ID+";flyto")`).

## Components

1. **Java plumbing**
   - `EarthProjectsService`: parse `balloon_web` key on CEP import, store as new
     `EarthProperty` (e.g. `BALLOON_TEMPLATE_KEY_WEB` / `balloon_web`).
   - `BalloonServlet`: `web=true` request param → serve the web balloon file when
     the property is set (same `$[...]` substitution; extend the asset path rewrite
     to `webFiles/` → `generated/webFiles/`; ensure webFiles is copied like
     earthFiles). Fallback to legacy balloon when property absent.
   - Leaflet `map.js`: iframe URL gains `&web=true`; postMessage listener.
2. **`balloon_web.html`** (in CEP): header bar (plot id badge, operator, save-state
   pill), nav-pills stepper over fieldsets (Plot info → Land use →
   Topography/Human impact → Remote sensing → Review & submit), per-step error
   badges, free step navigation, `collect_*` input names identical to legacy,
   hierarchical code-list repopulation, file-level localization + Lao font-face.
   Tokens used: `$[host]` + id/key tokens + per-plot ExtendedData values only.
3. **`earth_web.js`** (in CEP `webFiles/`): load via `/placemark-info-expanded`;
   debounced (~1s) autosave POST `/save-data-expanded` with
   `collect_boolean_actively_saved=false` (yellow); Submit posts `true` (green);
   server validation rendered as Bootstrap `is-invalid` + step badges; unreachable
   server → retry banner. No client-side validation rules (server is truth).
4. **Form ↔ map messages** (same-origin postMessage):
   - `{type:"ce:saved", plotId, status}` → map recolors green immediately +
     auto-advances to next unfinished plot.
   - `{type:"ce:dirty", plotId}` → map flips plot yellow instantly.
   - Map ignores messages whose plotId ≠ active plot (stale iframe race).
5. **Edge cases**: already-filled plot → read-only summary + "Edit anyway";
   `earth_skip_filled` subsumed by map's only-pending + auto-advance; no resize
   hacks (responsive panel).

## Verification

- Protocol parity: same plot filled via legacy balloon (GEP) and web form must
  produce field-identical records (export + diff).
- E2E Leaflet: edit → yellow ≤5s; valid submit → green + auto-advance; invalid
  submit → field errors + step badges, no advance; saved plot → summary state.
- Old CEP without `balloon_web` → legacy balloon in panel. GEP regression: same
  CEP in GEP mode uses balloon.html untouched.
