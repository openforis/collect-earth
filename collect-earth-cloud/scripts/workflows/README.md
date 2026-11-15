# The ways of working, run with real desktops

`run.mjs` runs Collect Earth's ways of working end to end, with the real desktop (`CollectEarth.jar`, one home
folder per person) against a real cloud server on PostgreSQL, and prints a `PASS` or `FAIL` line per check. The
review it was written for, and what it found, is `docs/plans/2026-11-15-workflow-review.md`. The server's side of the
same rules is unit-tested in `test/workflows.test.ts`.

| Scenario | What happens |
|---|---|
| `alone` | one desktop, its own SQLite: a name typed, three plots saved, kept on the computer |
| `office` | two desktops on one PostgreSQL (the office server): each saves two plots, each sees the other's |
| `cloud` | a coordinator, a project with the demo survey and its plot file, a link; ana joins without an account (registers), bruno with one (signs in); the coordinator gives them the plot file; both save, the sync sends, each plot is its person's |
| `alone-to-cloud` | the `alone` desktop joins the cloud project: it offers to send its plots, sends them under the account, a second send adds nothing, a new save syncs, the name is the account's |
| `office-to-cloud` | the office database's backup ("Export data to XML (ZIP)") made into a cloud project, one collector named for an account, the other left with the typed name; she joins from her office desktop and saves one of her plots again |
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

The two `office-to-cloud` checks about Marta's plot fail today: they describe what should happen (see the review).
