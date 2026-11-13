# src/wire: what the server and the dashboard send each other

The types of the JSON that goes over `/v1`, written once and used by both sides:

- the server builds its answers with them (`satisfies` or a typed variable in the route), so an
  answer that drifts from its type fails `npm run typecheck`;
- the dashboard (`web/src/api/`, one file per area) imports them with `import type` and reads the answer as it is,
  with no hand-written clean-up: a renamed or removed field fails the dashboard's typecheck
  instead of showing up as a silent 0 or an empty text.

Rules, so both sides can import these files without dragging anything else along:

- **types only**: `export interface`, `export type` and `import type` from another file of this
  folder. No values, no functions, no imports from outside `src/wire/` (`test/wire.test.ts`
  checks it). A type import leaves no code in the dashboard's bundle.
- a field is optional (`?`) only when the server really leaves it out; otherwise `| null`.
- the Java desktop client reads some of these answers too: a change here is a change to the `/v1`
  contract, as before.

The dashboard and the server are built and shipped together (the Dockerfile builds `web/` next to
`src/wire/`; local mode bundles both), so the dashboard never talks to an older server and needs no
fallbacks for one. The one case left, a page left open across an upgrade, is handled once:
server-info's `dashboardBuild` changes with each build, and the page offers to reload
(`web/src/newVersion.ts`).

Moved here: every area of `web/src/api/`. `account.ts` (accounts, sign-in, the current user,
two-step sign-in, digests, invites, server-info), `serverAdmin.ts` (the server page), `projects.ts`,
`plotFiles.ts`, `data.ts`, `progress.ts`, `projectSettings.ts`, `quality.ts`, `ai.ts`, `reports.ts`,
`checks.ts`, `review.ts`, `map.ts`, `people.ts`, `analysis.ts`, `activity.ts`, `training.ts`. A new
route gets its answer's type here, in the file of its area, and `web/src/api/` uses the answer as it comes.
