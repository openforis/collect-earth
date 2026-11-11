# Plot layout in the cloud dashboard

Date: 11 November 2026. **Status: built on the working branch (`claude/awesome-bell-s34gb0`).**

## Goal

The coordinator of a cloud project sets how Collect Earth draws each plot for the collectors (its shape, its sample
points, the distances and the reference area around it) from the dashboard, instead of editing the project file's
`project_definition.properties` by hand or asking every collector to change their settings page. Collect Earth applies
those properties when a collector opens the project, so everyone sees the plots the same way.

## As built

- **Shared drawing** (`collect-earth-cloud/web/src/shared/plotPreview.ts`, moved from the desktop's
  `src/plotPreview.ts`): `plotDrawing` (the outline, points, central plot, cluster and reference area, as the KML
  generators lay them out) and, new, `plotFigures` (the plot's and the reference area's areas, the least and the
  recommended distance of the reference area: a port of `PlotGeometry`). The desktop imports it as `@shared/plotPreview`.
- **Server** (`src/plotLayout.ts`): the settings, their options and ranges (`SettingsModel`, `PlotGeometry`);
  `layoutOf` reads them as Collect Earth does (blank or unknown shape SQUARE, defaults, clamped ranges, a reference area
  shape left blank NONE without a distance else SQUARE, the first of several distances); `parseLayout` checks a
  coordinator's; `layoutChanges` writes what the desktop's settings page would save: the settings shown for the shape
  that changed, `distance_between_sample_points` and `large_central_plot_side` blank when hidden (`blankWhenHidden`:
  Collect Earth would size a one-point square by the first, and draw a central plot in any square that has the second),
  the other hidden ones left as they are, the extra distances of a file edited by hand kept; `setProperties` rewrites
  the lines in place (a later line of the same key dropped, missing keys added, every other line kept) and
  `withProperties` (`src/cep.ts`) writes the properties back as ISO-8859-1, so the bytes of the rest stay.
- **Routes** (`src/routes/plotLayout.ts`): `GET /v1/projects/:pid/plot-layout` (reviewers) with whether the plot files
  carry polygons; `PUT` (coordinators) into the served project file and the one as uploaded (served again after a
  change of rounds). Nothing written when nothing changed; else the project file is new, and People shows who needs it
  with the link to get it, as after an upload. Off in local mode, where the desktop's own settings page sets it;
  isolation cases.
- **Dashboard** (`web/src/project/PlotLayout.tsx`, `web/src/plotLayoutView.ts`), Project file tab, **Plot layout**: the
  fields the desktop's settings page shows for the shape chosen (the distance named as spacing, radius or the cluster
  plots' radius), the preview to scale with a scale bar, the areas in hectares; a reference area not enclosing the plot
  blocks Save, one under ten times the plot offers the recommended distance; a note when the plot files carry polygons;
  read-only for reviewers. Texts in en/es/fr/pt, the desktop's wording.
- **Checked:** `test/plotLayout.test.ts` (reading, checking, what is written, the file's other entries and lines kept,
  the routes: no change no new file, the served and uploaded files, roles), `plotLayoutView.test.ts`,
  `shared/plotPreview.test.ts` (with the figures), the desktop's frontend tests and typecheck; in a browser (the demo
  project read as a 7 × 7 square; a 20 m circle of 9 points with a circular reference area: 20 m refused as inside the
  plot, 64 m recommended and saved: 0.13 ha and 1.29 ha); and a desktop joining the project afterwards read CIRCLE, 9
  points, 20 m, CIRCLE 64 m from it.

## Not done

- A collector already in the project gets the new layout only with the new project file (the link People gives, as
  for an upload): Collect Earth downloads the project file only when it joins. Fetching a newer project file at sync
  would need a change in the desktop.
