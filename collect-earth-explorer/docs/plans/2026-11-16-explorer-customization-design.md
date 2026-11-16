# Explorer customization per survey: design

Date: 2026-11-16
Status: design agreed in brainstorming, implementation plan pending

## Goal

A Collect Earth survey decides what the Explorer shows for its plots: which imagery
layers, which charts, in what order, and with what parameters (years, date ranges,
indices, band combinations, cloud limit). A survey that chooses nothing gets the
standard Explorer.

## Decisions

1. **Cloud first, files later.** The first editor is the Collect Earth cloud
   dashboard. The customization is shaped so that it can live in a project file
   later without redesign.
2. **Catalogue and parameters.** The Explorer ships a catalogue of layer and chart
   types. A survey picks from it and sets parameters. No Earth Engine code or
   free-form dataset per survey.
3. **Delivered in the address.** The customization is one JSON document, stored as
   a project property and passed to the Explorer as a `config` URL parameter. The
   Explorer stays stateless and knows nothing about cloud servers.

Rejected: the Explorer fetching the document from the cloud server (needs a public
endpoint there, against per-project privacy, and a second mechanism for file
surveys); the Explorer storing documents itself (write API, authentication, state).

## The customization document

```json
{
  "v": 1,
  "layers": [
    { "type": "sentinel2", "label": "Sentinel-2, last 12 months" },
    { "type": "landsat", "years": [2000, 2024], "year": 2015, "bands": "false-colour" },
    { "type": "sentinel2", "label": "Dry season 2019", "start": "2019-06-01", "end": "2019-09-30" }
  ],
  "charts": [
    { "type": "ccdc", "band": "NDVI" },
    { "type": "landsat-series", "index": "NBR" },
    { "type": "modis", "index": "EVI", "collapsed": true }
  ]
}
```

- `layers`: the layers panel, in order; the first entry opens first. A type may
  appear several times with different parameters.
- `charts`: the chart cards, in order. A chart left out is not requested.
- Parameters are per type and optional; the catalogue holds the defaults.
- `v` allows the format to change.

### Standard configuration and fallbacks

The standard configuration is a document in this same format, kept in the Explorer
next to the catalogue. It equals today's Explorer (three layers, four charts).

| Situation | Result |
|---|---|
| No `config` in the address | Standard configuration |
| `config` cannot be parsed | Standard configuration, with a notice |
| Only `layers` or only `charts` given | The missing half is standard |
| An entry has an unknown type or a bad parameter | That entry is skipped, with a notice |
| No valid entry left in a half | That half is standard |

A survey that never customized stores nothing, so improvements to the standard
configuration reach it at once.

### Size

The address already carries the plot's `geoJson`. A typical document is 300 to 500
characters, about half as much again once URL-encoded. The dashboard refuses to
save a document over 2,000 characters, which keeps the whole address under about
4,000. Keys are short and defaults are omitted.

Not verified: how the desktop hands the address to the browser window (a Windows
command line would limit it to about 8,000 characters, still above the cap).

## Flow

1. **Dashboard** (`collect-earth-cloud`): the Imagery card gains an Explorer
   section. It loads the catalogue from the Explorer's `GET /api/catalogue` and
   offers layers and charts as lists to add to, reorder and remove from, with form
   fields for each entry's parameters. A project without a customization shows the
   standard configuration as the starting point. Save writes one project property,
   `explorer_config`, through the route the card already uses for `open_gee_app`.
   "Reset to standard" removes the property. "Preview" opens the Explorer on a
   sample plot with the draft in the address.
2. **Collect Earth** (desktop): it already receives project properties during
   sync. When it builds the Explorer address it appends `&config=<url-encoded
   value>`. It does not read the document.
3. **Explorer web**: parses `config`, applies the fallbacks above against the
   catalogue, and renders the layers panel and chart cards from the result.
4. **Explorer API**: each endpoint accepts the parameters the catalogue allows for
   its type and validates them itself (anyone can write an address). Parameters
   are part of the cache key, as the Landsat year is today. The API never receives
   the whole document.

## Changes inside the Explorer

- **Catalogue** (new, in `functions/lib/`, EE-free): each layer and chart type with
  its parameters, allowed values and defaults, plus the standard configuration.
  Used by the API for validation and served at `GET /api/catalogue`; the web app
  and the dashboard read it from there.
