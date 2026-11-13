# src/wire: what the server and the dashboard send each other

The types of the JSON that goes over `/v1`, written once and used by both sides:

- the server builds its answers with them (`satisfies` or a typed variable in the route), so an
  answer that drifts from its type fails `npm run typecheck`;
- the dashboard (`web/src/api.ts`) imports them with `import type` and reads the answer as it is,
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
fallbacks for one.

Moved here so far: progress, the bell, progress links and the Settings tab's project calls
(`progress.ts`, `projectSettings.ts`); accounts, sign-in and sign-up, the current user, two-step
sign-in, email digests, invites, former members and server-info (`account.ts`); the server page
(`serverAdmin.ts`). The other areas of `web/src/api.ts` still have their own copies and clean-up functions; move them one
area at a time.
