# Plots map web UI

React + MUI + Vite app for the Collect Earth plots map (the page opened instead of
Google Earth Pro when the plot viewer is "Plots map" or "Plots map + Google Earth Web").
It is served by the embedded Jetty server at `http://localhost:8028/earth/map`
(`LeafletMapController`) and talks to the same endpoints as before: `/mapConfig`,
`/plotsGeoJson`, `/plotStatuses`, `/balloon`, `/openAuxiliaryWindows`.

## Build

The Maven build of `collect-earth-app` builds it automatically (`frontend-maven-plugin`
downloads a local Node into `node/`, runs `npm ci` and `npm run build`). The output goes
to `target/classes/leafletmap/` and ends up in the jar. Use `-Dskip.npm` to skip it.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173/ - data endpoints proxied to a running Collect Earth on :8028
npm test           # unit tests (plot list logic)
npm run typecheck
npm run build      # rebuilds target/classes/leafletmap (refresh the map window to see it)
```

## Structure

- `src/controller.ts` - owns plots, statuses, selection, polling and the map engine;
  React subscribes to it with `useSyncExternalStore`
- `src/engines/` - `LeafletEngine` (ESRI imagery) and `GoogleEngine` (Maps JS API, needs
  `GOOGLE_MAPS_API_KEY`) behind the `MapEngine` interface; a Google failure falls back to Leaflet
- `src/plots.ts` - pure list logic (filter, next unfinished, neighbours, counts)
- `src/components/` - sidebar with the virtualized plot list, map area, form panel

No CDN: fonts (Roboto), icons and Leaflet are bundled. Map tiles come from ESRI /
OpenStreetMap (or Google), as before.
