# Your own Collect Earth Cloud server, on Google Cloud

This guide is for coordinators who want their own Collect Earth Cloud server and
have never put anything on the internet before. You do not need to install
anything or type commands from memory: you press a button, click through a
step-by-step panel, and paste one command.

The same steps serve two cases:

- **A private server** for your organisation: only the people you invite use it.
- **A public server** that anyone may use, like the free default server run by
  the Collect Earth team. See [Running a public server](#running-a-public-server)
  at the end.

Technical readers: [DEPLOY.md](DEPLOY.md) lists exactly what is created, and how
to do the same by hand or on any other host.

## What you get

- A **web dashboard** at an address of your own, where coordinators create
  projects, upload the project file and the plot files, invite people and
  download the collected data.
- A **sync service** that Collect Earth on each collector's computer talks to:
  people join a project with an invitation link and their plots are sent to the
  server as they work.
- A **database** that keeps everything, with an automatic backup every night.

All of it runs in *your* Google Cloud project. Nobody else, including the
Collect Earth team, can see your data.

## What it costs

You pay Google for what the server uses, every month, on the payment card of your
Google Cloud *billing account* (see below). For a typical project:

| What | What it is | About, per month |
| --- | --- | --- |
| Database (Cloud SQL, smallest machine `db-f1-micro`) | Stores all projects and plots; runs all the time | 8 to 10 US$ |
| Database disk (10 GB) and backups | Space for the data and the last 7 nightly copies | 2 to 3 US$ |
| Server (Cloud Run) | Runs only while someone uses it | 0 US$ (inside the monthly free allowance), a few cents when busy |
| Building new versions, stored versions, secrets | Each time you install or update | 0 to 0.50 US$ |
| **Total** | | **about 10 to 15 US$** |

The exact amount depends on the region you choose and on how much the server is
used. Google changes its prices from time to time; the current prices are on the
[Cloud SQL pricing](https://cloud.google.com/sql/pricing),
[Cloud Run pricing](https://cloud.google.com/run/pricing) and
[Google Cloud pricing calculator](https://cloud.google.com/products/calculator)
pages. To be warned if the cost goes up, set a
[budget alert](https://cloud.google.com/billing/docs/how-to/budgets) on your
billing account (it sends you an email; it does not stop anything).

New Google Cloud accounts often receive free credit for their first months.

## Before you start: a Google account, Google Cloud and billing

- **Google account**: any Gmail or Google Workspace account. If your organisation
  uses Google Workspace, use your work account so the server belongs to the
  organisation.
- **Google Cloud** is Google's service for running servers. You open it at
  [console.cloud.google.com](https://console.cloud.google.com) with your Google
  account; the first time it asks you to accept its terms.
- **Project**: a container in Google Cloud for everything that belongs to one
  purpose, with its own bill. The guide helps you create one; use a new project
  just for this server.
- **Billing account**: how Google Cloud charges you, a payment card linked to your
  projects. Create one at
  [console.cloud.google.com/billing](https://console.cloud.google.com/billing).
  In many organisations someone in IT or finance already manages one: ask them to
  link it to your project.

## Install it

Press the button. It opens **Cloud Shell** (a terminal: a small computer in your
browser, provided by Google for free, already logged in with your account) with
the Collect Earth code and a step-by-step panel on the right.

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/openforis/collect-earth&cloudshell_git_branch=master&cloudshell_workspace=collect-earth-cloud&cloudshell_tutorial=deploy/gcp/tutorial.md&show=terminal)

> The button works once this guide is part of the `master` branch of the
> Collect Earth repository.

What to expect, step by step:

1. **"Open in Cloud Shell" / "Trust repo"**: Cloud Shell asks whether you trust
   this repository. Tick **Trust repo** and click **Confirm**. (If you do not, the
   terminal opens without your Google credentials and the installation cannot
   work.)
2. **The panel on the right** asks you to pick or create a project, and checks
   that billing is on. Follow it.
3. **"Authorize Cloud Shell"**: when the first command runs, Google may ask you to
   allow the terminal to act with your account. Click **Authorize**.
4. **Run the command** from the panel (click its copy button, then press Enter in
   the terminal):

   ```bash
   bash deploy/gcp/deploy.sh
   ```

5. **It asks where the server should run.** Choose the place nearest to the
   people who will use it; press Enter for Belgium (`europe-west1`). Then it shows
   what it will do and asks **Continue?**: press Enter.
6. **It works through 8 steps**, printing each one. Creating the database takes
   **about 10 to 15 minutes** and building the server 3 to 6 more. Keep the tab
   open; you can do something else meanwhile.
7. **At the end it prints the dashboard address and the setup code.** Write them
   down.

If a step fails, the script stops, says in plain words what went wrong and what
to do, and leaves everything else as it was. Fix the cause (often: billing is not
on, or your account does not have the *Owner* role on the project) and run the
same command again; it continues where it stopped.

## The setup code

The **setup code** (like `K7QX-M3TB-WN`) proves that you are the person who
installed the server: until someone has used it, anyone who finds the address
could otherwise claim the new server. It is needed **once**.

To see it again, open Cloud Shell (the same button) and run:

```bash
bash deploy/gcp/deploy.sh --show-setup-code
```

It is also kept in your project in **Secret Manager**, under the name
`ce-setup-code` ([open Secret Manager](https://console.cloud.google.com/security/secret-manager)).

## First steps in the dashboard

1. **Setup.** Open the dashboard address. It asks for the setup code and for the
   user name and password of the server administrator, which is you. After this
   you log in with that user name and password.
2. **Server settings.** Open **Server** (at the top). Under *Who can do what*:
   - *Anyone can create an account*: leave it off for a private server. People
     then get an account only through an invitation link to a project.
   - *Who can create projects*: *Only server administrators* (you) or *Everyone
     who has an account*.

   You can also give the server a name and a contact email shown on every page.
3. **Your first project.** Open **My projects** → **New project**. The project
   page shows a checklist: upload the project file (`.cep`), add the plot files,
   invite people, give each person their plot files, then follow the progress.
4. **Invite people.** Each invitation is a link. Collectors install Collect
   Earth, choose **File → Join cloud project…** and paste the link. The dashboard
   shows them the exact steps.

Forgotten passwords: as server administrator, open **Server** → *Accounts* →
**Make a reset link** for that person, and send them the link. If your server sends
email (DEPLOY.md, "Weekly emails (optional)"), people whose account has a confirmed
email address can also use **Forgot your password?** on the log-in page themselves.

## Backups

The database makes a **backup every night** and keeps the last 7. It also keeps
a record of every change for 7 days, so it can be put back as it was at any
minute of the last week (*point-in-time recovery*). The database is also
protected against being deleted by mistake.

To restore: ask whoever manages your Google Cloud, or follow
[Restore from a backup](https://cloud.google.com/sql/docs/postgres/backup-recovery/restoring)
in the [Cloud SQL console](https://console.cloud.google.com/sql/instances)
(database `ce-cloud-db` → *Backups*). Restoring replaces the current data with
the copy, so download what you need from each project's **Data** tab first.

For your own safety copy, each project's **Data** tab downloads everything
collected as one spreadsheet file.

## Updating

When there is a new version, press the **Open in Cloud Shell** button again and
run the same command:

```bash
bash deploy/gcp/deploy.sh
```

(If you open [Cloud Shell](https://shell.cloud.google.com) without the button,
first go to the folder printed at the end of the installation, usually
`cd ~/cloudshell_open/collect-earth/collect-earth-cloud`.)

It downloads the latest code, rebuilds the server and switches to it in about
5 minutes. It does not ask the questions again, and your data stays: the
database is never recreated. People using it at that moment do not notice.

## Your own address (optional)

The dashboard address given by Google looks like
`https://collect-earth-cloud-123456789.europe-west1.run.app`. It works fine and
is secure. To use an address of your organisation, like
`https://cloud.example.org`, you need a domain name you control, then:

```bash
bash deploy/gcp/deploy.sh --domain cloud.example.org
```

The script tells you which records to add in the settings of the company where
the domain was bought (its *DNS* settings). Google first asks you to prove you own
the domain, once, with `gcloud domains verify example.org`. This works only in some
regions (Belgium `europe-west1` and Iowa `us-central1` among them); the script
says so if yours is not one of them.

## Deleting everything

To stop all costs, delete the Google Cloud project. This deletes the server and
the database **with all the data collected**: download each project's data first.

1. Open [Manage resources](https://console.cloud.google.com/cloud-resource-manager).
2. Select the project and click **Delete**, then type its ID to confirm.

Or, in Cloud Shell: `gcloud projects delete YOUR-PROJECT-ID`.

Google keeps a deleted project for 30 days, in case you change your mind (you can
restore it from the same page), then removes it for good. Billing stops when you
delete it.

## Getting help

If something does not work, copy the messages shown in the terminal and the
dashboard address, and ask in the
[Collect Earth issues](https://github.com/openforis/collect-earth/issues) or your
usual Collect Earth contact. The server's own log is shown by:

```bash
gcloud run services logs read collect-earth-cloud --region europe-west1 --limit 50
```

(use your region instead of `europe-west1`).

## Running a public server

The free default server that Collect Earth offers to everyone is installed with
exactly the same button and command, in the hosting organisation's own Google
Cloud project. What changes is a few settings in the dashboard's **Server** page,
after setup:

- **Anyone can create an account**: on, so people sign up by themselves.
- **Who can create projects**: *Everyone who has an account*.
- **Limits for each account**: the most projects one person can coordinate, and
  the most space for one project (in MB). 0 means no limit. Collected plots are
  always received, even when a project is full; only new uploads by its
  coordinators are refused.
- **About this server**: the server name, a **terms of use** web address (when it
  is filled in, people must accept the terms to create an account) and a
  **contact email** shown on every page.

For a busy public server, start with a bigger database machine (about 30 to 40
US$ a month instead of 10 to 15):

```bash
bash deploy/gcp/deploy.sh --db-tier db-g1-small
```

This only applies when the database is created. The server itself grows on its
own with the number of users, up to 4 copies running at once; see DEPLOY.md to
change that, and set a [budget alert](https://cloud.google.com/billing/docs/how-to/budgets).
