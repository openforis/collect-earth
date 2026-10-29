# Re-assessments with a unified `round`, quality tools and an AI assistant (Collect Earth Cloud)

Date: 2026-10-29. Branch: `feature/cloud-dashboard`. Builds on
`2026-10-29-dividing-plots.md` (quality-check copies) and replaces "Phase 4: data
quality" of `2026-10-29-coordinator-monitoring.md` with more detail.

**Goal.** Every record of every project says which plot it belongs to and whether
it is the main assessment or a re-assessment. Coordinators analyse re-assessments
the same way in a spreadsheet, in Collect Earth and in the dashboard. The
dashboard helps them find quality problems and gives collectors feedback while
they collect.

**Constraints**
- **No Java / Swing changes.** Everything works with the desktop client as it is.
- Re-assessments are **blind**: a collector doing a check doesn't see that the plot
  was already assessed, or by whom.
- The server changes a survey **only before collection** (no records yet).
- Plain language in en/es/fr/pt; texts true to what the desktop app does.

## Part 1: the project file the server hands out

When a coordinator uploads a CEP whose survey's main entity has a single key
(`id`) and the project has no records, the server keeps the original and serves
its own version, which collectors download when they join. Four files change:

- **`placemark.idm.xml`:**
  - a code attribute `round` after `id`, with `key="true"` and
    `collect:measurement="true"`, in the first tab of the main entity;
  - hidden from the record list (the `isHideKeyInCollectEarthRecordList`
    annotation), so checks are blind;
  - a code list `assessment_phases` (`1` First assessment, `2` Re-assessment)
    with labels in the survey's languages.
- **`balloon.html` and `balloon_web.html`:**
  - a hidden input `collect_code_round` with `value="$[EXTRA_round]"` and
    `class="extra"`, placed after `<!-- START OF EXTRA CSV DATA -->`;
  - `'collect_code_round'` added to `EXTRA_ID_ATTRIBUTES`, so record keys become
    "17,1".
- **`kml_template.fmt`:** `<Data name="EXTRA_round"><value>${placemark.idColumns[1]}</value></Data>`
  next to `EXTRA_id`. Positional `extraColumns[n]` entries are unaffected: extras
  start after the keys and the coordinates.

**Surveys that already have `round`** are left alone (some use it for years, as
the demo survey does with 2024/2025). The Project file page lists the round codes
and asks which one marks re-assessments (2 when it exists, else the coordinator
picks one, or none).

**Once records exist** the server no longer changes the survey. A replaced
project file then keeps whatever it has.

## Part 2: plot files, plot identity, and the round of each record

**Served plot files.** While the project's current CEP is the server's version,
every plot file served (whole or divided, `content` and `content?mine=1`) gets a
`round` column inserted at index 1:
- `1` on main-assessment rows;
- `2` on quality-check copies.

The header (if any) gets `round`. The coordinator's uploaded files stay unchanged.
Collect Earth reads the coordinates right after the keys
(`numberOfKeyAttributes`), so they still land in the right place, and
`x-checksum-sha256` matches the bytes served. A collector with an old project file
would misread the coordinates. Replacing the project file already means joining
again, and the monitoring plan's "has an old project file" warning covers this.

**Plot identity.** The number of key columns comes from the CEP's key count, not a
fixed "column 1". A record belongs to a plot when its key equals the plot's key
columns joined by `,` (exact match, no prefix match).

**The round of every record:**

| Survey | Main assessment | Quality-check copy |
|---|---|---|
| `round` added by the server | key `17,1` | key `17,2` |
| Own `round` with a re-assessment code | the code in the coordinator's file | the server puts in the chosen re-assessment code in the served copy |
| Own `round`, no re-assessment code (years) | as in the file | same key, told apart by the person |
| `id` only (already collecting) | the plot's main holder ("virtual" round 1) | the copy's holder (virtual round 2) |

The CSV export always has the same columns `plot`, `round` and `operator`, so a
spreadsheet can filter `round = 1` on any project. With `round` in the key,
importing both assessments into Collect Earth gives no conflicts, and Collect
Earth's own exports (IPCC, uncertainty, Saiku) already count only `round = 1`.
For `id`-only surveys the download page explains that imports show conflicts.

## Part 3: quality tools and reports

**A "Quality" tab for coordinators:**
- **Agreement by question** between round 1 and round 2:
  - for a question with choices: "Land use: 82 % agree (41 of 50 plots)";
  - for numbers: within a margin the coordinator sets per question;
  - below 20 checked plots: "too few plots to judge" instead of a percentage.
- **Mixed-up answers:** a round 1 × round 2 table per question with choices
  ("grassland ↔ shrubland: 7 times").
- **Agreement by person:** for each collector, on plots they assessed first and on
  plots they checked, with the questions where they differ most.
- **Over time:** agreement per week.
- **The differences list:** each plot where the rounds differ, with both answers
  and the plot's coordinates (with a link to open them in Google Earth). The
  decision is one of:
  - "First is right";
  - "Check is right";
  - "Both need another look", which sends the plot back as in the monitoring plan.

  The decision becomes a `final` column in the export.
- **Guidance notes:** the coordinator writes a note per confusion. It appears in
  the reports below.

**Reports for collectors:**
- **A personal report** on "My work" (printable as PDF). For example: "Of your 40
  checked plots, 34 matched. Most differences: land use, grassland where the check
  said shrubland (plots 17, 23, 51, 88)." It includes the relevant notes and never
  names who checked.
- **A team report** (printable) for training: common confusions, examples and
  notes, with no names.

## Part 4: the AI assistant (Gemini on Vertex AI)

