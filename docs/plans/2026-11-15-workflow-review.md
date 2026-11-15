# The ways of working with Collect Earth, and the moves between them — review

Date: 15 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: reviewed and tested; six fixes made (the
last three the open findings of the first round, built the same day).**

## What was looked at

| Way of working | How it works today |
|---|---|
| **Alone** | One desktop, its own SQLite (`collectEarthDatabase.db`), the local dashboard fed from it (`LOCAL_MODE`). |
| **An office team on a local server** | Several desktops with `db_driver=POSTGRESQL` on one database in the office: every plot is in the one database, each person sees the others'. |
| **A big group on a cloud server** | A coordinator makes the project (project file, plot files), sends a link (`/join/<token>`); each person joins from the desktop (Project › Join cloud project), which downloads the project, switches to `CLOUD` mode (a local SQLite plus the sync) and restarts. Plots are sent in batches every 30 s; the server keeps each under the signed-in account. |
| **Alone → cloud** | Joining offers once to send the plots already on the computer (`CloudRecordsSender`, also in the Data menu); they are kept under the account, whatever name was typed. |
| **Office team → cloud** | The coordinator exports the office database ("Export data to XML (ZIP)") and makes the cloud project from it ("From a Collect Earth backup"), naming an account for each typed name or leaving it; then the people join, and the coordinator gives each name left to its person (People › Names typed in Collect Earth). Each person's plots come to their computer. |
| **Joining after the work started** | The same link; a person gets plots once the coordinator gives them a plot file. |
| **With or without an account** | No account: Register with the link. An account (another project's): Log in with the link, which adds the project to the account and uses one of the link's uses. Already in the project: the link signs in, keeps the role, uses nothing. |

## How it was tested

- **Server rules** (`collect-earth-cloud/test/workflows.test.ts`, 17 tests, in-memory store): the links, the
  accounts, whose plots are whose, the backup of an office team, giving a typed name, people joining late, a person's
  own records; `scripts/pg-smoke-give.mts` for giving on PostgreSQL.
- **Real runs** (`collect-earth-cloud/scripts/workflows/`, `README.md` there): the desktop built from this branch, one
  home folder per person, driven through its own API and the form's save, against the cloud server on PostgreSQL 16;
  the office team on a new PostgreSQL 16 database of its own. 54 checks in six scenarios (alone, office, cloud,
  alone-to-cloud, office-to-cloud, accounts).

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

4. **Office team → cloud: the typed names' plots now become the people's.** After the import, Marta's plots were under
   "Marta Lopez"; when she joined, her desktop sent every save under `marta`, so a plot she saved again was kept twice.
   Now the coordinator gives each typed name to its person: People › **Names typed in Collect Earth** (the names of
   nobody in the project that are no account's, or a member's username in other letters) › **Give to…**. Every plot
   of the name moves to the person, with its history, training records and quality decisions; where the person
   already has their own record of a plot, both are kept. Logged as `records.given`, without the typed name.
   (`POST /v1/projects/:pid/former-members/give`, `Store.giveOperatorRecords` in both stores,
   `components/FormerMembers.tsx`, `formerMembersView.ts`; the people who left keep their own card, with Anonymise.)
5. **A person joining gets their earlier work on their computer.** The desktop used to only send. Now, at the first
   start after joining or opening a cloud project, and at any later start when the server has more of the person's
   records than the computer has (one small request, `GET my-records`), Collect Earth downloads the person's own
   records (`GET my-records.zip`, a Collect Earth backup) and adds those the computer does not have, with its own XML
   import; a record already there is never replaced, and nothing is sent back. A notice says how many arrived; a
   failure is said and tried again at the next start (`CloudOwnRecordsFetcher`, five languages). This is also what
   brings Marta's plots once the coordinator gives her name: at her next start.
6. **An empty office PostgreSQL no longer stops the desktop.** At start, with the connection it already tests, the
   desktop makes the schema Collect needs (`CREATE SCHEMA IF NOT EXISTS collect`); a user without the right gets the
   reason in the log, and the start goes on as before (`ServerController.ensureCollectSchema`).

All six are in the real runs: the office starts on an empty database; Marta's name is given, her plots arrive at her
next start with her answers and are not queued to be sent back, and a plot she saves again is kept once; Luis, named at
the import, finds his plots right after joining.

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
