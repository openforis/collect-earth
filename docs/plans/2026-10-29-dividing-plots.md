# Dividing plots between people (Collect Earth Cloud)

Date: 2026-10-29. Branch: `feature/cloud-dashboard`.

Today a coordinator can only give **whole plot files** to people (the grid on the
Plot files page). This adds ways to divide one file's plots between people:

1. **Evenly** between chosen people, in file order (neighbouring plots stay
   together) or mixed.
2. **By a column** of the plot file (province, stratum, ...): each value goes to
   one or more people; a value with several people is shared evenly between them.
3. **Overlap for quality checks**: a share of each person's plots (5–50 %) also
   goes to a second person; the Data page lists plots where their answers differ.
4. **Move unfinished plots** from one person to another (someone leaves);
   submitted plots stay where they are.

A map picker is left for later.

**Hard constraint: no Java / Swing changes.** The desktop client keeps calling
`GET /v1/projects/:pid/my-assignment` and downloading each entry's `downloadPath`,
verifying `checksum`. For a divided file the server builds the caller's own file
(the header row, if any, plus only their plots), so the client is unchanged.

## How Collect Earth reads a plot file (the server must match it)

- Separator: the first of `,` `;` tab `|` that splits the first non-empty line into
  at least 3 columns (`CsvReaderUtils.detectCsvReader`, `PLOT_FILE_MINIMUM_COLUMNS = 3`).
- Fields may be quoted (RFC 4180, `""` escapes) and hold the separator or line
  breaks: WKT / GeoJSON / KML polygon columns do.
- The first line may be a header. Treat it as a header when **none** of its fields
  is a number (data rows always hold numeric coordinates).
- Column 1 is the plot id. The record key the client uploads is the survey's key
  values joined by `,` (`String.join(",", getRootEntityKeyValues())`), so a record
  belongs to plot `id` when `recordKey === id` or `recordKey` starts with `id + ","`.
- The operator of an uploaded record is the Collect Earth operator name, which
  joining sets to the username. "Submitted by a person" = a non-deleted record with
  `activelySaved` and `operator === username`.

Built files keep every row's raw text exactly (quotes, separator, line ending), the
BOM if the original had one, and the original line ending (`\r\n` or `\n`).

## Data model — `migrations/006_plot_split.sql`

```sql
ALTER TABLE csv_files ADD COLUMN IF NOT EXISTS distribution JSONB;  -- the rule last applied; NULL = whole file
CREATE TABLE IF NOT EXISTS plot_assignments (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  csv_file_id UUID NOT NULL REFERENCES csv_files(id) ON DELETE CASCADE,
  plot_key    TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overlap     BOOLEAN NOT NULL DEFAULT false,   -- given as a quality-check copy
  PRIMARY KEY (project_id, csv_file_id, plot_key, user_id)
);
-- index (project_id, user_id); RLS policy exactly like assignments_isolation
```

A file is **whole** (`distribution IS NULL`: the existing `assignments` table
applies) or **divided** (`distribution` set: `plot_assignments` applies, and the
file has no rows in `assignments`).
- `PUT /assignments` (the grid) ignores pairs for divided files.
- Applying a division deletes the file's `assignments` rows.
- Choosing "whole file" again clears `distribution` and the file's
  `plot_assignments`.
- Removing a member deletes their `plot_assignments` (as for `assignments`).
- Replacing a file's content keeps assignments for plot ids still present. New ids
  are unassigned, and the summary reports them.

## API (all admin unless noted; ids are UUIDs, non-UUID → 404)

### `GET /v1/projects/:pid/csv-files/:id/columns`
```json
{ "plotCount": 120, "hasHeader": true, "separator": ",",
  "columns": [ { "index": 0, "name": "id", "distinctCount": 120, "values": null },
               { "index": 4, "name": "province", "distinctCount": 3,
                 "values": [ { "value": "La Paz", "count": 50 }, { "value": "Oruro", "count": 40 }, { "value": "", "count": 30 } ] } ] }
```
- `name` is null without a header.
- `values` (sorted by value) are given only when `distinctCount <= 200`.

### `GET /v1/projects/:pid/csv-files/:id/distribution`
```json
{ "distribution": null | Distribution,
  "plotCount": 120, "unassigned": 0,
  "people": [ { "userId": "...", "username": "maria", "plots": 40, "overlap": 4, "submitted": 12 } ] }
```
- `plots` includes the `overlap` copies.
- `submitted` is that person's submitted plots among the plots they hold.
- For a whole file, `people` lists the assignees, each with all the plots.

### `PUT /v1/projects/:pid/csv-files/:id/distribution`
Body is a `Distribution`, optionally with `"dryRun": true`. The response has the
same shape as the GET, computed from the result; nothing is saved on a dry run.
```ts
type Distribution =
  | { mode: 'whole' }                                     // back to the grid; clears the split
  | { mode: 'even';   people: string[]; order: 'file' | 'mixed'; overlapPercent?: number }
  | { mode: 'column'; column: number; groups: { value: string; people: string[] }[];
      order: 'file' | 'mixed'; overlapPercent?: number };
```
- **Errors:** `400 bad_request` with a `reason` for unknown people (not members),
  an empty `people` list or group, a bad column, `overlapPercent` outside 0..50, or
  a whole-file request with extra fields (ignore those instead).
