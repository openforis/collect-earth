# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Security
- Dependencies brought up to date after a review of the Dependabot alerts
  - Before the 2.0 release, every library of Collect Earth at its newest stable version, so that fewer are left to update
    after it: sqlite-jdbc 3.54.1.0, the PostgreSQL driver 42.7.15, Selenium 4.54.0, Sentry 8.66.0, JNA 5.19.1,
    Jackson 2.23.0, commons-lang3 3.22.0, OpenTelemetry 1.68.0, Byte Buddy 1.18.17, json-smart 2.6.1, GeoTools 35.2
    (from 24.7: its TransformException moved to org.geotools.api), POI 6.0.0 for the IPCC and uncertainty Excel files
    (a test now writes the IPCC land use matrix and reads it back), the tests' JUnit 5.14.5, Mockito 5.25.0, json-path
    2.10.0 and Hamcrest 3.0, and the build plugins; the plots map's MUI 9.6, Vite 8.4 and Vitest 5.1. The installers
    bundle the JRE 21.0.13.1+2 and Node 24.22.3, the active LTS (supported until April 2028; 22 ends in April 2027),
    with which the local dashboard and Collect Earth Cloud's tests pass. Collect (4.0.111), commons-io, HttpClient
    5.6.5 and Log4j 2.26.1 are the newest already; Spring 5.3 and Jetty 10 stay, as their next versions need
    the Jakarta servlet API, which Collect has not moved to; Log4j 3 and the Maven 4 plugins are not released yet
  - Collect Earth Cloud runs on Fastify 5 (Fastify 4 has had no fixes since mid-2025) and its static files plugin 10: a client could write the forwarded headers itself, and several URL and validation checks could be bypassed. The proxies the server takes `x-forwarded-*` from are now checked by address as well as counted: by default this computer, link-local addresses (Cloud Run's front end) and private networks; `TRUST_PROXY_ADDRESSES` names others (DEPLOY.md). Its image runs Node 22 (Node 20 is out of support), and its tests Vitest 5
  - Collect Earth uses Collect 4.0.111, and so Java 17 like Collect (the installers already bundle Java 21); Spring stays at Collect's 5.3.39. The build's Maven plugins are Collect's versions, with Maven 3.6.3 or newer as Collect asks. Selenium's OpenTelemetry is 1.67 (1.66 could take quadratic time on a crafted trace header) and byte-buddy the 1.18.14 Selenium asks for (1.15.4 shipped)
  - Collect Earth Explorer's functions: Google's libraries updated within their versions; four moderate alerts remain, from `uuid` inside the Earth Engine library, which has no fixed release yet and is not reached (it concerns a buffer argument the library does not pass)
- Collect Earth Cloud: what each role sees and takes away, tightened after a review
  - A reviewer's Analysis page no longer names anybody (the collector column is empty and no per-person chart is offered), leaves out the records of the reference plots, and offers no stand-alone file (the server refuses it)
  - Keys and passwords are taken out of a project file when it is uploaded (`planet_maps_key`, `planet_maps_ce_key`, `google_maps_api_key`, `ga_api_secret`, `db_username`, `db_password`, the cloud tokens) and out of the file every collector downloads; the Project file tab says which were removed, and warns when the extra map's address carries a key
  - A collector reads the earlier periods' answers only of the plots given to them or that they assessed
  - An invitation made without an expiry lasts 30 days (`expiresInDays: 0` for one that never expires, which the dashboard's "never" sends)
  - A reviewer's Analysis page is now a summary counted on the server: the plots by the answers to one question, or to two, with their share and area. No row per plot reaches a reviewer (the record-level analysis and its files answer 403), and the change-between-periods CSV is for coordinators
  - A record kept under a typed name (a backup's, an import's) is no longer taken by whoever sends a save under that name: never when the plot is given to other people; of a plot given to nobody, only by a save no older than the record, or when the name has the person's own username in it ("Rosa Vidal" for rosa)
  - The earlier periods' answers go by who holds the plot, not by who has a record of it (anybody can send one): none for a plot given to other people only, for a collector or a project token
  - The review queue has no filter by person for reviewers (its counts were that person's differences and flags)
  - Nothing tells a reviewer which plots are reference plots: the change-between-periods comparison leaves them out, the areas page answers about the saved strata only (asking any column could list the plots one by one), and the project file reaches a reviewer with its plot files emptied, as it reaches a collector
  - A project token may no longer change or delete a record kept under an account's username or a name the server made: that record is the person's, changed with their sign-in (Collect Earth signs in; project tokens are the first projects' only)
  - Smaller: which project an earlier period came from, and who shared an analysis view, are told to coordinators only; a join link that no longer lets anybody in names no project
  - A coordinator who has not set up two-step sign-in where the server requires it no longer opens the analysis (the record-level data and its stand-alone file)
  - A project file that is no zip the server reads is refused (422 `not_a_project_file`) instead of kept as it came; one whose survey cannot be read is cleaned of keys too; files stored before are cleaned when anybody downloads them or when the project is copied; the warning about a key in a web address covers every address of the settings
- The Planet key is no longer part of the address sent to openforis.org when the monthly mosaics open: it goes after the `#`, which the browser keeps to itself, and the page takes it out of the address bar and the history. `resources/planet.html` reads both forms and has to be published at openforis.org/fileadmin/planet.html **before** this version is released: the page published today does not find the key after the `#`
- The files of Collect Earth's `generated` folder, `applicationContext.xml` with the database password among them, and `/openAuxiliaryWindows` answer only Collect Earth's own pages, not any web page open on the same computer
- The Planet Daily window no longer leaves a page holding the Planet key and the plot's place in the temporary folder for every plot (one per window is kept, deleted with the next), and its template errors no longer write the Planet or Google Maps key to the error log
### Added
- An introduction to the new interface, for people new to Collect Earth 2 and for those who knew Collect Earth 1. Each part shows once, and the installation remembers it (`intro_seen` in `earth.properties`), whichever browser the panel opens in
  - The screen at a glance: at the first start the panel is dimmed and its main controls are numbered and explained all at once (the menu, where the project keeps its data, the settings, Quit, the search and filters, the next plot to do, the list), with one button to close it; the same for a plot's form the first time one opens (the list, the arrows, the plot's state, the other imagery, the steps, the saving, the next step). A click anywhere or Esc closes it too
  - Tips: one line beside a control the first time it matters (a cloud project's label, the "To do" filter, the keyboard shortcuts, the dashboard, plots to correct, training plots), one at a time and never two within a minute; any click or key in the panel closes it, and "No more tips" switches them off
  - "What changed from Collect Earth 1": one page that says where each thing of the old program is now (the window, Google Earth Pro, the balloon, the other imagery, the colours of the list of placemarks, Saiku, working as a team), shown once to an installation that was in use before, and to anyone from Help
  - Help has "Show me around", "What changed from Collect Earth 1" and the switch "Show tips" (switched on again, the tips start over)
- Collect Earth Cloud: training the whole team on the same plots in the first days of a project, then throwing the training answers away (`docs/plans/2026-11-17-training-the-team.md`)
  - A new training set copies a number of plots (20 by default) from a plot file of the project, evenly spaced, with new ids, so the project's own plots stay to do (a second day's training from the same file gets other plots); uploading a plot file for the training is still possible. "Everyone in the project", ticked by default, takes in every collector and reviewer, those who join later too, never the coordinators. Setup > Overview suggests training the team first while nothing has been collected
  - A project still being set up (a draft) takes the training answers; its other records wait in Collect Earth until it is published
  - Collect Earth gets a new training within minutes, also while it runs: while the person holds no plots of their own yet (the first days), it opens the training's plots by itself and says so; otherwise it offers them (Open / Later), so nobody's work is switched away. The plots list says "Training plots: …" while they are open, and Settings › Project has "Back to my plots"
  - "Finish the training" on the Training tab offers the printable report first, then keeps the scores, the agreement figures and the golden answers as they are (the set stays, read-only) and deletes every answer given on its plots; an answer sent later by a computer that was offline is thrown away. At its next check (every five minutes) each person's Collect Earth deletes its own records of the training plots, takes the training file away and goes back to the person's own plots. Deleting a set does the same, without keeping its results. The Activity tab says who finished which training
- The window of the other imagery sources is no longer blank before the first plot: it shows the Collect Earth logo and asks to pick the first plot to interpret in the plots map, beside Google Earth Web
- Collect Earth Cloud: an invitation link opened in a Collect Earth already signed in to that server (for another project) joins with that account, without asking for the username and password again; "Use another account" still offers the login, which is also asked for when the sign-in has ended
- Collect Earth Cloud: the coordinator sets the plot layout and the imagery windows on the dashboard's Project file tab, and every collector's Collect Earth applies them by itself
  - "Plot layout": the choices of Collect Earth's Settings > Plot (the shape, the sampling points, the distances and the reference area), with the same ranges, the same fields for each shape, the rule that the reference area holds the plot, and the same drawing of the plot. Once data has been collected, saving asks first: plots already collected keep their answers, and answers per point may no longer line up when the number of points changes
  - "Imagery windows": the choices of Settings > Imagery (the Earth Engine app and its dates, Earth Map, ESRI Wayback, Planet's monthly mosaics and their months, the extra map's address), with the same rules. The Planet key is not there: it stays each person's own, and Planet opens for those who entered one
  - During the cloud sync, every two minutes, Collect Earth asks for both and writes the settings that differ: the plots are drawn again, the next plots open their windows with the new choices, and a notice says what changed ("The coordinator changed the plot layout: Circle, 9 sampling points"). The records, the other settings and the survey are not touched
  - On the server, only those keys of the project file's `project_definition.properties` are rewritten, in the file served and the one as uploaded; every other byte stays, and the people who had the file before still count as having it. A project file uploaded later brings its own. The Activity tab says "changed the plot layout settings" or "changed the imagery window settings"
- Collect Earth Cloud: dividing a plot file by percentage may add up to less than 100%: the rest of the plots is given to nobody until the file is divided again (give 10% to the first person now, share the rest when the others start)
- Collect Earth Cloud: more control for coordinators over the plots left to do
  - The People tab's "Who finishes when": each person's plots left, plots done, pace of the last 7 days and the day they would finish at it, who would finish last first, and a "Move plots…" on each row to give a number of their plots (or all) in a plot file to someone else
  - "Share again what is left" on a divided plot file's page: the plots not submitted yet shared again between the people ticked, equally, by percentage or by pace (so that everyone finishes around the same day), with a preview of each person's plots left before and after; someone unticked gives all theirs away
  - On the map, "Select plots": a rectangle drawn on the map selects plots, the panel says who holds the ones still to assess and in which plot file, and gives them to one person
  - Submitted work and reference plots never move; each change asks first, says what moved after, and is in the Activity tab
- The data entry form goes on to the next step by itself once the step is done with: nothing on it in error and every choice on it answered (an optional text or number left empty does not hold it). When the step and those after it are done with and nothing is in error anywhere, a big Submit stands in the middle of the form, with the keyboard on it. Enter in a text or number box goes on too. The steps' tabs, Back and Next, and Alt+Left/Right still move between steps by hand
- The data entry form moves on by itself: once a single-choice question (buttons, Yes/No or a list) is answered with the mouse, the next question still unanswered gets the keyboard and comes into view, so the next answer needs no scrolling (as it already did with the keys). The question being answered stands out on a white card with a blue bar, and Up and Down go to the question before or after (Left and Right still go from answer to answer)
- Google Earth Web replaces Google Earth Desktop (Google Earth Pro): Collect Earth opens Google Earth Web in a browser window, with its own plots map as a panel on the left (the plots coloured by status, a searchable list with an All / To do / Done filter and progress, the next plot to do, and the form); Google Earth Web flies to each plot and draws its outline and its sample points
- The form next to the plots map is generated from the survey, with the look of the Collect Earth balloon: tabs as steps with Back, Next and Submit, code buttons and searchable lists that follow their parent, tables, entity cards, units, ranges, dates, times and coordinates, saved as they are typed. Submit lists the errors of every tab with a link to each field. `web_form=balloon` in earth.properties brings back the balloon of the project instead
- A cloud database option (`CLOUD`), still experimental: the records are kept in the local SQLite database and sent in the background to a Collect Earth cloud server, where operators join a project and receive the plots assigned to them. The menu has "Join cloud project" and "Cloud sync status"
- Collect Earth lays out its two windows, the plots map and the imagery window, to give the imagery the most room. With two screens, the plots map and the form go on one and the imagery on the largest; on a single screen the form keeps a narrow strip and the imagery takes the rest, and follows the form when it is resized or moved. The layout is chosen in the options (`window_layout`: automatic, side by side, separate screens, or imagery full screen) and applied again when a screen is connected or removed. The plots map window opens without toolbars, and the plots map and the form shrink to fit small windows
- The other imagery sources share a window of their own, apart from Google Earth Web's, so that the plot stays in sight in Google Earth Web while they are looked through. With two screens or more and the automatic window layout, the form and Google Earth Web share the largest screen and the other sources are maximized on another; the layouts without a screen for them put their window under Google Earth Web's, and picking a source in the plots map brings it forward
- On Windows the window of the other imagery sources has a satellite icon on the task bar, so that it is not taken for the interpreter's own browser, and Google Earth Web's window, with the plots map in it, a green globe
- The form next to the plots map can be filled from the keyboard without waiting: an answer given with a number key moves on at once to the next question that needs one, across steps, and on to Submit once nothing is left; keys typed meanwhile are kept and pressed on the next question once the server has answered, or dropped if the answer changed what comes next. A plot opens on its first required question. A dropdown of six answers or fewer is shown as buttons, and a longer one moves on after Enter
- "Same as previous plot" (P) in the form fills the questions of the step left empty with the answers of the plot submitted last by the same operator in the same survey: choices and Yes or No only, marked "Copied" until each is looked at, to be checked rather than taken on trust
- In the plots map, Alt+1 to Alt+4 show Google Earth Web, ESRI Wayback, Earth Engine and Earth Map. A plot opened from the list, the map, the header's arrows or "Next unfinished plot" leaves the keyboard to its form. The plot search shows as a chip in the form's header, and a search that finds nothing in the filtered list says how many plots it finds under the other filters
- A number that is not one ("1.5x") stays as typed, marked, with what to type instead, and Submit is refused until it is corrected; it used to be saved as 1. The save state is announced to screen readers, and the answer the keyboard is on is ringed
- With Google Earth Web, the plot outline appears as soon as the camera has arrived (it sometimes waited up to 8 s) and no longer disappears for a moment when Google Earth Web rewrites its view. `gew_fly_animation=false` in earth.properties turns Google Earth Web's fly animation off, so that the camera jumps to each plot in about a second, from the first session on; only for surveys whose ground is known, since a plot higher than about 130 m is otherwise seen from under the ground. By default Google Earth Web flies to each plot and Collect Earth learns the height of the ground from where it stops
- In the panel of Google Earth Web and in narrow windows, the menus open as a drawer on the left, every entry with an icon, the everyday menus first and Utilities and Help folded, Quit last; the button that shows the plot list has a list icon of its own. The dialogs of the panel (About, Export, Settings' questions...) open in the middle of the Google Earth Web window, over the whole of it, instead of squeezed into the panel
- The analysis page can be downloaded as one HTML file that opens in any browser, with no internet connection, no server and nothing to install: the pivot table, the charts, the filters and the drill-through over a copy of the data, made when it is downloaded (a collector's file holds their own plots). It replaces the stand-alone Saiku tool, and works on every operating system, not only Windows

- A table in the form whose column a check of the survey adds up (such as `sum(parent()/land_cover/percentage) >= 90`) shows the column's total under it while the rows are filled in, with what the check asks ("at least 90 %") and what is missing or too much ("15 % to go", "5 % too many"), in red until it is met and with a tick once it is. A hidden column calculated from the answers, such as a percentage worked out from a coverage class, counts too, updated as each answer is saved. Only plain rules are read (a number compared with the sum, joined by "and"); a check with a condition or an "or" is left to Submit
- Joining a cloud project with Register asks for a password of at least 8 characters, as the server now does: the login dialog says so under the password, and a shorter one is refused in plain words, in the user's language, before the server is asked (it used to show the server's answer as "register failed with HTTP 400" and JSON)
### Changed
- Collect Earth Explorer loads ahead the plot the person opens next, the next one in the list not submitted yet (as the plots map goes on after a submit), instead of the next row of the plot file, which could be a plot already done: resuming part-way, or after plots came back for another look, the next plot now opens from the warmed store
- The Earth Engine window is now Collect Earth Explorer (https://explorer.collectearth.org/): `gee_app_url` is set to it on install and on every update, over the address a user had. It shows the plot, its id and the survey's dates as the Earth Engine app did, and the layers and charts a survey sets in `explorer_config` (on a cloud project's dashboard, or in the project file); without one, its standard window. The settings call it "Collect Earth Explorer". A plot id or survey name with spaces is now encoded with `%20`, as the Explorer reads it
- Settings › Imagery: the Explorer window's layers and charts are no longer typed as JSON. The field says what the window shows ("Standard window", or how many layers and charts) and Customize opens the Explorer's editor (`/configure` on the origin of `gee_app_url`, with a preview of the first plot of the plots file); Use this setup puts its document in the field, saved with Apply. The text field stays under Advanced for pasting a document, and "Back to the standard window" empties it. In a cloud project it is only shown, as set by the coordinator on the dashboard
- Plot files of up to 40,000 plots (Collect's limit was 2,000): the plots map no longer loads every plot's shape at once (some 8 KB a plot with its sample points: 20,000 plots made a 158 MB answer, and 100,000 ran out of memory). It loads an index of the plots (their ids, the names shown and their places, about 36 bytes a plot), and a plot's shape, its values and the outlines of the plots around it when it is opened. With 100,000 plots the list shows in under a second and a plot opens in a fraction of one; the generated form reads the plot's values from the same index instead of a copy of its own
  - Collect's warning past 2,000 plots (and its limit of 4,000), which were Google Earth Pro's, are no longer shown; the limit is now 40,000 plots in a file, more than enough for nearly every survey: past it a warning says a larger file opens more slowly, and the file is still used (500,000 plots were measured to work)
  - The list draws only the rows in view, so it costs nothing to keep every plot in it, and the next plot is found from the statuses as before
- Collect Earth Cloud, faster and lighter under load (from a load test of 2 mapathons of 30 people with real Collect Earth instances): a sync's records are written in one transaction and a few statements instead of six or more per record; the database connections the server opens are set with `PG_POOL_MAX` (DEPLOY.md); answers of 1 KB or more of JSON, CSV or text are gzipped for the clients that ask (the dashboard's pages shrink to a tenth to a third, plot files to a third; Collect Earth already sent its records gzipped); one log line per request instead of two, and none for Collect Earth's routine sync calls that went well. The load test itself: `npm run load:mapathon` and `scripts/load-desktop.mts`
- Planet imagery has its "Open Planet imagery" switch again, as the other imagery windows have (`open_planet_maps`, on unless it says false, so projects without it keep opening Planet by its key); turned off, Planet stays closed and the key is kept. In a cloud project the coordinator sets it on the dashboard with the other windows; the key stays each person's own
- Planet imagery, in Settings > Imagery and on the dashboard's imagery windows: a choice between "Daily images" and "Monthly mosaics (Tropical Forest Observatory)" instead of a switch named after the mosaics, next to the key; the months are the first and last mosaic, and the explanations say plainly what each shows and that a blank key keeps Planet off
- The usage analytics are anonymous: they send a random id made once for each installation, where they sent a hash of the operator's name
- Settings: four tabs instead of six. The browser choice is at the top of Project (Advanced had nothing else), and the cloud project's server, project and token are under Data storage, next to the choice that stores the data in the cloud (Collaboration showed nothing else). Each setting's explanation is behind an (i) next to its name instead of under the field, and the plot layout's fields sit two by two with a smaller preview beside them that stays in view. The from and to dates of the imagery sit side by side, Restore defaults is on the tabs' row, and the computer's address shows only for a PostgreSQL database, which is what it is for
- Collect Earth: with several plot files assigned, the message after joining a cloud project lists them, each with its number of plots, to pick the one to work on directly (or Later, in Settings > Project); a learning set is offered the same way, saying that taking it starts a new attempt
- Collect Earth Cloud: a collector who joins a project gets its project file with the plot files emptied (their header line only); coordinators and reviewers still get the whole file. The full list of plots never reaches a collector's computer: they get only their assigned plot files
- Collect Earth Cloud: after joining a cloud project (or opening it again), a collector gets their assigned plots without going to the settings: the first start asks the server for their plot files and, when there is exactly one, downloads it and makes it the plots file as Settings > Project's Apply does; with several, none yet, a learning set in a new attempt (whose earlier answers are cleared only when the collector chooses it) or the server unreachable, a notice says what to do in Settings > Project. A coordinator's project is left as it is
- Collect Earth Cloud: the forecast's pace is the plots of the last 7 days (it was 14), as on the People tab's "Who finishes when" and in "Share again what is left": a collection (a mapathon) rarely lasts more than two working weeks, and the dates follow how the team works now
- The cloud dashboard's log-in, sign-up, password reset and invitation pages look like Collect Earth's website: an aerial photo of the Peruvian Amazon from FAO's media library (© FAO/Guillermo Carlos, credited on it, about 110 KB) edge to edge with the blue band under it, the form in a white rounded box with the Collect Earth emblem, Poppins headings and the green button
- Settings: the TFO options show only once a Planet key is set. The server port and the data entry form are no longer on the settings page: `port` and `web_form=balloon` still work in earth.properties
- The dashboard (local and cloud) and its stand-alone analysis file look like Collect Earth: its light app bar with the Collect Earth logo, its blue, background, type and buttons, from one theme both share
- The dashboard's project pages: the sections in a sidebar grouped as a coordinator works (Monitor, Team and plots, Results, Project) on wide screens, with a link back to the projects; the figures of the Progress page in one even row of tiles, and what needs attention as a list; quieter borders, flat buttons and denser fields and tables
- The dashboard's explanations are one short sentence, with the full explanation (how it is counted, what it is for, how to use it) behind an (i) next to it, which opens on hover, keyboard focus or a tap, and is printed in full on the reports. Confirmations and warnings to read before acting stay in full. On the project tabs (Progress, Map, Quality, Activity, People, Plot files, Data, Setup and Settings), the full explanations also say step by step how to use each part
- Collect Earth's languages are English, Spanish, French, Portuguese and Turkish, and Turkish now translates every text, the plots map and its form included. Hindi, Lao, Mongolian, Vietnamese and Russian, which were only partly translated, are no longer offered: an installation set to one of them opens in English
- The imagery of a plot opens in one browser window, with a tab per source (Google Earth Web, ESRI Wayback, Planet, Earth Engine, Earth Map, Street View, the extra URL), instead of a browser window for each source, with every plot viewer. A new plot loads in every tab without changing the one being looked at, and a tab that was closed opens again with the next plot. One browser instead of one per source also uses much less memory. In Firefox the window shows its tabs but no address bar, and keeps its own profile, so the sign-ins to Google, Planet or Earth Engine are kept from one session to the next
- The download pages count each download, by operating system, in the Google Analytics of openforis.org (the event `CE_Download` with the parameter `os`). The pages that download one installer directly start it after one second instead of at once, to leave the count the time to be sent
- Releases: a new version is only announced to the installed copies, and on the download page, once its installers can really be downloaded from GitHub. Each installer is uploaded on its own and retried, so one dropped connection no longer loses the release
- ESRI Wayback shows the plot at the scale of Google Earth Web, down to the deepest zoom with imagery at the plot and one level past it at most, instead of zoom 19 at most, where the imagery of most plots was enlarged and blurred (and deeper than 19 where there is imagery). The zoom found is remembered for each plot, and a map the user has moved is never fitted again
- Cloud projects: what the collectors work on is set by the project's coordinator. The plots file can only be one of the files the server assigned to the collector (Settings > Project, the list of assigned files, which a divided file serves with only their plots): the field is read-only and the server refuses any other file; a missing plots file is no longer replaced by one found in the data folder. The plot design (the whole Plot section: shape, size, points, reference area) and the imagery windows (the Imagery section but the Planet key) are the coordinator's: they come from the project file, follow the changes the coordinator makes on the dashboard, and are shown read-only, a change refused. Tools > Load KML is disabled, and refused by the server, as is a plots file or KML dropped on the page. Leaving the cloud project (another database or project) is not held back.

### Fixed
- Coming from Collect Earth 1 keeps a copy of the data that nothing deletes: at its first start, before it reads the
  settings or opens the database, Collect Earth 2 zips the database and `earth.properties` as Collect Earth 1 left them
  into the data folder's `safetyCopies` folder, and says where. The automatic backups keep only the ten newest, one at
  every quit, and Collect Earth 2 quits and starts again often: within a few restarts the last backup of Collect Earth 1
  was gone. Taken once; a new installation, with no database yet, takes none
- Joining a cloud project whose survey has the name of a project of this computer that is in no cloud project (a
  Collect Earth 1 project the team moves to the cloud) replaced that project's files without a word. Its folder, the
  database and the settings are now zipped into `safetyCopies` first, and the next start says what happened, where the
  copy is, and how to send the plots collected without a server to the project. When the copy cannot be taken (a full
  disk), the join is refused and nothing is replaced
- Before joining (or opening) a cloud project over such a project, Collect Earth now asks when this computer has plots
  of its survey saved under other people's names (not the name typed here, nor the account's): how many, whose, and
  that in the cloud project they would show as done but never be sent, and opening one would change it. "Join anyway"
  goes on; Cancel leaves everything as it was
- Google Earth Web stayed on the plot shown before when the plot clicked had the same id in another plot file (a training set and the person's plots), so the wrong ground was interpreted
- The Planet Daily window asked port 8028 whatever port Collect Earth runs on, so it showed nothing on another port
- A training plot whose record was not sent yet when the training finished kept its record on the computer for good; it is deleted once sent
- A project's own balloon is sent as UTF-8, as it is read
- Collect Earth Cloud: opening the Progress tab of a large project no longer runs the server out of memory: the IPCC exports' summary counts the plots without reading every record's answers, and the "needs attention" cards no longer start working out the quality figures again
- The plot list in Google Earth Web's panel follows a new plot file (one chosen in Settings and applied, one dropped on the window, or the assigned file set up after joining a cloud project) without reloading the panel; the old plots used to stay in the list until it was reloaded
- Join cloud project names the role as the dashboard does (Collector, Coordinator or Reviewer, in Collect Earth's language) instead of the server's word for it ("as operator")
- Collect Earth Cloud: the People tab's "Who finishes when" says "and 1 copy to compare" when one quality check is left, not "and 1 copies to compare"
- Plot layout preview (dashboard and Settings > Plot): the scale bar sat on top of the plot, starting outside it and running over its points, so it lined up with nothing; it is now under the drawing. The dashboard also shows the plot's size and area, and the reference area's
- Collect Earth Cloud: a mail server refusing because the server sent too much (Gmail's daily sending limit, "550 5.4.5") no longer counts as each person's address being refused: the weekly run stops there and the weeks not sent stay due, instead of being lost and, after three weeks, turning everyone's weekly email off
- The dashboard's Setup checklist marks "Choose who collects each plot file" as done when a plot file is divided between people, not only when one is given whole to someone
- Range attributes are saved: an integer range was taken for a whole number and refused, and a real range could not be saved at all
- The text written for a qualifiable code item ("Other, specify") is saved and shown again; it used to be dropped
- The header row of the plot file no longer logs an error with a stack trace on every start
- A value that the balloon fills by itself and that cannot be read - the id of the plot where its coordinate goes - is reported as an error once, instead of on every save of every plot. The repeats used up the quota of the error reports, so that no report from any user was received for nine days
- The analysis page no longer fails with "Something went wrong" on a project with a yes/no question that nobody answered (every row of its column empty)
- An answer cleared because its question was no longer asked reads as missing when the question is asked again: the form said "Invalid code" and the error counts were wrong, until another answer was chosen
- Join cloud project works for someone who already has an account on the server (from another project): Log in with the invitation now adds its project to the account. It failed with an internal error (the project file could not be downloaded), and Register said the username was taken
- A plot's changes that could not be written to the database (a locked database) are kept and written later, instead of being lost when an import, a deletion, a project change or the cloud's fetch of the person's records came next
- Collect Earth Cloud: a save the server refused because it kept a newer one of the same plot (from the person's other computer) no longer counts as sent, and the server's copy no longer replaces it; it is counted with the records not sent
- Collect Earth Cloud: the end of a training no longer deletes the record of a plot that is also one of the person's plots (a training file uploaded with the project's own plot ids), nor one not sent yet
- Collect Earth Cloud: a project file or records download cut off halfway no longer leaves a temporary file behind
- A restart that fails to start the new Collect Earth ends this one, instead of leaving it running without its server and unable to quit
- A beta, release candidate or snapshot build is published on GitHub as a pre-release, and its autoupdate manifests and download pages are not uploaded, so installed copies are never offered it

### Removed
- The conversion of the plots from another coordinate system than WGS84 (a survey whose first spatial reference system was, say, EPSG:32737). Collect Earth works only with WGS84 latitude and longitude in decimal degrees (EPSG:4326), the system of Google Earth Web and the imagery. The conversion had not worked since November 2020, when GeoTools' EPSG database left the build: such a project showed no plots and logged an obscure `NoSuchAuthorityCodeException`. It still opens, and a notice now says which coordinate system its survey uses, that Collect Earth takes only WGS84 decimal degrees, and what to do (convert the plot file's coordinates, and set the survey's system to EPSG:4326 in the survey designer). Plots whose latitude or longitude is out of range (UTM metres, for instance) are left out with a notice that says how many and names a few; the settings page refuses such a plot file, and says under the plot file that its coordinates must be WGS84 decimal degrees. GeoTools' `gt-main` is no longer shipped
- Google Earth Desktop (Google Earth Pro) is no longer supported: Collect Earth makes no KMZ of the plots for it any more, and the endpoints only its balloons and network links called are gone (`/placemarkUpdate`, which refreshed the plot icons, and `/openInBrowser`, which opened the form in a separate browser), with the `open_separate_browser_form` and `alternative_balloon_for_browser` settings. Earlier projects and settings keep working:
  - a project file's KML template (`template`, `kml_template.fmt`) is no longer needed nor read, and a project file without one opens
  - a project's own form (`balloon`, `balloon_web`, `web_form=balloon`) is still shown, with its `earthFiles/` and `webFiles/`, now copied whenever the plots are loaded (only the files that changed) instead of when the KMZ was made
  - the settings of Google Earth Pro left in an `earth.properties` or a project file are ignored without a warning, and the `gePlugin.kmz` and `plots.kml` of earlier versions are deleted from the user folder
  - a missing plot file is still said at start, now with where the project expected it
  - the Data > Export to KML is unchanged, its plot icons included
- `/ancillaryWindows` and `/placemarkInfo`, which nothing called any more
- Saiku and its Tomcat server: "Tools > Analyse the data" (the dashboard's analysis page) replaces "Start SAIKU Analysis", and the analysis page's stand-alone file replaces "Generate Stand-Alone Saiku tool". The installers no longer include Saiku (about 75 MB), the update removes the `saiku-server_2.6` folder of the installation, and the "Path to Saiku folder" setting is gone

## [1.23.19] - 2026-09-29
### Added
- The installers of a release come with `SHA256SUMS`, the checksum of each one, and `SHA256SUMS.asc`, its signature, so that a download can be verified

### Changed
- Conditions that are not faults in Collect Earth are logged as warnings, so they no longer open an error dialog or reach the error reports: a browser already closed when Collect Earth quits, a page that takes too long to load, a browser driver that could not be downloaded, a copy of the SQLite library that another program still holds, a file that is not a project

### Fixed
- The tool that removes plots from the database accepts a CSV with only the plot keys again; a survey with fewer than three key attributes had every file rejected as "not a CSV file". A path that does not lead to a file is marked instead of opening an error dialog on every keystroke
- A burst of errors can no longer crash Collect Earth: the error dialogs open one at a time, and the ones logged meanwhile are counted, where they used to open inside each other until the application ran out of stack
- A file chooser that the Windows shell makes fail - a broken shortcut in the Recent folder - is shown again with plain folders, and the file choosers keep to plain folders until Collect Earth is restarted, instead of failing every time
- When port 8028 is taken, Collect Earth says so and what to do, instead of closing without a word
- Importing a file that is not a project (.cep) says so, instead of reporting a project with no survey_name
- A number or a time that is mistyped in the balloon - "07/2024" in a year - is reported under its field, and the plot cannot be submitted until it is corrected. It used to be dropped without a word, and a mistyped decimal number erased the value that had been saved

### Removed
- Maxar SecureWatch is disabled: its address no longer exists, so every plot opened with it failed to load. The option is hidden and switched off on update, and a project file cannot turn it back on. The integration itself is kept, to be switched back on if Maxar publishes an address that works

## [1.23.18] - 2026-09-28
### Changed
- The installers are downloaded from the GitHub release of each version instead of Maven Central, and https://www.openforis.org/fileadmin/installer/download.html always offers the latest one

## [1.23.14] - 2026-09-23
### Added
- Optional reference area (square, circle or hexagon) drawn around square, circle and hexagon plots to give context on the surroundings during the assessment; configured from the plot options panel (`buffer_shape` / `distance_to_buffers`), which warns when the reference area covers less than 10 times the plot area. It is drawn with a fainter, thinner line than the plot boundary, so that the two are not confused
- The grid module (`collect-earth-grid`) builds again and is part of the Maven reactor

### Changed
- Updated Jetty to 10.0.26 and Jackson to 2.18.9
- An operation that fails now says so instead of reporting a finished file: a KMZ, a project archive, a template, an IPCC export or a Saiku database that could not be written is reported as failed, and a half-written file is not left behind to be opened later

### Fixed
- Changing the project (or applying property changes) no longer crashes the internal server: instead of reloading the Spring web context in-process (which always failed with a CGLIB `LinkageError` on the second load), Collect Earth now relaunches itself as a fresh process
- `earth_error.log` is written again: the user folder is now set before logging starts, so the log no longer ends up in a folder named after the unresolved property
- If Collect Earth cannot restart itself after a change of project, it says why instead of disappearing
- The reference areas of a project made before September 2026 are drawn around the plot instead of in place of its boundary. Those templates wrote them into the plot's own outer boundary, which left Google Earth showing a reference area where the plot frame should be; the template file in the project folder is not modified
- Plot data that used to end the save with an error is handled: a coordinate, a date or a value the survey does not expect is reported on its own field instead of losing the whole record
- KML is generated for the plots that used to break it, and NFI three- and four-circle plots are drawn where they belong
- Plots carry their expansion factor again, so the areas computed from them are right
- The IPCC export runs on PostgreSQL as well as SQLite, counts the plots of the right survey, is written as UTF-8, and stops with a message when it cannot produce a valid workbook
- One bad plot no longer aborts the whole Saiku export, and several CSV files can be imported in one go
- The desktop interface: the file dialogs, the progress dialogs and the menus no longer act on stale information, no longer block the interface thread, and no longer end an operation because of what was typed in a field
- The grid tools: the subgrids of 50 and 100 are stored and queried correctly (their flags used to overwrite those of other grids), a failed insert stops the run instead of silently leaving holes, the CSV output is not truncated by a second writer on the same file, and the plot table is no longer dropped and recreated at every start

### Removed
- The integrations that are not supported any more: Earth Engine Timelapse, Earth Engine Explorer, the Earth Engine code editor, Bing Maps and Yandex Maps. Their properties are gone from earth.properties and a project file that still carries them is simply ignored

### Security
- Collect Earth's internal server listens on this computer only. Its endpoints have no authentication, so on the previous `0.0.0.0` anybody on the same network could save records, load project files and restart the application. An installation that serves clients in CLIENT_MODE opts back in with `server_bind_address=0.0.0.0` in earth.properties, and is warned in the log when it does
- No credentials are shipped in the code: the analysis database and the grid tools read theirs from the launch properties
- Imported project and data files are no longer trusted blindly: an archive entry cannot be written outside the folder it is extracted into, and the XML parsers do not resolve external entities
- The servlet that loads a project file only accepts requests that Google Earth itself makes
- The grid tools use the same database drivers as the application (PostgreSQL 42.7.13, SQLite 3.53.4.0), clearing the SQL injection reported for the driver they had pinned since 2022

## [1.23.8] - 2026-06-16
### Added
- CSV data export now supports multiple entities (#52)

### Changed
- Updated Collect framework to the latest version
- Added Sentry Seer plugin for AI-assisted error analysis
- Pinned commons-lang3 / commons-text dependency versions

### Fixed
- Fixed a NullPointerException in the process monitor dialog

## [1.23.7] - 2026-05-12
### Changed
- Refactored PropertiesDialog into modular panel components for better maintainability
- Planet NICFI integration now uses a single API key field for both Daily and TFO modes
- Planet date selectors include static biannual mosaics (Dec 2015 - Aug 2020) alongside monthly mosaics
- Updated Google Earth Engine app to a new, faster URL

### Added
- Planet NICFI Tropical Forest Observatory (TFO) monthly basemaps integration with configurable date range
- ESRI World Imagery Wayback integration for historical satellite imagery comparison
- ESRI Wayback now overlays the plot polygon on historical imagery and auto-accepts cookies
- Planet panel UI grouped in bordered panel for better organization
- "Oldest" and "Latest" default options in Planet TFO date selectors

### Fixed
- Thread safety improvements in BrowserService WebDriver fields
- Fixed N+1 query performance issue in RegionCalculationUtils
- Fixed null pointer vulnerabilities in servlet layer
- Fixed unsafe list access in AbstractEarthSurveyService
- Fixed temp file cleanup in KmlGeneratorService
- Optimized CSV generation in KmlImportService
- Optimized string building in MissingPlotService
- Replaced deprecated Observable with PropertyChangeSupport
- Upgraded Apache Commons DBCP from 1.4 to 2.9.0


## [1.22.2] - 2025-06-15
### Changed
- Updated libraries
- Moved to Maven Central repo
- Removed unused integrations with Planet and Bing Maps

### Added
- 

### Fixed
- Proerties dialog Look and Fell
- Update default DEMO survey to 2025 ( it was stuck in  2020)

## [1.21.9] - 2025-04-25
### Changed
- Updated Libraries

### Added
- Announcement feature to keep users informed

### Fixed
- Bug when Collect Earth would stop working if loading a CEP file while already running.

## [1.21.8] - 2024-12-30

### Changed
- Updated versions of libraries for Chrome/Firefox
- Connection to Planet daily imagery service has been fixed

### Added
- Export Sampling Error Excel file inside the GHGi LULUCF package

### Fixed
- Bug when CE started in the new Mac iOS for arm architecture
- Bug when Firefox not installed and Collect Earth installed fresh (browser windows not opening)

## [1.20.7] - 2023-07-06

### Changed
- Updated versions of libraries for Chrome/Firefox
- Connection to Planet daily imagery service has been fixed

### Added


## [1.20.6] - 2023-07-06

### Changed
- Changed version of JRE in Collect Earth to OpjenJDK 11.0.19+7

### Added
- Export data to KML
- Set start and end months for Planet NICFI imagery (on the Properties dialog and the local properties file)
- Set start and end dates for the GEE App charts (on the Properties dialog and the local properties file)
- Export button added on the main CE window


## [1.15.08] - 2023-04-15

### Fixed
- KML Import to open in GE working.
- Updated Selenium to support latest versions of Chrome/Firefox.


## [1.14.19] - 2022-11-17

### Fixed
- SAIKU not starting from the CE menu (bug introduced in version 1.14.17 ) 

## [1.14.17] - 2022-09-15

### Added
- Export SAIKU stand-alone tool as a ZIP file.

## [1.14.15] - 2022-06-28

### Fixed
- Code attributes linked to calculated attribute parents not updating in the interface.
### Changed
- Earth Map integration: No more necessary to login (using embed=true parameter in URL).


## [1.14.12] - 2022-03-31


### Fixed
- Plots showing up with weird shapes in Google Earth.


## [1.14.9] - 2022-03-23

### Changed
- Updated Collect and Selenium-web updater libraries.

## [1.14.8] - 2022-02-03

### Changed
- Mac OS X Monterey fixes.

## [1.14.6] - 2022-01-13

### Changed
- Update to latest Log4J ( so far no risk has been detected of Log4Shell but just a precaution)
- Fix for Mac OS X Monterey installer.


## [1.14.5] - 2021-12-18

### Removed
- Safari not supported anymore due to persistent issues with maintenance.


## [1.14.4] - 2021-12-9

### Added
-

### Changed
 - Automatic update notification is working again


## [1.14.3] - 2021-12-9

### Added
-

### Changed
 - CSV divider tool issue with UTF-8 charset fixed
 - Saiku starts faster when using very large databases


## [1.14.1] - 2021-12-01

### Added
-

### Changed
 - Allow for daily images selection in CE/Planet Daily (API Key) integration

## [1.14.0] - 2021-11-01

### Added
- Support for Edge and Safari

### Changed
 - Export dialog labels (to clarify that CSV export is only for data visualization and not to share with other Collect Earth users)
 - Selenium driver loading, so that the users never have to worry again about the version of the browser installed in their computer.

### Removed
- Integrations with GEE Playground, Timelapse and Streetview that is already deprecated.

## [1.13.05] - 2021-09-17

### Changed
 - Support latest Chrome version (93)
 - Remove class linking exceptions
 - Improved loading times for Properties dialog


## [1.13.03] - 2021-06-08

### Changed
 - Support latest Chrome version
 - Remove memory leaks

## [1.13.02] - 2021-05-23

### Changed
 - Bug fix for system memory error when loading very large table
 - Update to latest version of Open CSV and Collect

## [1.13.00] - 2021-04-12

### Changed
 - Improved Mac osx installer

## [1.12.17] - 2021-03-30

### Changed
 - Added Google Analytics logging


## [1.12.16] - 2021-03-19

### Changed
 - Updated plugins for Mozilla Firefox and Google Chrome to use the very latest versions as of today

## [1.12.15] - 2021-03-11

### Changed
 - Hosting moved from Open Foris Nexus to Sonatype

## [1.12.11] - 2021-03-05

### Changed
 - Minor improvement for filtering Planet daily imagery

## [1.12.10] - 2021-03-04

### Changed
 - Improved access to Planet Daily imagery

## [1.12.7] - 2020-12-07

### Changed
 - FIXED: Planet integration with daily imagery
 - Mac OSX dock icon switchd to PNG format

## [1.12.6] - 2020-11-24

### Changed
 - Open Earth Map integration with more meaningful default products
 - Update Chromedriver to be compatible with Chrome version 87
 - Improved integration with Earth Map

## [1.12.5] - 2020-11-02

### Added
 - Possibility to use Well Known Text (WKT) or GeoJson for drawing polygons (on top of the current support to KML polygons)

### Changed
 - Planet : adapted integration to access the biannual mosaics

## [1.12.4] - 2020-10-22

### Changed
 - Planet : allow access with daily imagery API Key or usign the NICFI provided monthly images

## [1.12.3] - 2020-10-15

### Changed
 - Planet API Key improvements

## [1.12.0] - 2020-10-14

### Added
 - Access to the NICFI procured Planet monthly basemaps using a side-by-side mosaic comparison tool

### Removed
 - Planet Maps daily imagery access (not working any more due to FAO-Planet agreement finishing in September 2020)

## [1.11.00] - 2020-9-30

### Changed
 - This version prepares the new users (and updates old ones) to be able to use the updating of Collect Earth through the new HTTPS enabled repositories.

## [1.10.19] - 2020-9-28

### Added
 - Updated AutoUpdater to support SSL connection in preparation for the migration to Sonatype Repositories


## [1.10.18] - 2020-8-30

### Changed
 - Update to use latest version of Chrome 85 and Firefox 80
 - Update all libraries to their most up to date versions

## [1.10.17] - 2020-5-22

### Added
 - Support to Earth Map integration

### Changed
- Updated Chromedriver to be compatible with Chrome 83
- New Demo Survey that guides the user through the plots with a connection to a HTML/PowerPoint slides.

## [1.10.16] - 2020-4-30

### Changed
- Added a message with the names of the key attributes when importing CSV (increased usability of hte data update)
- Added info to the installer README
- Update CEP file in the installer

## [1.10.16] - 2020-4-6

### Changed
- Demo survey now opens the GEE App rather than a GEE Code Editor

## [1.10.15] - 2020-4-6

### Changed
- Fixed the hesagon and circle shape plot layout generation.
- Updater updated so that the chromedriver.exe processes are stoped and the updater might replace the file
- Installer is now deleting the java and tmp folders so that there are no issues with the JRE versions

## [1.10.14] - 2020-3-30

### Changed
- Updated to version 3.26.6 of Collect.

## [1.10.12] - 2020-2-27

### Changed
- Refresh the view in SecureWatch when it is locked

## [1.10.11] - 2020-2-13

### Changed
- Fixed installer for the Mac OS X

## [1.10.10] - 2020-2-11

### Changed
- Refresh the view in SecureWatch when it is locked

## [1.10.9] - 2020-2-10

### Added
- Added full support for Secure Watch

## [1.10.8] - 2020-2-10

### Changed
- Fixed support for Chrome version 80

## [1.10.6] - 2020-2-5

### Changed
- Planet Imagery improvements

## [1.10.5] - 2020-2-3

### Changed
- Added access to Rapid Eye imagery for the Planet integration

## [1.10.4] - 2020-1-31

### Changed
- Fixed JRE issue when installing new versions of Windows and MacOS

## [1.10.0] - 2020-1-29

### Changed
- Multiple bug fixes when opening SecureWatch and Planet
- Added the JRE to the installers that had a problem in the previous version

## [1.10.0] - 2020-1-29

### Added
- Added support for Maxar SecureWatch imagery

### Changed
- Updated the JRE used on the installer from Oracle 1.8.1_121 of AdoptOpenJDK 1.8.0_232 with
- Updated to latest version of Collect and syncronized libraries to use the same versions ( Spring and others)
- Improved Planet integration


## [1.9.1] - 2019-12-13

### Added
- Added support for Planet Maps imagery

## [1.9.0] - 2019-11-27

### Added
- Turkish translations for the GUI
- Support for Mac OS X - Catalina

## [1.8.8] - 2019-10-24

### Changed
- Updated ChromeDriver to support the newest version of Chrome ( 78 )
- Updated to latest version of Jetty server
- Small bug fixes

## [1.8.7] - 2019-08-02

### Changed
- Updated ChromeDriver to support the newest version of Chrome ( 76 )

## [1.8.4] - 2019-06-06

### Changed
- Fix bug that did not allow the user to update the values of already stored plots (due to validation issues preventing the write to DB)

## [1.8.2] - 2019-06-03

### Changed
- Fix of CSV updates not showing progress on large CSV files
- Fix of switch between DB types requiring a full Collect Earth restart
- Updated Collect core (3.24.23) version to fix bug when switching from single to multiple code list attributes.

## [1.8.1] - 2019-05-06

### Added
- Added option to use the ID of the plot as one of the parameters in the extra_map_url URL i.e. http://openthiswindow.com?lat=LATITUDE&long=LONGITUDE&id=PLOT_ID
- Added support to the new Survey Guide PDF document file. If a Survey Guide file is added to the survey it can be opened directly within the Help menu

### Changed
- Updated Chromedriver to be compatible with Chrome version 74
- Fixed the progress monitor not working when exporting data (CSV or XML)


## [1.8.0] - 2019-04-12

### Added
- Added the Changelog mechanism to keep track of changes to the code
- Added a link to this Change Log from the About dialog
- Added a button to access the Properties directly in the dialog

### Changed
- Fix exceptions when no file is chosen in the "Find Missing Plots in Database" dialog
- Operator name is updated automatically when the user finished typing on the text field

### Removed
- Removed the unnecessary Quit button from the main windows
- Operator name update button


## [1.7.12] - 2019-03-29
### Added
- TODO

### Changed
- Updated to last version of Collect Core (3.24.15) that fixes the issue with calculated attributes not using the right calculation chain.

### Removed
- TODO
