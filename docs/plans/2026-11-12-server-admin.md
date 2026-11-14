# The server administrator's page: sections, accounts, operations, safety

Date: 12 November 2026. **Status: stages A, B, C and D built; built in stages on the working branch (`claude/awesome-bell-s34gb0`), merged
into `ce-2026-GEW` on 12 Nov 2026 (the four stages, without the repeat survey).**

## Where it starts

`web/src/pages/ServerPage.tsx` is one long page of five cards, for server administrators only:

- **Alerts** (`ownerAlerts.ts`): failed logins, server errors, refused records, a full project, unreadable two-step
  keys, raised since the server started, mailed to administrators;
- **How the server is doing** (`GET /v1/admin/overview`): accounts, active accounts, projects, space used, plot saves per
  day, new accounts per week, the largest projects (by id), the database (size, migrations), failed logins and refused
  requests, late automatic check draws;
- **Who can do what**: open sign-up, two-step sign-in for coordinators, who creates projects, the limits per account,
  the server's name, terms, contact, announcement, the AI assistant (switches save at once, forms with their buttons);
- **AI assistant use this month** (by project id);
- **Accounts** (`GET /v1/admin/users`): every account with its projects count, badges; disable or enable, a reset link,
  turn off two-step sign-in. No search, no dates, no paging.

Projects stay shown by id only, as now: only a project's members know its name.

## The owner's choices (12 Nov 2026)

All of them, in four stages.

### Stage A: the page

1. **Sections with a menu**: Overview · Accounts · Projects · Settings · System, each with its own address
   (`/server/accounts`...), a side menu on wide screens and tabs on narrow ones; the cards move to their section.
2. **A health line at the top** of every section: "All good", or "N things need attention", each a link to where it is
   fixed: alerts raised, database updates not applied, mail not set up, outdated Collect Earth versions (stage C).
3. **Settings saved per section**: every group of settings with its own Save and Discard, a note of what it affects,
   and a warning before leaving the page with changes not saved (the switches stop saving on their own).

### Stage B: accounts

4. **Search, filters, sorting, paging**: by name or email; disabled, administrators, two-step sign-in, inactive for 90
   days; sorted by name, creation or last activity; the creation and last-active dates; pages for large servers; the
   list as CSV (no project names).
5. **Make or remove an administrator**, with a confirmation; never the last one; logged.
6. **Create or invite accounts**: one or many (a list pasted), each with a link to set its password, mailed when the
   server sends mail and the address is given, else shown to copy; works when sign-up is closed.
7. **Sign out everywhere**, and **delete an account** (its sessions, memberships, personal data), the plots it collected
   kept under its name; never the last administrator; confirmation by typing the name.

### Stage C: projects and operations

8. **Projects directory**: every project by id with its status, creation, last activity, space used, people and
   coordinators; flags projects without an active coordinator; archive one, or hand it to a new coordinator (an
   account the administrator picks).
9. **Server activity log**: who changed which server setting, disabled, promoted, created, deleted or signed out whom,
   reset whose password or two-step sign-in, sent a message; filter by person and kind, CSV.
10. **Collect Earth versions in use**: the desktop versions that synced lately (the client version the sync sends) and
    how many accounts use each; the outdated ones flagged.