- **even:** person i gets a contiguous chunk. Chunk sizes differ by at most 1, and
  the lists are kept in file order. `mixed` first shuffles the plots with a
  seeded PRNG; the seed is stored in the distribution, so re-reading gives the
  same result.
- **column:** the plots whose value is in a group are split evenly (same rule)
  between that group's people. Values in no group stay unassigned and are counted
  in `unassigned`.
- **Plots already submitted stay with whoever submitted them,** if that person is
  among the people of the plot's group (pinned). The pinned plots count towards
  that person's share; the rest is filled so totals stay as even as possible.
- **overlap:** for each person, `ceil(p% × their non-overlap plots)` of their
  plots, spread evenly through their list (every k-th), are also given
  (`overlap = true`) to the next person in the same group's `people`, round
  robin. When the group has one person, the copies go to the next person among
  all the distribution's people. With only one person in total there is no
  overlap.
- **Unique ids:** plots are identified by their id (column 1). Rows sharing an
  id move together.

### `POST /v1/projects/:pid/csv-files/:id/move-unfinished`
Body: `{ "fromUserId": "...", "toUserId": "..." }`, where `toUserId` must be a
member. The response has the distribution GET shape plus `"moved": n`.
- Every plot of `from` that `from` has not submitted goes to `to`, and `from` loses
  it. If `to` already holds it, `from` simply loses it.
- On a whole file, first convert it to divided: every whole-file assignee gets
  every plot, and `distribution` becomes `{ mode: 'manual' }`, which is also the
  mode after any move.

### Operator side (desktop client, unchanged contract)
- **`GET /my-assignment` includes divided files where the caller holds ≥ 1 plot.**
  Same fields; `filename` is the original filename. `checksum` is the sha256 of
  the caller's built file, and `plotCount` counts their plots.
  - `downloadPath` = `/v1/projects/:pid/csv-files/:id/content?mine=1`
- **`GET /csv-files/:id/content`** serves the full file to an admin without
  `mine=1`. Otherwise, for a divided file, it serves the caller's built file
  (404 if they hold no plot in it); for a whole file it serves the full file,
  as today.
- `x-checksum-sha256` matches what is served.

### Quality check — `GET /v1/projects/:pid/overlap` (admin)
```json
{ "plots": 12, "differing": 3,
  "items": [ { "recordKey": "17", "operators": ["maria", "jose"],
               "fields": [ { "key": "land_use", "values": { "maria": "forest", "jose": "grassland" } } ] } ] }
```
- Covers plots with submitted, non-deleted records from **two or more operators**.
- It compares the summary values and ignores keys that are metadata: the name
  contains `operator`, `actively_saved`, `saved_on`, `modified`, `created`,
  `timestamp`, `skipped` or `_time`. Keep this list in one constant.
- `items` lists only differing plots, at most 500, sorted by recordKey.

## Dashboard (web)

- **Plot files page.** Each row of "Files uploaded" gets a **Divide plots** button,
  which opens the file's page `/projects/:pid/plots/:fileId`. In the grid, a
  divided file's row shows a chip "Divided between N people" (linking to that
  page) instead of checkboxes.
- **File page.**
  - **How to divide:** radio "Whole file (use the table on the Plot files page)" /
    "Evenly between people" / "By a column".
  - **Evenly:** checkboxes for the people (collectors and reviewers first); the
    order is "Keep neighbouring plots together" or "Mix them".
  - **By a column:** a column select, labelled with the header name or "Column 5"
    plus up to 3 example values; columns with more than 200 values are disabled,
    with the reason. Then a table with each value, its plot count and a multi-select
    of people. A "Give every value to one person, in turn" shortcut fills the
    table.
  - **Quality check:** a switch "Also give some plots to a second person, to
    compare answers" and a percentage field (5–50, default 10).
  - **Preview** (dry run) shows a table person → plots (copies) and the unassigned
    count. **Apply** saves.
  - **Current division** shows one row per person with plots / submitted / a
    progress bar, and a "Move unfinished plots to…" menu with a confirmation dialog.
- **Data page.** A "Quality check" section from `GET /overlap`: the counts and a
  table of differing plots (plot, people, field: values).
- **Texts:** in en/es/fr/pt (`web/src/i18n.ts` is CRLF), in plain words for
  people with no technical background, and true to what the desktop app does.
  Collectors see changes after pressing **Refresh** in the plot settings, or the
  next time Collect Earth opens the settings.

## Tests

- **Server:**
  - the parser (separators, quotes with separators and line breaks, header
    detection, BOM, CRLF, empty lines);
  - each mode, including sizes, contiguity, deterministic mixing, groups,
    unassigned values, pinned submitted plots and overlap;
  - move-unfinished on divided and whole files;
  - my-assignment checksum = served bytes;
  - an operator cannot download another person's plots or a file they hold no
    plot in;
  - the grid ignores divided files;
  - removing a member, replacing a file;
  - the overlap report;
  - isolation across projects;
  - a smoke run on a real Postgres (Docker).
- **Web:**
  - pure helpers (division form ↔ request, column labels, the "in turn" shortcut);
  - a Chrome run of the whole flow.
