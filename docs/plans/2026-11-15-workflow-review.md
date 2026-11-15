# The ways of working with Collect Earth, and the moves between them — review

Date: 15 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: reviewed and tested; three fixes made, three
findings open.**

## What was looked at

| Way of working | How it works today |
|---|---|
| **Alone** | One desktop, its own SQLite (`collectEarthDatabase.db`), the local dashboard fed from it (`LOCAL_MODE`). |
| **An office team on a local server** | Several desktops with `db_driver=POSTGRESQL` on one database in the office: every plot is in the one database, each person sees the others'. |
| **A big group on a cloud server** | A coordinator makes the project (project file, plot files), sends a link (`/join/<token>`); each person joins from the desktop (Project › Join cloud project), which downloads the project, switches to `CLOUD` mode (a local SQLite plus the sync) and restarts. Plots are sent in batches every 30 s; the server keeps each under the signed-in account. |
| **Alone → cloud** | Joining offers once to send the plots already on the computer (`CloudRecordsSender`, also in the Data menu); they are kept under the account, whatever name was typed. |
| **Office team → cloud** | The coordinator exports the office database ("Export data to XML (ZIP)") and makes the cloud project from it ("From a Collect Earth backup"), naming an account for each typed name or leaving it; then the people join. |
| **Joining after the work started** | The same link; a person gets plots once the coordinator gives them a plot file. |
| **With or without an account** | No account: Register with the link. An account (another project's): Log in with the link, which adds the project to the account and uses one of the link's uses. Already in the project: the link signs in, keeps the role, uses nothing. |

## How it was tested

- **Server rules** (`collect-earth-cloud/test/workflows.test.ts`, 12 tests, in-memory store): the links, the
  accounts, whose plots are whose, the backup of an office team, people joining late.
- **Real runs** (`collect-earth-cloud/scripts/workflows/`, `README.md` there): the desktop built from this branch, one
  home folder per person, driven through its own API and the form's save, against the cloud server on PostgreSQL 16;
  the office team on a PostgreSQL 16 database of its own. 43 checks in six scenarios (alone, office, cloud,
  alone-to-cloud, office-to-cloud, accounts). Last full run from empty databases: 41 passed; the 2 that fail are
  finding 2 below and are kept failing on purpose. The `accounts` scenario was run again after the desktop fixes:
  6 of 6.

## Fixed

1. **A typed name that is the person's own username in other letters doubled their plots.** An office backup has
   "Marta"; she joins as `marta`; her computer sends its copies under "Marta". The server refused to move plots kept
   under any name that matches an account (to protect other people's), and "Marta" matches her own account, so each
   plot was kept twice. Now the move is allowed when the name is the signed-in person's username in other letter
   case and no other account has that exact name (`src/routes/records.ts`; both cases in `workflows.test.ts`).
2. **A mistyped or cut-short link** gave the desktop an internal error with no message (the server answers 404 for a
   link it does not know). It now says "This invitation is not valid, has expired, or has already been used."
   (`CloudService.preview`, `CloudServiceTest`).
3. **The refusals of joining were shown as the server's answer**, e.g.
   `register failed with HTTP 409: {"error":"username_taken"}`. They are now plain words in the five languages:
   a taken username (with "choose Log in instead of Register" when it is yours), a wrong username or password, a link
   used up or withdrawn (`CloudService.authenticate`, two new keys in `Messages*.properties`, `CloudServiceTest`).

## Open

1. **Office team → cloud: the typed names' plots never become the people's.** After the import, Marta's plots are
   under "Marta Lopez". When she joins, her desktop sends every save under `marta` (in cloud mode the name is the
   account), so the server's rule "a typed name moves to the account on its next save" never fires: a plot she saves
   again is kept twice, once as "Marta Lopez" and once as `marta`, and counts twice in progress and quality. Seen in
   the real run (`office-to-cloud`). The coordinator can name accounts only at the import, and only for accounts that
   exist already, which for a team moving to the cloud is usually none.
   *Proposal:* in People, a "Plots under typed names" list (each name with its count) with "Give to…" an account;
   the server moves every plot of that name to the account (keeping both where the account has its own copy). It
   also serves the CEO import's names and older projects. Optionally, at the import, a personal link per typed name
   that does the same when used.
2. **A person joining does not get their earlier work on their computer.** The desktop only sends plots, never
   downloads them. For someone from the office team, their plots were in the office database: after joining, their
   computer (now a local SQLite) has none of them, so a plot they open again is empty, and the plot file the import
   made gives out the plots that were drafts as to do. *Proposal:* at the join, download the account's own plots of
   the project into the computer's database; at least, show the plot as done by someone in the cloud.
3. **An office PostgreSQL that is empty stops the desktop from starting.** Collect needs the schema `collect` in the
   database; without it the desktop fails at start ("Cannot open the plots map: the server is not initialized") and
   nothing says why. Nothing in this repository tells an office to make it. *Proposal:* create the schema when it is
   missing (`CREATE SCHEMA IF NOT EXISTS collect`, as `RDBExporter` does for its own), or say it in plain words.

## Noted, working as designed

- A person who joins has **no plots until the coordinator gives them a plot file** (Setup › Plots). Checked in the
  run; the desktop shows no plot file from the cloud meanwhile.
- **Send this computer's plots** sends every plot of the project on the computer under the account, those copied
  from colleagues' computers too; the question says "under your account". The other person keeps theirs (the server
  test `joining after the work started`), so nothing is lost, but the copies count as the sender's.
- **Read in the code, not run:** a computer of the office team that joins a cloud project and then opens another
  project goes to its local SQLite, not back to the office PostgreSQL (`EarthProjectsService.driverAfterLoading`:
  `CLOUD` becomes `SQLITE`), so someone who still works on office projects has to choose PostgreSQL again in the
  settings. Worth a scenario of its own if offices keep both.
