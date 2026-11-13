// A page left open across an upgrade: the dashboard is built and shipped with the server, so it reads the
// server's answers as they come (src/wire/README.md). A page loaded before an upgrade runs the old build against
// the new server; server-info's dashboardBuild (a hash of the served index.html) tells it, and it offers to reload.

/** How often an open page asks which build the server serves (only while the page is visible). */
export const BUILD_CHECK_MS = 10 * 60_000;

/** Whether the server now serves another build than the one this page was loaded with (null: none, or not known). */
export function newBuildAvailable(loaded: string | null, served: string | null): boolean {
  return loaded !== null && served !== null && loaded !== served;
}
