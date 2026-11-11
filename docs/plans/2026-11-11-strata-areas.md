# Strata and areas: the expansion factor of each plot

Date: 11 November 2026. Branch `ce-2026-GEW`. Status: in progress.

## Why

The area each plot stands for (its expansion factor) turns plot counts into hectares: the Analysis page's Area
column and the Uncertainty page's tables. A design that samples strata at different intensities depends on it: the
Benin forest survey (`benin_2026_pfc`) samples 18 classified forests at 6 to 220 ha per plot, so counting plots
without areas overweights the densest forests up to 35 times.

## How it works today (and stays)

As Collect Earth's `RegionCalculationUtils`: a stratum's area (hectares) is divided among its plots that have a
submitted first assessment; `plot_weight` is the factor divided by the smallest one above 0. The strata come from
`areas_per_attribute.csv` (questions' names, then `area`, optionally `weight`, which is ignored) or the older
`region_areas.csv` (region, plot file, area), inside the project file. The uncertainty is the stratified estimator
(`src/uncertainty.ts`), one stratum per line of the file, or one total area typed on its page.

## Problems

1. **Area counted twice.** Every record of a plot carries the plot's factor: check copies, drafts, a second person's
   assessment. The ready-made views filter to first assessments; any other view adds a checked plot's area twice.
2. **Silent losses.** Plots of no stratum are not reported (only lines of no plot are). A column of the file that is
   not a question of the survey matches nothing, unsaid. A file saved in Windows-1252, or with decimal commas
   (`68872,5` in a `;` file from Excel in French, Spanish, Portuguese), matches nothing or drops its lines.
3. **Two rules for no-data plots.** With `region_areas.csv`, `noData` plots stand for no area (their stratum's area
   spread over its other plots); with `areas_per_attribute.csv` they keep their share; the Uncertainty page spreads
   the area of the codes left out. The two pages can disagree.
4. **Areas only inside the project file.** Changing one means editing the `.cep` and uploading it again. The
   dashboard's stratified design knows each stratum's km² and drops it; the stratum must be a question of the survey,
   so the `stratum` column the design adds to the plot file cannot be used.

## Owner decisions (11 Nov 2026)

1. **No-data plots keep their share of the area**, as their own class ("no data"): the totals add up to each
   stratum's area and the gap stays visible. On the Uncertainty page the plots whose codes are left out stay in their
   stratum's count and show as their own line; they are in no IPCC category.
2. **Everything, in steps**, each tested and committed.

## Steps

### 1. Correctness

- The factor only on the record that counts: the plot's first submitted assessment (the one in the denominator).
  Every other record has none, so any filter sums right.
- The areas file read as UTF-8, else Windows-1252; decimal commas read in a `;` or tab file.
- Reported: the columns of the file not in the survey; the assessed plots in no stratum, with their values.
- No plot is left out of the area: `region_areas.csv`'s `noData` plots keep their share too (decision 1).
- Uncertainty: left-out plots stay in the denominator, as a line of their own.

### 2. Strata and areas on the dashboard

- A project setting (`projects.area_settings`, migration 037), in both stores: per stratum (the plot-file columns
  that make a stratum, and each stratum's area in hectares) or one total area. When it is not set, the project
  file's areas file is read as before, so existing projects do not change.
- The stratum of a plot: its record's answer for a survey question; for a plot-file column that is not a question,
  the plot's row in the project's plot files.
- `GET/PUT /v1/projects/:pid/areas`, and the file as `areas_per_attribute.csv` to download or upload (Collect Earth's
  format). The table: each stratum, its plots in the plot files, its plots assessed, its area, the hectares per plot;
  the warnings of step 1.
- Filled by itself when the server knows the areas and nothing is set: a stratified design on the dashboard (the
  `stratum` column, km² × 100), a design over an area (its total), the Uncertainty page's total area.
- The Uncertainty page reads the same setting; its total-area field writes it.