- **Web state** (`state/PlotContext.tsx`): the fixed `LayerId` names become the
  list of entries from the configuration. The active layer and the compare layer
  are entries. Clicking a chart point still loads a scene or a Landsat year.
- **Layers panel and chart area** (`LayersPanel`, `App.tsx`): render from the list.
  Each catalogue type maps to one existing component; the Landsat entry keeps its
  year slider, limited to the entry's years.
- **API** (`functions/routes.js`, `ee/*`): existing endpoints gain optional
  parameters (index, band combination, cloud limit, date range). The only new
  endpoint is the catalogue.

First catalogue: today's three layers and four charts with their new parameters.
New types (land-cover maps, Sentinel-1, …) follow one at a time, each as a
catalogue entry plus its Earth Engine function.

## Errors

- Bad parameters on an API call are a 400 from the endpoint's validator, before
  cache or Earth Engine, as today.
- The web app never fails on a bad document; it falls back and shows one notice
  listing what was skipped.
- If `/api/catalogue` cannot be loaded, the Explorer uses the catalogue bundled at
  build time; the dashboard shows the Explorer section as unavailable and leaves
  the stored property untouched.

## Testing

- Catalogue and document parsing: unit tests for every row of the fallback table.
- API: validator tests per new parameter; cache-key tests showing that parameters
  separate cache entries.
- Web: rendering from a document (order, repeated types, omitted charts), and the
  no-`config` case equal to today's screen.
- Live Earth Engine tests for each new parameter value (each index and band
  combination).
- Dashboard: saving, the size limit, reset, and the preview address.

## Build order

1. Explorer: catalogue, document parsing and fallbacks, rendering from the
   document, with today's behaviour as the standard configuration. Testable by
   hand-writing `config` in the address.
2. Explorer: the new parameters on the API and in the components.
3. Dashboard: the Explorer section of the Imagery card.
4. Desktop: pass `explorer_config` through as `config`, and point Collect Earth at
   the Explorer address.

## Open points

- The exact parameter list per type (which indices and band combinations) is
  settled in the implementation plan.
- Other things a survey might set later: a note for interpreters, a fixed zoom,
  reference maps. Not in the first version.

## Amendments after review against the code (2026-11-16)

1. **The address format.** Collect Earth does not build `?geoJson=…&plot_id=…`.
   `BrowserService.geeAppUrl` builds a fragment, `#geoJson=…;plotId=…;survey=…;startTime=…;endTime=…;`.
   The Explorer will read that fragment as well as the query, and `config` travels
   in it as one more `key=value;` pair. A fragment is never sent to the web host,
   so the host's request-line limit does not apply, and the window is opened
   through the browser driver, not a command line. The 2,000-character cap stays
   as a sanity limit only.
2. **The scene layer.** "Scene (click a chart point)" is not a catalogue type. It
   stays an implicit last row of the layers panel, as today.
3. **One catalogue file, bundled.** The catalogue and the standard configuration
   are one JSON file, `functions/catalogue.json`. The API requires it and serves
   it at `GET /api/catalogue` (for the dashboard); the web app imports the same
   file at build time, so the Explorer needs no extra request before it can draw.
   This replaces "the web app gets it from the API".
4. **Per-entry state.** The Landsat year is one shared value today. With several
   Landsat entries each needs its own year, so layer state is kept per entry
   (by position in the list).
5. **Parameters are Earth Engine work, not only wiring.** The Landsat pipeline
   keeps three bands (nir, swir1, red). True colour and the NBR and EVI indices
   need blue, green and swir2 added. First parameter set:
   - `sentinel2` layer: `label`, `start`, `end`, `bands` (false-colour, true-colour), `maxCloud`.
   - `landsat` layer: `label`, `years` [from, to], `year`, `bands` (false-colour, true-colour), `maxCloud`.
   - `landsat-series`, `sentinel2-series` charts: `index` (NDVI, NDMI, NBR, EVI), `collapsed`.
   - `modis` chart: `index` (NDVI, EVI), `collapsed`.
   - `ccdc` chart: `band` (NDFI, NDVI) as the initial choice, `collapsed`.
   Scenes opened from a chart point stay false colour.
