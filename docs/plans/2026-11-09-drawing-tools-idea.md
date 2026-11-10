# Drawing on the map while interpreting (an idea for later)

Date: 9 November 2026. **Status: an idea, not planned.** Kept here so it is not lost; nothing is decided or built.
CEO's simplified projects, which need it, stay refused by the CEO import (`2026-11-09-ceo-bridge.md`, Part F, closed
10 Nov 2026).

## The idea

Let the interpreter draw on the map as part of the answer to a plot: a point (a tree, a building), a line (a road, a
river) or a polygon (a clearing, a burnt patch, the part of the plot under crops), and save the shape with the
record.

Collect Earth Online has it: collectors draw points, lines or polygons as "samples" and answer the survey for each
one; editing and deleting a shape are a Ctrl+drag and a Ctrl+right-click, and the project's administrator chooses
which shapes are allowed (https://collect-earth-online-doc.readthedocs.io/en/latest/collection/standard.html). Its
"simplified" projects are built entirely on it: no sample points, the collectors draw what they see.

## Why it waits

It changes how data is collected, not only the tools. Today a Collect Earth plot is a fixed shape with fixed
sample points, and the answers describe that plot (land use, cover per element, the share of points per class).
With drawing:

- the unit of observation becomes the drawn shape, with its own answers, beside or instead of the plot's;
- the results stop being proportions of a fixed sample and become areas and counts of drawn features, which the
  estimates (the IPCC exports, the analysis page, the area estimates people make from the plot data) do not take
  today;
- two interpreters' drawings of the same thing never match exactly, so quality checks need a measure of agreement
  for shapes (overlap of areas, distance between points), not only equal answers.

Survey designers, trainers and the people analysing the data would all have to change how they work.

## What it would take

Noted from the code as it is in November 2026, to size the work if it is taken up.

- **The survey.** Collect's survey model has no line or polygon answer; a coordinate is its only geometry. A shape
  would be a text attribute holding WKT or GeoJSON (Collect Earth already reads plot shapes written as WKT in the
  plot file, `PolygonWktGenerator`), or a new attribute type in Collect itself. The Collect Survey Designer would need
  a way to mark such an attribute "drawn on the map", with the shapes allowed.
- **The plots map** (Leaflet, `LeafletEngine.ts`): drawing and editing tools (a library such as Leaflet-Geoman or
  Leaflet.draw), the plot's outline and sample points kept visible, and the shapes of a record shown again when the
  plot is opened.
- **Google Earth Web and Google Earth Pro** cannot be drawn on from Collect Earth: Google Earth Web runs in another
  window with no API for it, and Google Earth Pro only reads the KML it is given. Drawing would work in the plots map
  only, so the imagery the interpreter draws over would be the plots map's, not Google Earth's. That alone may decide
  whether the idea is worth it, unless the plots map gets better imagery first (Sentinel-2, Planet and WMS/XYZ layers
  inside the map, the second item of the Collect Earth Online comparison of 9 Nov 2026).
- **The form** (`form/FormApp.tsx`): a control for the drawn attribute (a "Draw" button, the shapes listed with
  their answers), and the checks: a shape inside the plot, not crossing itself, at most so many.
- **Saving and sync**: the shape travels as text through the balloon endpoints and the cloud's `records:batch`, so
  little changes there; the size of a polygon with many vertices needs a limit.
- **Data out**: the CSV and XML exports carry the WKT as any text; the cloud's GeoJSON, KML and shapefile exports
  (`cfb8f01`) would write the drawn shapes as features of their own; the analysis page would need areas and counts.
- **Quality**: the check copies and reference plots compared shape against shape (overlap of areas, distance between
  points), with a threshold the coordinator sets.

## A smaller first step, if it is ever tried

Points only, inside the plot: "mark each tree", "mark each building". A point is a coordinate, which Collect already
has (a coordinate attribute in a multiple entity, one row per point marked), so no new attribute type is needed, the exports already carry it, and
agreement between interpreters is a distance. It would show whether interpreters and survey designers want drawing
before polygons are taken on.

## Questions for whoever picks this up

1. Which projects would use it, for what (points, lines or polygons), and would they still use the sample points?
2. Is drawing over the plots map's imagery good enough, given that Google Earth cannot be drawn on?
3. How are areas from drawn polygons turned into estimates, and who does that: the analysis page, or the users'
   own tools?
4. A new attribute type in Collect, or a text attribute holding WKT?