**What the coordinator sees.** "Review with the AI assistant" on the Quality tab
runs for a few minutes, with progress, and writes a report in the dashboard's
language:
- a summary;
- findings with their numbers, plot ids and a likely cause (unclear question,
  overlapping answer options, a person's habit, typing mistakes in numbers);
- suggestions: draft guidance notes (one click makes them real notes), plots to
  check again, questions to reword in the next survey version.

Reports are saved with their date. The assistant never changes anything.

**How it works.** The server uses Google's Gen AI SDK for Node (`@google/genai`)
in Vertex AI mode, with Gemini 3.8 and function calling. Its read-only tools are
limited to one project:
- the survey's questions, answer options and help texts (from the CEP);
- agreement figures and mixed-up answer tables;
- per-person figures;
- the differing plots, and the answers of both rounds for one plot;
- the guidance notes.

The final answer is structured JSON. Numbers come from the tools, not from the
model.

**Privacy.** Names become "Person A", "Person B" before sending, and the dashboard
maps them back. Coordinates and free-text answers and comments are not sent. The
assistant is off by default: the server owner switches it on for the server, then
a coordinator switches it on for their project. The page says what gets sent.

**Kept to its purpose:**
1. **No free chat.** Each finding has fixed follow-ups ("Explain in more detail",
   "Draft a guidance note", "Which plots to check again?"). One short free question
   (≤ 300 characters) passes a separate topic check first. Off-topic questions get
   "The assistant only answers questions about this project's data quality" and
   are logged.
2. **Only a quality report comes out.** A fixed response schema with a length limit
   per field. The server drops findings whose plot ids or numbers don't match the
   tool results. Output is shown as plain text, with no links or HTML; plot ids
   link only when the plot exists.
3. **Only this project, read-only.** No Google Search grounding, no code
   execution, no URL fetching. Tool inputs are validated and outputs capped. Tools
   run inside the project's RLS (`withProject`).
4. **Collected data is data, not instructions.** Tool results are marked as
   project data, and the instruction says never to follow text found there.
   Free-text answers are not sent; labels are shortened. Text planted in the data
   can at worst skew a report.
5. **Who and how much.** Coordinators only, on projects where it is on. Limits set
   by the server owner:
   - reports per project per day (default 5);
   - a monthly token budget per project;
   - one run at a time per project;
   - at most 20 tool calls and a capped output per run.

   The page says when a limit resets.
6. **On Google Cloud:** the API key is restricted to the Vertex AI API and kept in
   Secret Manager, and a billing budget alert is set.
7. **A record of every use:** who started it, the tools used, the tokens spent and
   refused questions. The server owner's panel shows totals and refusals per
   project, never content.

**Setup, by hand for now** (DEPLOY.md):
1. Enable the Vertex AI API (Gemini is billed per use).
2. Choose how the server logs in:
   - **a Vertex AI API key** in `AI_VERTEX_API_KEY` (from Secret Manager on Cloud
     Run);
   - **or** the Cloud Run service account with the "Vertex AI User" role, plus
     `AI_VERTEX_PROJECT` and `AI_VERTEX_REGION`.
3. `AI_MODEL`: the default is Gemini 3.8's exact id, checked against Vertex AI's
   model list before building.

Without these settings the button is hidden. Nothing billable is enabled for the
owner by us.

## Part 5: errors, limits, tests

**The server doesn't add `round`** (the file is unchanged and the Project file page
says why) when:
- a file can't be read, or a marker is missing;
- the main entity has more than one key, or a non-key question named `round`;
- there are several main entities.

Those projects use the virtual round. Before saving its version, the server reads
it back and checks the keys, the code list and the forms. Uploading the server's
own version again changes nothing.

**Data problems are shown on the Quality tab:**
- a record whose key matches no plot;
- a round value other than the main or re-assessment code;
- two main assessments of one plot.

**When the AI fails** (Vertex unavailable, quota, a blocked or malformed answer
after one retry): a plain message; the run doesn't count towards the daily limit;
partial results are never shown as a report.

**Accepted limits for now:**
- Re-assessments come only from quality-check copies. "Assess 10 % of submitted
  plots again later" can come later with the same round.
- Blindness depends on Collect Earth hiding the key. The real-app test checks it.
- `id`-only projects already collecting keep import conflicts in Collect Earth.

**Tests**
- **Server, CEP rewrite:**
  - the demo survey with `round` removed;
  - missing markers;
  - more than one key;
  - an unchanged second upload.
- **Server, plot files and records:**
  - served plot files with `round` (header or none, each separator, quoted line
    breaks, BOM, CRLF), with the checksum equal to the bytes served;
  - plot identity with 1 or 2 keys;
  - the virtual round;
  - the export columns.
- **Server, quality figures:** agreement, mixed-up answers, number margins, the
  small-sample text.
- **The AI assistant, with a scripted fake Gemini (never real Vertex):**
  - tools stay in their project;
  - caps;
  - an injection attempt in collected data;
  - findings checked against the data;
  - off-topic refusal;
  - limits and logging.
- **Web:** pure helpers; a Chrome run of the Quality tab at phone width and in
  dark mode.
- **Real Collect Earth,** after backing up `%APPDATA%\CollectEarth` and restoring
  it afterwards:
  1. Load the server's CEP and open plots from a served plot file.
  2. Check that `round` is hidden in the list, the form and the saved file name,
     and that "17,1" and "17,2" sync.
  3. Import both into Collect Earth with no conflicts, and check that its exports
     count only round 1.
- **One real Gemini run,** only after the owner has set up Vertex.
