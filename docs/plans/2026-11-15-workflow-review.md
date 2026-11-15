# The ways of working with Collect Earth, and the moves between them — review

Date: 15 November 2026. Branch `claude/awesome-bell-s34gb0`. **Status: reviewed and tested; six fixes made (the
last three the open findings of the first round, built the same day); then ten improvements and the problems found
while looking further (below, "Second round").**

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
  the office team on a new PostgreSQL 16 database of its own. 54 checks in six scenarios in the first round (alone,
  office, cloud, alone-to-cloud, office-to-cloud, accounts); 69 in nine after the second (office-back, mapathon,
  two-computers added), all passing, and nightly in CI.

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
- **Send this computer's plots** sent every plot of the project on the computer under the account, those copied
  from colleagues' computers too. *Changed in the second round (4): only the person's own by default.*
- A computer of the office team that joined a cloud project and then opened another project went to its local
  SQLite, not back to the office PostgreSQL. *Changed in the second round (6).*

## Second round: ten improvements

1. **Invitation links that hand out plots.** A link can carry a plot file: the whole file to each person who joins,
   or the next N plots of it that nobody holds and nobody submitted (the file is divided, by hand, when nobody had
   it). Given before the join's answer, so Collect Earth opens the person's plots right after its restart; only for
   collectors (People › Invite, `src/invitePlots.ts`, `invites.plots` in migration 044, `test/invitePlots.test.ts`,
   `scripts/pg-smoke-invite-plots.mts` on PostgreSQL, the `mapathon` real run).
2. **Join emails grouped.** A coordinator gets the first join of a project at once; the joins of the next hour come
   as one summary (`join_mail_queue`, migration 045, sent by every instance's minute check with `FOR UPDATE SKIP
   LOCKED`, so two instances never send one twice). The email says what plots the person got. Can be switched off
   (Account › Emails, and the email's one-click unsubscribe).
3. **Plots given while Collect Earth runs come without a restart:** it asks every ten minutes, quietly
   (`CloudOwnRecordsFetcher.check`).
4. **"Send this computer's plots" sends only the person's own by default**: those under a name typed on the computer
   before it joined, or under the username; a box adds the others (`CloudRecordsSender`, `SendToCloudDialog`).
5. **Giving the default name ("Collect Earth User") warns** that several people may be behind it.
6. **An office computer goes back to its PostgreSQL** when it opens a local project after a cloud one
   (`DB_DRIVER_BEFORE_CLOUD`, `EarthProjectsService.driverAfterLoading`).
7. **DEPLOY.md** gives the cost of keeping one instance up (about $10 a month), which the join emails' minute check
   needs to run on time.
8. **Real email checked** against a local SMTP sink: the confirmation, the immediate join email, the grouped one an
   hour later, and the one-click unsubscribe (RFC 8058 `List-Unsubscribe-Post`).
9. **Load test on the smallest database** (below).
10. **A nightly end-to-end run** in CI: `.github/workflows/workflows-e2e.yml` builds the desktop, starts the cloud
    server on PostgreSQL 16, runs every scenario under Xvfb and keeps the logs (nightly and on demand, about 25
    minutes).

### Load test: 100 interpreters on db-f1-micro

`scripts/load-mapathon.mts`, with the database held to what db-f1-micro gives (a quarter of a CPU, 614 MB) and the
server to one CPU and 512 MB: 100 interpreters joining with a link and saving plots.

| | Saves, median | Saves, p99 | Notes |
|---|---|---|---|
| A normal pace (a plot every 1–2 minutes each) | 14 ms | 31 ms | |
| Ten times that pace | 13 ms | 133 ms | |
| All reconnecting at once with a backlog | | | about 6.4 s per batch of 50 records |
| Saving with no pause at all | | | the dashboard's pages took 2–4 s meanwhile |

No errors, every plot stored once, the database at most 282 MB. db-f1-micro holds a mapathon of 100; g1-small is for
more people, or for the dashboard to stay fast while everyone saves without pause.

## Second round: found while looking further, and fixed

- **Joining with a share link read every record's answers** to know which plots were done: now only the records'
  states, so a room joining at once does not read the project's answers a hundred times.
- **Plots were offered on links for reviewers and coordinators**, who never collect: refused by the server and not
  offered by the form.
- **The coordinator's email for a file given whole after the link was made** said the person got plots; it now says to
  give them some.
- **The desktop compared how many records** the server and the computer have, so a colleague's copy of a plot on the
  computer hid a plot of the person's: it compares the keys now.
- **`GET my-records` read every record of the project** to list the person's: one query on the person's now
  (`listOperatorRecordKeys`).
- **The same person on two computers** (a lab's and their laptop) got the plots saved on the other, but a plot both had
  was never brought up to date, and saving it again on the computer with the older copy overwrote the newer work in
  the cloud. `GET my-records` now says when each record was saved; a newer save (by more than a second) replaces the
  copy on the computer, never while that plot has changes there not sent yet (the `two-computers` real run).
- **A colleague's copy of a plot** (on a computer several people collected on) could be replaced by the person's newer
  save of the same plot, and made the ten-minute check download the person's records each time: only the person's
  own copy, or one with nothing answered in it, is replaced now.
- **A computer left open beside the one the person works on** downloaded all of their records every ten minutes for
  the few saved meanwhile: it asks for those only now (`my-records.zip?key=`, up to 200).
- **An office computer back on its PostgreSQL** (improvement 6) that opened its cloud project again from the project
  list stayed on the office's database: the cloud project's plots would have been saved there and never sent. It is
  in the cloud mode again now (`driverAfterLoading`; the `office-back` real run).
- **A big group joining at once from one room** (one address) beyond the server's 60 a minute was shown the server's
  answer, `register failed with HTTP 429`; Collect Earth now says that too many people joined from this network in the
  last minute, and to wait a minute. The limit itself is `RATE_LIMIT_PER_MINUTE` (DEPLOY.md), to raise for a bigger
  room.

Checked and fine: reference plots reach people who join late (through `my-assignment`); a person who uses a link
again, or signs in with it while already a member, takes no more plots and no use of the link; a person removed from
the project gives their plots back to the file's pool.
