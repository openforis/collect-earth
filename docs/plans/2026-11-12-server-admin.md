# The server administrator's page: sections, accounts, operations, safety

Date: 12 November 2026. **Status: stage A built; the others planned; built in stages on the working branch (`claude/awesome-bell-s34gb0`), merged
into `ce-2026-GEW` when the owner says so.**

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
