# Your own Collect Earth Cloud server

<walkthrough-tutorial-duration duration="30"></walkthrough-tutorial-duration>

This guide puts a private Collect Earth Cloud server in your own Google Cloud
project. Coordinators use its web dashboard to run projects; the people who
collect data join from Collect Earth on their computers.

You run **one command**. It asks you a single question (where the server should
run) and does everything else. Most of the time is spent waiting while Google
Cloud creates the database (about 15 minutes).

**What it costs:** about 10 to 15 US dollars a month, almost all of it for the
database. Google charges your billing account; prices change, see
[Cloud SQL pricing](https://cloud.google.com/sql/pricing) and
[Cloud Run pricing](https://cloud.google.com/run/pricing).

Click **Start** to begin.

## Choose the Google Cloud project

A *project* is a container in Google Cloud for everything that belongs to one
purpose. We recommend a new project used only for this server, so it is easy to
see its cost, and to delete everything later.

<walkthrough-project-setup billing="true"></walkthrough-project-setup>

Then tell the terminal (the black panel below) to use this project. Click the
copy button on the command and press Enter in the terminal:

```bash
gcloud config set project <walkthrough-project-id/>
```

If Cloud Shell asks to *Authorize*, click **Authorize**: it lets the terminal act
with your Google account.

## Turn on billing

Google Cloud needs a *billing account* (a payment card) before it can create the
database. If the project picker above said billing is on, go to the next step.

Otherwise open
[Billing for this project](https://console.cloud.google.com/billing/linkedaccount)
and link a billing account, or create one. New Google Cloud accounts often get
free credit for the first months.

You can also skip this: the script checks billing and, if it is off, offers to
link one of your billing accounts.

## Run the deployment

Run this command in the terminal:

```bash
bash deploy/gcp/deploy.sh
```

It shows the project it will use and asks:

1. **Where the server should run.** Pick the place closest to the people who
   will use it (press Enter for Belgium, `europe-west1`).
2. **Continue?** Press Enter.

Then it works through 8 steps and prints each one. The database step takes about
**10 to 15 minutes**, and building the server 3 to 6 more. Leave this tab open.

If something goes wrong, the script stops and explains what to do in plain
words. Nothing is deleted; you can run the same command again.

<walkthrough-footnote>The terminal is not in the right folder? Run
`cd ~/cloudshell_open/collect-earth/collect-earth-cloud` first.</walkthrough-footnote>

## Open your dashboard

At the end the script prints:

- the **dashboard address**, like `https://collect-earth-cloud-123456789.europe-west1.run.app`
- the **setup code**, like `K7QX-M3TB-WN`

Click the address (or copy it into your browser). Bookmark it: this is your
server.

Lost the setup code? Show it again with:

```bash
bash deploy/gcp/deploy.sh --show-setup-code
```

## Create the administrator

The first time the dashboard opens it shows the **setup** page:

1. Type the setup code (capitals, spaces and dashes do not matter).
2. Choose the user name and password of the server administrator: you.

The code works only once. From now on you log in with that user name and
password.

## Your first project

1. Open **Server** and choose who may create accounts (only people you invite,
   or anyone) and who may create projects.
2. Go to **My projects** and click **New project**.
3. Follow the checklist on the project page: upload the project file (`.cep`),
   add plot files, invite people, give each person their plot files.

Each invitation is a link. The people who collect data open Collect Earth,
choose **File → Join cloud project…** and paste it.

## Updating later

When a new version of Collect Earth Cloud is out, open Cloud Shell again (the same
button), and run the same command:

```bash
bash deploy/gcp/deploy.sh
```

It downloads the latest code and updates the server. Your data stays: the
database is never recreated.

## Deleting everything

To stop all costs, delete the Google Cloud project. Everything in it is deleted,
including the database **and all the data collected**, so download what you need
first (each project's **Data** tab).

```bash
gcloud projects delete <walkthrough-project-id/>
```

Google keeps a deleted project for 30 days in case you change your mind, then
removes it for good.

## Done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Your Collect Earth Cloud server is running. The full guide, with backups and
costs explained, is in `SELF-HOSTING.md`:
<walkthrough-editor-open-file filePath="SELF-HOSTING.md">open SELF-HOSTING.md</walkthrough-editor-open-file>.