11. **Mail check and test email**: whether mail is set up, "Send me a test email", and the addresses the mail server
    keeps refusing (the weekly emails' stops).

### Stage D: safety and communication

12. **Better alerts**: mark an alert as seen, keep their history, change the thresholds, and send them to a Slack or
    Teams webhook as well as by email.
13. **Message all coordinators** (or everyone with a confirmed address), with a preview and a count of who receives it;
    logged; never more than once an hour.
14. **Sign-up rules**: sign-up only for some email domains, the minimum password length, and an account locked for a
    while after many failed logins (on top of the rate limit).

Each stage: both stores and a migration where needed (`migrations/NNN_*.sql`), routes with their tests and isolation or
admin-only cases, the page in en/es/fr/pt/tr, a run in a browser, this file's "as built" notes.

## Stage A, as built (12 Nov 2026)

- **Sections** (`web/src/router.ts`: `{ name: "server", section }`, `SERVER_SECTIONS`): `/server` (Overview),
  `/server/accounts`, `/server/projects`, `/server/settings`, `/server/system`; any other `/server/...` is not found. A
  side menu on wide screens, scrollable tabs on narrow ones (`ServerNav`). Overview: the alerts and the figures; Accounts:
  the accounts; Projects: the largest projects and the AI use; Settings: the groups below; System: the database, the
  server's version, failed logins and refused requests, late check draws. The figures are loaded once for the page.
- **Health line** (`web/src/serverView.ts`, `serverHealth`) at the top of every section: "All good", or what needs
  attention with a link to its section: alerts of the last 24 hours (Overview), database updates not applied (System),
  mail not set up (System, from the server's `selfServiceReset`). Stage C adds the outdated Collect Earth versions.
- **Settings saved per group** (`web/src/pages/ServerSettings.tsx`): Access (sign-up, two-step sign-in, who creates
  projects; the switches no longer save on their own), Limits, About this server, Announcement, AI assistant: each with
  what it affects, its own Save and Discard, "Changes not saved" while edited, "Saved." after; saving one group keeps
  what is changed in the others. Changes not saved (`web/src/unsavedChanges.ts`): the browser asks before closing or
  reloading, and the app before moving elsewhere (`setLeaveGuard` in `router.navigate`): "Leave without saving?" names
  the groups, Stay or Leave without saving.
- Texts in en/es/fr/pt/tr. Checked: `serverView.test.ts`, `unsavedChanges.test.ts`, `router.test.ts`, and in a browser
  (the five sections and their addresses, the health line naming mail not set up, two groups changed and one saved, the
  other kept, the question before leaving, Stay and Leave, the tabs at phone width).

## Stage B, as built (12 Nov 2026)

- **Accounts' dates and address**: `UserSummary` has `createdAt`, `lastActiveAt` (a sign-in or a session used: the
  dashboard or Collect Earth, written with the session's use at most once per `SESSION_TOUCH_MS`; migration
  `040_user_last_active.sql`, filled once from the sessions there are), `email` and `emailConfirmed`. (039 is the
  repeat survey's `039_period_answers.sql`, merged after these: the migrations are applied by name, each once, so a
  database that already has 040 to 042 takes 039 when it comes.)
- **The list** (`src/accounts.ts`, `GET /v1/admin/users?q=&filter=&sort=&desc=&page=&pageSize=`): searched by name or
  address, filtered (all, administrators, disabled, with or without two-step sign-in, inactive for 90 days, without an
  email), each filter's count, sorted by name, creation, last activity or projects, in pages of up to 200;
  `GET /v1/admin/users.csv` the same, every page (no project names). Done in the route over `listUsers`: fine for tens
  of thousands of accounts.
- **Accounts made by an administrator** (`POST /v1/admin/users { accounts: [{ username, email? }], mail, language }`, up
  to 100, also when sign-up is closed): each with a password nobody knows and a link to choose one, valid seven days;
  mailed to the address given when the server sends mail (`welcomeMail`, en/es/fr/pt/tr, then not shown to the
  administrator), else given to pass on. A taken name is reported, not made.
- **Server administrators** (`POST /v1/admin/users/:uid/platform-admin { on }`, `setPlatformAdmin` in both stores, under
  the lock `disableUser` takes): not one's own role, never the last enabled one.
- **Sign out everywhere** (`POST /v1/admin/users/:uid/sign-out`): every session, Collect Earth's included; not one's own.
- **Delete** (`DELETE /v1/admin/users/:uid { confirm: username }`): as the person could (`accountDeletionPlan`): refused
  for one's own account, the last administrator, and the only coordinator of a project others work in (the project ids
  told); the projects only it was in go with it; the plots it collected stay under its name.
- Each change is written to the server log (`account.admin.granted`, `account.signed_out`, `account.deleted`,
  `accounts.created`, `accounts.exported`); stage C's activity log will keep them.
