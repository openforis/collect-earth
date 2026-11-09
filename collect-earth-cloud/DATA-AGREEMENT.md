# Data agreement for a Collect Earth Cloud project (template)

One page per project, agreed before collection starts, by whoever owns the data and whoever runs the server. Fill in the
parts in *[brackets]*; delete what does not apply. It is not legal advice: where national law sets rules on the data
(forest inventory data, personal data), those rules win, and someone who knows them should read this page.

The facts in normal type are what Collect Earth Cloud does; check them against the server you use (DEPLOY.md).

---

**Project:** *[name, country, period of collection]*
**Agreed on:** *[date]* **Review on:** *[date, at the latest at the end of the project]*

## 1. Who owns the data

- **The data belongs to:** *[the institution, e.g. the national forest service]*.
- **The server is run by:** *[the institution or team that runs Collect Earth Cloud, e.g. FAO, a national IT
  department]*, on the owner's behalf, for this project only. It does not use the data for anything else.
- **Contact for the data:** *[name, role, email]*. **Contact for the server:** *[name, role, email]*.

## 2. What data there is

| Data | Examples | Sensitive? |
| --- | --- | --- |
| **The plots** | the plot files (ids, **coordinates**, extra columns), the survey | Plot locations of forest inventories are often confidential: *[yes / no]* |
| **The answers** | land use, cover, changes, comments; the reviewers' decisions | *[yes / no]* |
| **The people** | usernames, email addresses (optional), when each person worked, how long they spent on each plot, their quality figures | Personal data under most data-protection laws |
| **The activity log** | who downloaded, invited, removed, changed what, and when | Personal data |

## 3. Where it is stored

- **Server and database:** *[Google Cloud project and region (the guided setup uses europe-west1, Belgium), or the
  institution's own servers (SELF-HOSTING.md)]*.
- **If the data must stay in the country:** *[say so; then the server must be self-hosted in the country, or in a
  cloud region inside it]*.
- **Backups:** in the same project and region as the database: every night, kept 7 days; monthly copies kept
  *[12]* months, if set up (DEPLOY.md, "Backups").
- **On the collectors' computers:** Collect Earth keeps each person's own records in its local database, and their
  sign-in (protected with Windows' data protection on Windows).

## 4. Who sees what

| Who | Sees |
| --- | --- |
| **Collectors** | their own plots and records, and the figures of the project shown to them |
| **Reviewers** | every record of the project, to check them |
| **Coordinators** | everything of the project, can download it all, invite and remove people |
| **The server's administrators** | the server's settings and accounts; they can reach the data through the database |
| **Google** (if hosted there) | stores the data as a processor, under the Google Cloud terms the server's owner accepted |
| **The AI provider** (only if the AI assistant is switched on) | what the assistant sends: figures and the survey's structure, with people pseudonymised and no coordinates (DEPLOY.md, "AI assistant") |

- **Coordinators of this project:** *[names]*.
- **Server administrators:** *[names]*.

## 5. Downloads and sharing

- **May download the data:** *[the coordinators only / also ...]*. Every download is noted in the project's activity
  log (who, when, which file).
- **Plot locations:** *[may be shared / are shared only without locations]*. The Data tab and the stand-alone
  analysis file can leave them out ("Leave out where the plots are").
- **The stand-alone analysis file** opens anywhere and is easy to pass around: *[who may receive it]*.
- **Progress links for funders** show figures only, never answers, people or places.
- **Sharing with third parties** (researchers, other institutions): *[only with the owner's written consent]*.

## 6. How long it is kept

What the server does, and what the project decides:

| Data | The server keeps it | The project decides |
| --- | --- | --- |
| Records, plot files, survey, decisions, activity log | until the project is deleted | delete the project *[N months]* after the end of collection, once the owner has its copy |
| Backups of a deleted project | daily backups: 7 more days; monthly copies: until they expire (*[12]* months) | — |
| An account (username, email) | until the person or a server administrator deletes it | delete the accounts of people no longer collecting *[after N months]* |
| A former member's name on their records | until a coordinator anonymises it (People tab, "Former members": it becomes "former-member-N") | anonymise former members *[at the end of the project / N months after they leave]* |
| Sign-ins | 90 days without use, then they stop working (`SESSION_IDLE_DAYS`) | — |
| The server's log (Cloud Logging, if hosted on Google Cloud) | 30 days by default | — |

**At the end of the project:** the owner downloads the data (Data tab) and the Collect Earth backup, checks that they
open, then a coordinator or server administrator deletes the project. *[Who does it, by when.]*

## 7. The people who collect

- They are told, on *My work*, what is recorded about them and who sees it.
- *[How they were informed and agreed, if the law asks for consent; who answers their questions about their data.]*
- A person who leaves can ask for their name to be removed from their records: a coordinator anonymises them.

## 8. If something goes wrong

- **A lost or shared laptop:** a coordinator opens the person's page and chooses *Sign out everywhere*; the person
  signs in again with their password.
- **A suspected break-in, or data shared by mistake:** tell *[contact]* within *[24 hours]*. The server's owner gets
  alerts of many failed logins (DEPLOY.md, "Alerts for the server's owner"); the activity log shows the downloads.
- **Data lost or damaged:** the server's owner restores from the backups (DEPLOY.md, "Backups").

## Agreed by

| For | Name | Role | Date |
| --- | --- | --- | --- |
| The data's owner | | | |
| The server | | | |
