# The ways of working, run with real desktops

`run.mjs` runs Collect Earth's ways of working end to end, with the real desktop (`CollectEarth.jar`, one home
folder per person) against a real cloud server on PostgreSQL, and prints a `PASS` or `FAIL` line per check. The
review it was written for, and what it found, is `docs/plans/2026-11-15-workflow-review.md`. The server's side of the
same rules is unit-tested in `test/workflows.test.ts`.

| Scenario | What happens |
|---|---|
| `alone` | one desktop, its own SQLite: a name typed, three plots saved, kept on the computer |
| `office` | two desktops on one new, empty PostgreSQL (the office server): the first makes the schema Collect needs; each saves two plots, each sees the other's |
| `cloud` | a coordinator, a project with the demo survey and its plot file, a link; ana joins without an account (registers), bruno with one (signs in); the coordinator gives them the plot file; both save, the sync sends, each plot is its person's |
| `alone-to-cloud` | the `alone` desktop joins the cloud project: it offers to send its plots, sends them under the account, a second send adds nothing, a new save syncs, the name is the account's |
| `office-to-cloud` | the office database's backup ("Export data to XML (ZIP)") made into a cloud project, Luis named for his account, Marta left with her typed name; Marta joins from her office desktop, the coordinator gives her typed name to her (People › Names typed in Collect Earth), and at her next start her plots are on her computer with her answers, not sent back, and a plot she saves again is kept once; Luis joins and finds his plots at once |
| `office-back` | Luis's office computer, now in the cloud project, opens another office project: it is on the office's PostgreSQL again; then the cloud project again: it is in the cloud mode again, and a plot he saves there reaches the cloud |
| `mapathon` | a link that gives each person who joins 5 plots of the file nobody has yet; two people join from new computers (one registering), each Collect Earth opens their 5 plots by itself, nobody has the same plot, a save reaches the cloud |
| `two-computers` | the second person of the mapathon signs in on a second computer: the plot they saved on the first is there with its answer; they change it there, and at the first computer's next start the newer save has replaced the older copy, with nothing queued to be sent back |
| `plots-update` | m1's Collect Earth (checking every 15 s, `-Dcollectearth.myPlotsCheckSeconds`) reads the person's plots from its data folder; a saved record keeps its plot file's name; plots the coordinator gives, then moves away, arrive and leave with no click, with a notice; Refresh now; a training set opens instead of the person's plots, the checks leave it open, and "Back to my plots" |
| `standalone` | the project file for working alone (stage 4): a collector downloads it with her plots, the coordinator with all of them, a collector cannot get everyone's; on a computer that never joined it opens as a local project on its own SQLite with exactly her plots; she types her name and saves a plot; back online she joins, Collect Earth counts the plot as hers and sending puts it in the cloud under her account with her answer; the file with all the plots opens with all 55 |
| `accounts` | the refusals a person sees when joining: a taken name, a wrong password, a short password, a wrong link; and a member joining again on another computer |

Run them in this order (each uses what the earlier ones left): all of them by default, or `node run.mjs office cloud`.

## What it needs

- The desktop built: `mvn -o install -DskipTests -Dskip.npm -pl collect-earth-app -am` in `../collect-earth`, and an X
  display for it (`Xvfb :99 &`; the desktop is started with `DISPLAY=:99`). Only one desktop runs at a time, on :8028.
- PostgreSQL 16 on localhost:55432 (`WF_PG_PORT`), user `ce` with no password, with an empty database `cloud`;
  `office` is made by the `office` scenario.
- The cloud server on :8080 (`WF_CLOUD`) on that database, set up by nobody yet:

  ```bash
  STORE_BACKEND=postgres DATABASE_URL=postgres://ce@localhost:55432/cloud MIGRATE_ON_BOOT=1 SETUP_CODE=setup-code-123 \
    RATE_LIMIT_PER_MINUTE=0 PORT=8080 npx tsx src/index.ts
  ```

- Python 3 (to read a desktop's SQLite) and `psql`.

`WF_DIR` is the working folder (homes, logs, `state.json`, `results-*.json`); by default `<tmp>/ce-workflows`. Start
from an empty one and an empty `cloud` database: the people are registered once.

## How a desktop is driven

Through what its pages and Google Earth call: `/earth/api/...` (header `X-Collect-Earth: 1`) for the name, the settings,
joining, the jobs (send, export) and the sync; `/earth/save-data-expanded` for a save, with one land-cover answer and the
plot's place, as the balloon sends it. A save is written a second later (the desktop's write-behind), and the sync runs
on `syncNow`. Joining restarts the desktop by itself.

Last run from empty databases: 80 checks in ten scenarios, all passed (16 November 2026); all eleven with `standalone`: 94 checks, all passed (16 November 2026).
