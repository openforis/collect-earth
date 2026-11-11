# A new cloud project from a Collect Earth backup

Date: 11 November 2026. Branch `ce-2026-GEW`. **Status: done (11 Nov 2026).**

## Goal

Bring a project collected in Collect Earth (desktop, any version) to the cloud from the backup of its data, the zip of
"Export data to XML (ZIP)" (`ZIP_WITH_XML`): the coordinator starts the cloud project with what was already collected,
without the project file or the plot file at hand.

## What a backup holds

The zip Collect's `XMLDataExportProcess` writes, and the one the cloud's own Collect backup writes
(`src/collectBackup.ts`): `idml.xml`, the survey, then one `<step>/<n>.xml` per record (`1/` entry, `2/` cleansing,
`3/` analysis). Checked on a real one (an IPCC land-use survey, 21 records; not kept in the repository).

- **The survey** has the plot area and the number of sample points (`collectearth:plotarea`, in hectares, and
  `collectearth:samplepoints` on `<survey>`), and marks the attributes filled from the plot file
  (`collectearth:fromcsv`). It does not have the plot shape, the spacing of the points, the imagery settings or the
  balloon: those were in the project file.
- **Each record** has its keys (`id`, often `round`), its location (`location`, EPSG:4326), the operator's name as typed
  in Collect Earth, `actively_saved`, the values of the plot file's columns, its step and its `created`/`modified`
  times.
- **No plot file**: only the plots that have records are in the backup. The original plot file may be in another
  coordinate system (the real one's was in UTM, EPSG:25831).

## Owner decisions (11 Nov 2026)

1. **Plots**: the plots with records are rebuilt from the records; the coordinator may add the original plot file in
   the same dialog, and its plots without a submitted record are the ones given out.
2. **Layout**: a square of the survey's plot area with its points in a grid is suggested, and the coordinator can
   change the shape, the points and the spacing before creating.
3. **Collectors**: as in the CEO import, the dialog lists the names typed in Collect Earth and the coordinator may
   name an account for each; the others keep the name as typed.

## What was built

- `collect-earth-cloud/src/backupImport.ts`: reads the zip one file at a time (`zipEntryList` in `cep.ts`, the checks
  of the project-file upload, with limits of its own: 200,000 files, a record at most 5 MB), the survey's nodes, and
  each record: its key, plot, place, collector, step, time and plot-file columns, and **its summary as Collect Earth
  makes it** (`BalloonInputFieldsUtils.getValuesByHtmlParameters`, which the dashboard and the exports read): every
  single attribute of the root, empty ones as `''` (a coordinate as `null,null`); multiple values joined with `===`;
  an enumerated table with a row per item of its list; a table the collector adds rows to by row number; a single
  entity; values written as Collect Earth's handlers write them (Java's `Double.toString`, `MM/dd/yyyy`, `HH:mm`,
  `code::qualifier`, ranges).
- `collect-earth-cloud/src/routes/backupImport.ts`: `POST /v1/projects/from-backup/preview` and `POST
  /v1/projects/from-backup` (README). The project file is made from the survey (`madeProjectFile`, shared with the CEO
  import) and goes through `acceptCep`; the records are then read again against the survey the project serves, so a
  round the server adds is added to each record's XML and key. The plots with a submitted first-round record go in
  `<survey>_plots_done.csv`; the to-do file is the original plot file without them (its rows as written), or the
  records' other plots. A plot file not in latitude and longitude is refused with a plain reason (the cloud places plots
  by degrees). A typed name that is an account's username is refused unless the coordinator names an account for it:
  its records would otherwise be that person's. A typed name left as it is behaves as the legacy operator names do:
  when that person, signed in, saves the plot again, the record moves to their account (`routes/records.ts`).
- The dashboard: "From a Collect Earth backup" on the projects page (`pages/BackupImportDialog.tsx`,
  `backupImportView.ts`): the backup, then the counts, the plot file, the layout (with the side and area it comes to),
  the collectors and the name. A backup larger than 23 MB is refused before it is sent (it travels in base64 within the
  32 MB request limit), with how to bring it in parts.

## Checked

- `CeoRecordsXmlTest` reads the records of two made-up backups (`src/test/resources/backup/sample`, the survey's own
  round; `sample-round-added`, the round the server adds) with Collect's parser and checks that Collect Earth's summary
  of each equals the cloud's; the made-up survey has every kind of attribute Collect Earth summarizes.
- The real backup, outside the repository: the cloud's summaries of its 21 records equal Collect's; imported in
  the dashboard (21 records, the done plot file), the export reads them, and Collect Earth joined the project and
  placed its plots.

## Not done

- A backup larger than one request (about 23 MB of zip: several thousand records, about 7,000 like the real one's) must come in parts; records can also
  come later through Collect Earth's sync.
- The original plot file must be in latitude and longitude; the cloud does not reproject.
- The imagery and viewer settings of the original project are not in the backup: the project file gets Collect Earth's
  defaults.
- Nested tables (a table inside a table) have no summary in Collect Earth either; their values stay in the XML only.
