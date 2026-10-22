# One imagery window with a tab per source

## Problem

Every imagery source runs in a Selenium browser of its own: Google Earth Web, ESRI Wayback, Planet, the Earth Engine
app, Earth Map, Street View, the extra URL and SecureWatch each start a browser process and open a window. With the
plots map next to them that is up to nine windows to arrange, and nine browser processes: the machine this was
developed on ran out of memory twice while Collect Earth was running.

## Decisions

- **Two windows:** the plots map with the form, and one imagery window whose tabs are the sources. The form and the
  imagery have to be seen together, so they do not share a window.
- **Every viewer:** the classic way (Google Earth Desktop) gets the tabbed window too, instead of one browser per
  source.
- **Switching:** the imagery window shows its tab strip (the address bar stays hidden), and the plots map gets a row
  of source buttons that bring a tab to the front.
- **A new plot never changes the tab being looked at.** The other tabs load it in the background.
- **Driven with WebDriver BiDi**, which loads and scripts a tab without selecting it. Classic WebDriver selects the tab
  it drives in Firefox, so it would flash every tab past on each plot.

### Checked before deciding

`BackgroundTabs.java` (a scratch experiment, Selenium 4.48) loaded three pages, ran a script and wrote into the page
of a background tab, in Firefox 158 and in Chrome. The visible tab stayed visible throughout, the classic window
handle did not change, and a background load took ~50 ms.

Firefox throttles the timers of a hidden tab hard: a 100 ms interval ran twice in 3 s (Chrome: 30 times). Whatever a
hidden tab does on a timer is late, hence the rules for Google Earth Web below.

## 1. Architecture

- **`ImageryBrowser`** (new Spring component) owns the one imagery browser, started with BiDi enabled
  (`enableBiDi()`), with the persistent profile Google Earth Web keeps today: the sign-ins to Google, Planet and Earth
  Engine are kept across sessions and shared by the tabs. Tab strip shown, navigation bar hidden (the Firefox
  `userChrome.css` loses its `#TabsToolbar` rule).
- **`ImagerySource`** (enum), in tab order: Google Earth Web, ESRI Wayback, Planet, Earth Engine app, Earth Map,
  Street View, extra URL, SecureWatch (disabled today, kept for when it comes back). A tab is created the first time
  its source has a plot to show, so a source that is off never appears. A tab the user closed is created again on the
  next plot.
- **One queue:** every command to the browser goes through a single-threaded executor in `ImageryBrowser`. Today eight
  drivers are used from several threads; one BiDi connection has to take its commands in order. API:
  `load(source, url, scriptAfterLoad)`, `evaluate(source, script)`, `show(source)`, `visibleSource()`.
- **Callers:** `BrowserService.openEsriWayback`, `openPlanetMaps` and the others keep building the URLs they build
  today and hand them to `ImageryBrowser`; their seven `webDriver*` fields go. `GoogleEarthWebService` does the same
  for its tab: the page load, the injected overlay and the camera reading.
- **Layout:** `WindowLayoutService` places two windows, the plots map and the imagery window. "Show all" has no
  separate windows left to tile and becomes "show the imagery window". With the classic viewer there is no plots map,
  and the imagery window is placed where the separate browsers were.

## 2. Behaviour

- **A new plot:** every open source tab loads it, the visible tab first. The visible tab does not change. If another
  plot is chosen before the loads finish, the loads still waiting for the old plot are dropped (as Google Earth Web
  does today), so quick "next" presses never replay a backlog. Wayback's script after the page load works in a hidden
  tab.
- **Source buttons:** the plots map header gets `Imagery: [● Google Earth Web] [Wayback] [Planet]`, only the sources
  that have a tab, the visible one marked. A click calls `/imagery/show?source=…`, which selects the tab and raises the
  imagery window (minimize and restore, as Arrange does). The Google Earth Web chip and its menu stay.
- **Which tab is visible:** the user can also click the browser's own tabs. A BiDi preload script in every tab reports
  `visibilitychange` over a BiDi message channel (`script.message`), so the pages never call Collect Earth themselves.
  `ImageryBrowser` keeps the visible source; the status the plots map already polls carries it, and the marked button
  follows the browser.
- **Google Earth Web while hidden:** the camera reading stops (a hidden map cannot be moved, and Firefox's throttled
  timers would report stale positions). A camera move from the plots map meanwhile is kept and applied when the tab is
  shown again. On being shown, the outline is redrawn at once and the camera reading resumes.

## 3. Errors and fallbacks

- **The imagery window is closed:** the next command fails, `ImageryBrowser` drops the browser and starts a new one on
  the next plot. The Google Earth Web chip shows "window closed" with Reopen, as today.
- **No BiDi:** a browser that does not start with BiDi is skipped for the next one, as `initAppWindow` already does
  (Firefox, Edge, Chrome). Edge ships with Windows and supports BiDi, so the one-window-per-source code is removed, not
  kept as a fallback. When no browser starts, the user gets today's error.
- **One source fails:** a page that does not load in time or a site that refuses is a warning for that tab only; the
  other tabs and the form carry on.
- **Profile in use** (another Collect Earth holds it): a temporary profile, as now; the sign-ins are asked again.

### Sentry

Errors in this code reach Sentry as in the rest of Collect Earth, with the context needed to act on them, and without
the error dialog for things the user cannot do anything about.

- **Faults of Collect Earth are reported:** a BiDi command that fails for a reason other than a closed window, a
  script of ours that throws in a page (the Google Earth Web overlay, the Wayback and SecureWatch scripts), a preload
  script that does not install, no browser at all starting with BiDi. They are sent with `Sentry.captureException`
  rather than logged at ERROR, which would also open the error dialog (it hangs from the root logger) on every plot.
- **Not faults, not reported:** a site that is slow or down, a window the user closed, a sign-in page. They stay
  warnings in the log, as the 1.23.19 policy for conditions that are not faults of Collect Earth.
- **Tags:** `imagery.source`, `browser` and its version, `bidi` (true/false), `viewer_type`, so an issue says which
  source and which browser.
- **Breadcrumbs** (`Sentry.addBreadcrumb`, category `imagery`): browser started, tab created, plot loaded in a source,
  tab shown, window closed. A report then shows what the imagery window was doing before the error.
- **Once per kind:** each (source, kind of error) is reported once per session. A failure on every plot would
  otherwise use up the error quota, as the unreadable balloon value did for nine days in 2026.

## 4. Testing

- **JUnit:** `ImageryBrowser`'s queue and tab rules against a small interface in place of the browser: tab order, a
  tab created on the first plot of its source, loads for an older plot dropped, the visible tab loaded first, a closed
  tab created again, one Sentry report per kind of error.
- **Browser test** (tagged, out of the normal build, needs Firefox): the experiment above as a test, a background load
  leaves the visible tab visible.
- **vitest:** the source buttons follow the status.
- **By hand:** Google Earth Web with Wayback and the extra URL on, on one screen and on two; the classic viewer with
  Wayback. On each plot change the window list shows two windows and the visible tab does not change.
