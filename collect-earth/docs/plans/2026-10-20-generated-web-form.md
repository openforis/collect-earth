# Web form generated from the survey — Design and plan

**Date:** 2026-10-20 · **Branch:** feature/gew-viewer · **Supersedes:** the hand-written `balloon_web.html` of
[2026-07-22-web-balloon-design.md](2026-07-22-web-balloon-design.md) (kept as the `web_form=balloon` fallback)

## Why

The form next to the plots map (and next to Google Earth Web) used to be the balloon HTML of the CEP. That HTML
is written by Collect's Survey Designer (`CollectEarthBalloonGenerator` in openforis/collect). It uses the 2014
Bootstrap 3 / jQuery-steps stack that Google Earth Pro's WebKit 538 can run, and its labels are fixed in one
language at export time. The `balloon_web.html` alternative had to be written by hand for every survey.

Collect Earth already loads the full survey (`placemark.idm.xml`). It validates every save and computes
relevance, calculated values and code list filtering on the server. A form can therefore be built at runtime
from what Collect Earth already knows, with no generated HTML in the CEP. It uses the same React + MUI stack as
the plots map.

## Architecture

```
 Collect Earth (Jetty, /earth)                          form.html (React + MUI, src/main/frontend/src/form)
 ─────────────────────────────                          ────────────────────────────────────────────────────
 GET /surveyForm  ── SurveyFormModelBuilder ──────────▶ tabs, fields, code lists (labels in the UI language)
 GET /surveyForm/plot?id= ── plot file row ──────────▶ keys, "from CSV" values, location, plot file
 GET /placemark-info-expanded?id=  (unchanged) ──────▶ values + relevance + errors of every field
 POST /save-data-expanded          (unchanged) ◀────── changed fields + plot values, partialUpdate
 POST /create-entity, /delete-entity (unchanged) ◀──── multiple entities
                                                        postMessage ce:dirty / ce:saved ──▶ plots map
```

- **`SurveyFormModelBuilder`** (collect-earth-app, `service`) walks the main UI form set the way Collect's
  generator does, so a survey looks the same in both.
  - One tab per form. Nested forms become tabs of their own, where the balloon dropped them.
  - The built-in, hidden, key and "from CSV" attributes are left out. Header attributes become info chips.
  - Single entities become groups. Enumerated multiple entities become tables.
  - A multiple-entity form becomes cards with Add / Delete.
  - Parameter names come from `BalloonInputFieldsUtils`, so nothing changes on the save side.
  - Each code field carries every item of its level, with `parentId`. The form shows the children of the
    parent's selection, including a calculated parent the server reports through `codeItemId`. It narrows
    them further with the server's `possibleCodedItems`.
- **`SurveyFormController`** serves the model, cached per survey, language and model version. It also serves
  each plot's file values, cached per CSV file and modification time. The KML gets these values as
  `$[EXTRA_...]`; the plots map's GeoJSON does not carry them.
- **The form** (`src/form/`):
  - `model.ts` holds the pure protocol logic (value formats, merges, hierarchy, errors) and is unit tested.
  - `store.ts` handles the server traffic.
  - `FormApp.tsx` and `fields.tsx` are the UI.
  - Saves are serialized, never aborted, because every partial answer carries the relevance of the fields it
    touched.
  - Typing is saved after 1.5 s or when the field is left. Clicks are saved at once.
  - **Submit** sends `partialUpdate=false`. The server answers with the whole form, so the verdict is the
    server's `activelySaved` (it keeps it only when the record is valid), and the error list covers every tab.
    This fixes the partial-answer verdict problem of the balloon.
- **Selection:** new property `web_form`, `generated` by default. With `balloon`, `/mapConfig` makes the plots
  map show the CEP balloon as before. Google Earth Pro is untouched.

## Phase 1 — done (this change)

- The endpoints, the model builder, the React form, the map wiring and the property.
- Supported:
  - every type the balloon saves: code as buttons or a searchable dropdown, single or multiple; boolean;
    integer and real with units and decimal comma; integer and real ranges; text; memo; date; time;
    coordinate;
  - read-only "show in CE" CSV fields and calculated fields;
  - hierarchical codes, groups, enumerated tables, multiple-entity forms.
- Form behaviour:
  - error badges on tabs, and the error list on Submit with links to each field;
  - the already-submitted notice, and the "Collect Earth not answering" state with Retry;
  - Ctrl+Enter submits; Alt+←/→ change tab;
  - dark mode; en/es/fr/pt UI texts.
- Tests:
  - `SurveyFormModelBuilderTest` (JUnit, against the IPCC `test_survey.idm.xml`);
  - `src/form/model.test.ts` (vitest);
  - an end-to-end Playwright run against a mock server driven by the real generated model (27 checks).

## Next phases

1. **Field trial on real projects.** This needs Collect Earth running with a database. Things to check:
   - the labels of `possibleCodedItems` and of server error messages follow `ui_language`;
   - the first save of a new plot from the plots map, on PostgreSQL and SQLite;
   - multi-key surveys (compound ids);
   - `collect_text_plot_file`.
2. **Close the gaps the balloon also has**, in collect-earth-core:
   - ~~Range attributes~~ — done: `RangeAttributeHandler` saves integer (`integer_range_`) and real
     (`real_range_`) ranges as `FROM-TO`, handlers are matched on their longest prefix, and the form shows
     From / To.
   - Qualifiable code items ("other, specify"): add the qualifier to the code parameter format.
   - Code item images: serve `earthFiles/img/code_list/...` from the project folder and show them in the item
     tooltip.
   - Nested entities deeper than one level, with a parameter format for them.
3. **Use the model for Google Earth Pro too.** Collect Earth could render the GEP balloon from the same model
   when it builds the KML, server-side and ES5-only per `BROWSER_CONSTRAINTS.md`. The CEP would then need no
   `balloon.html` at all, and a survey change would no longer require re-exporting the project. The Survey
   Designer's generator would stay only for old Collect Earth versions.
4. **Options UI.** Add `web_form` to the Properties dialog next to the viewer type, if operators need to switch
   back to the CEP balloon. Until then, it is a property in `earth.properties`.
5. **Collect Survey Designer preview.** Collect could render its Collect Earth preview from the same model JSON.
   That would mean moving `SurveyFormModelBuilder` to collect-earth-core, which Collect already depends on.

## Known limitations

- Survey labels are in the UI language when the survey has them, and otherwise in its default language. The
  server's validation messages follow `ui_language`, as for the balloon.
- The form trusts the server for relevance. Before the first answer, every field shows.
- `currentStep` is sent, but the server only echoes it for the last plot opened, so the form always opens on
  the first tab with something to fill in.