- **Dashboard** (`web/src/pages/ServerAccounts.tsx`, `web/src/serverAccountsView.ts`): the search (as typed), the
  filters as chips with their counts, the order, "Accounts 1 to 25 of 32" and the pages; each account with its badges
  (you, administrator, disabled, two-step sign-in), its address (or not confirmed), its projects count, when made and
  last active ("3 hours ago"); its actions in a menu (reset link, make or remove administrator, turn off two-step
  sign-in, sign out everywhere, disable or enable, delete), each confirmed in a dialog saying what it does, the delete
  once the username is typed; "Add accounts" (one per line, "username, email", the mistakes named by line before
  anything is sent, then each account's link or "mailed"); "Download as CSV". Texts in en/es/fr/pt/tr.
- Checked: `test/adminAccounts.test.ts` (the list, the CSV, the accounts made and their links, a mail in Spanish, the
  administrator role, signing out, deleting), `serverAccountsView.test.ts`, the server and web suites;
  `npm run smoke:pg:accounts` on PostgreSQL 16 (040 twice and its backfill, the dates, the list and CSV, two
  administrators taking each other's role at once: one stays, signing out, deleting with a project); and in a browser
  (a mistake named by line, 30 accounts made with one name taken, the pages, the search, the filters, the CSV, an
  administrator made, signed out, an account deleted once its name was typed).

## Stage C, as built (12 Nov 2026)

- **Projects directory** (`src/serverOps.ts`, `GET /v1/admin/projects`, `listAdminProjects` in both stores, each project
  read under its own RLS setting): every project by id with its status, creation, last activity (a member seen, a sync,
  a record stored), space, people, coordinators whose account is enabled and those active in 90 days; searched by id,
  filtered (all, needing a coordinator, a status) with each filter's count, ordered, in pages. **Needs a coordinator**:
  not archived, and no enabled coordinator active in 90 days. **Archive** (any status) or **restore** (as closed, its
  coordinator reopens it), and **hand to a coordinator** (an enabled account the administrator names by username: it joins
  as coordinator, or a member becomes one; the reference copies follow): both written in the project's own log too
  (`settings.changed` / `member.role` with `byServerAdmin`), so its people see a server administrator did it. Project
  names never leave the server.
- **Server activity log** (migration `041_server_activity.sql`, `src/serverActivity.ts` `logServerAction`, written by
  every administrator route as well as the server log): settings changed (which ones; a switch or number with its new
  value, a text only named), accounts made, disabled, enabled, made or unmade administrator, signed out, deleted, given a
  reset link (or mailed one), two-step sign-in turned off, the account list downloaded, projects archived, restored or
  handed over, test emails. The actor's and the account's usernames are kept as they were, so an entry still reads once
  the account is deleted. `GET /v1/admin/activity` by person and kind, in pages, and as CSV. Never a password or a link.
  Kept for good (a server makes a few entries a day).
- **Collect Earth versions in use** (`GET /v1/admin/versions`): the Collect Earth each account used last in the last 30
  days (the User-Agent `member_activity` keeps), by version, newest first; older than the latest (the optional
  `COLLECT_EARTH_LATEST_VERSION`, else the newest in use) and the old releases that sent no version are outdated, and the
  health line names how many accounts use one (System).
- **Mail check and test email** (`GET /v1/admin/mail`, `POST /v1/admin/mail/test`, in `routes/mail.ts` beside the
  mailer): whether the server sends mail, from which address, through which mail server (host and port, never its user
  or password), whether the weekly job is set up; "Send me a test email" to the administrator's own address in their
  language (`testMail`, en/es/fr/pt/tr; at most 10 an hour per instance), the mail server's refusal told by its codes;
  the weekly emails stopped after the mail server refused the address three weeks in a row.
- Local mode: the new routes, and stage B's, are in `LOCAL_OFF_ROUTES`.
- **Dashboard**: Projects (`web/src/pages/ServerProjects.tsx`): the directory, which replaces the largest projects list
  (sorted by space it says the same), above the AI use; System (`web/src/pages/ServerOperations.tsx`): the figures, the
  versions, email, and the activity log (its sentences in `web/src/serverOpsView.ts`). Texts in en/es/fr/pt/tr.
- Checked: `test/serverOps.test.ts` (the directory's query, needing a coordinator, the versions and their order, the CSV;
  the routes: admin-only, no project names, archive and restore with the project's log, hand-over refused for an unknown
  or disabled account and an existing coordinator, the log filtered and paged, a setting saved unchanged not kept, a
  deleted account's name kept, the mail check without secrets, the test mail in French and refused with its codes),
  `serverOpsView.test.ts`, `serverView.test.ts`, the server and web suites; `npm run smoke:pg:ops` on PostgreSQL 16 (041
  twice, RLS, the directory across projects, archive, restore, hand-over and the project's log, the activity log and its
  CSV, a deleted account's name, the versions, a stopped weekly mail); and in a browser (made-up data: the health line
  naming 2 accounts on an outdated Collect Earth, the project needing a coordinator, a wrong username refused, then handed
  to ana, a project archived, the versions, email not set up, the activity log filtered by kind and its CSV, phone width).

## Stage D, as built (12 Nov 2026)

- **Alerts kept** (migration `042_alerts_and_locks.sql`, `owner_alerts`; `ownerNotifier` writes each alert raised, then
  mails it and posts it): `GET /v1/admin/alerts` in pages with how many are not seen, `POST /v1/admin/alerts/seen` one,
  several or all; the health line names the alerts not seen (no longer those of the last 24 hours). **Thresholds** are
  server settings (`alertFailedLogins`, `alertServerErrors`, `alertSyncErrors`, `alertStoragePercent`), read at start,
  every five minutes and at once after a change on this instance. **Webhook** (`src/alertWebhook.ts`,
  `alertWebhookUrl`): Slack or Microsoft Teams incoming webhooks only (`hooks.slack.com`, `*.webhook.office.com`,
  `*.logic.azure.com`, `*.api.powerplatform.com`, https, no other port, no redirects, five seconds), so the setting
  cannot make the server call its own network; Slack gets `text`, Teams `text` and an Adaptive Card; the alert in
  English with a project by its id only (the channel is outside the server). Never read back: the settings say its
  service and host (`alertWebhook`), the activity log "changed". "Send a test" posts to the address typed or saved.
- **Message all coordinators, or everyone** (`POST /v1/admin/messages/preview`, `POST /v1/admin/messages`, in
  `routes/mail.ts`; `adminMessageMail`): the administrator's subject and plain text (paragraphs), then who it went to and
  the dashboard's address in each person's language; to the enabled accounts with a confirmed address (coordinators: of
  at least one project); the preview says how many, and the send must carry that count (else it asks again); one an
  hour, read from the activity log (`message.sent`, with the subject and count), so it holds across instances and
  restarts; sent in the background.
- **Sign-up and sign-in rules** (settings): `signupDomains` (open sign-up needs an address of one of them or their
  subdomains; invitations and accounts made by an administrator are not limited), `minPasswordLength` (8 to 64, for
  sign-up, a change, a reset and an invitation's account; said in `/v1/server-info` so the forms check it), and the
  **lock** (`loginLockFailures`, 0 = off, for `loginLockMinutes`): `users.failed_logins` and `users.locked_until`
  (migration 042), counted in one statement (failures at once never miss it), checked before the password (a guess during
  the lock says nothing), on every instance. A right password clears the count; a reset link and an administrator
  ("Unlock", `POST /v1/admin/users/:uid/unlock`) lift the lock. A locked sign-in answers 429 `account_locked` with
  `retry-after`; the dashboard and Collect Earth (`CloudLoginDialog.accountLocked`, 5 languages) say so in words.
- **Dashboard**: Overview's alerts card (new ones marked, "Mark as seen", "Mark all as seen", who saw each, pages,
  where they are posted); Settings: "Sign-up and sign-in rules" and "Alerts" groups, each checked as typed
  (`web/src/serverSafetyView.ts`); Accounts: the Locked badge and filter, "Unlock", "Send a message" (write, preview with
  the count, send; `web/src/pages/ServerMessage.tsx`); the sign-up form names the domains and the shortest password.
  Texts in en/es/fr/pt/tr.
- Checked: `test/serverSafety.test.ts` (the webhook's hosts, the domains; the webhook never read back or logged, its
  test; alerts at a threshold set, kept, posted, mailed, seen; sign-up by domain and the shortest password; the lock,
  unlocked by an administrator and by a reset, off at 0; the message's recipients, languages, count check and hour),
  `serverSafetyView.test.ts`, `serverOpsView.test.ts`, the server and web suites, `MessagesBundleTest`;
  `npm run smoke:pg:safety` on PostgreSQL 16 (042 twice, RLS, the settings, three failures at once locking, unlock, the
  count cleared, an alert kept and seen, a message sent then refused within the hour); and in a browser (a locked
  sign-in, the sign-up form with its domain and length, the alert in the health line then seen, the locked filter and
  Unlock, the message preview, the two settings groups with a bad value refused, the webhook's secret never on the
  page, the activity log, phone width).
