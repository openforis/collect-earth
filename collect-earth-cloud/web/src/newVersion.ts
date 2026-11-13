// A page left open across an upgrade: the dashboard is built and shipped with the server, so it reads the
// server's answers as they come (src/wire/README.md). A page loaded before an upgrade runs the old build against
// the new server; server-info's dashboardBuild (a hash of the served index.html) tells it, and it offers to reload.
//
// The check runs once per page load, outside the components: a screen that changes (a sign-in that ended, another
// page) neither restarts it nor loses what it found.

/** How often an open page asks which build the server serves (only while the page is visible). */
export const BUILD_CHECK_MS = 10 * 60_000;

/** Whether the server now serves another build than the one this page was loaded with (null: none, or not known). */
export function newBuildAvailable(loaded: string | null, served: string | null): boolean {
  return loaded !== null && served !== null && loaded !== served;
}

let watched = false;
let found = false;
const listeners = new Set<() => void>();

/**
 * Starts asking, once per page load: `build` is the build this page was loaded with; `ask` gives the build the server
 * serves now; `later` runs an action after the wait (src/visibility.ts onceVisibleAfter). A failed ask (offline, the
 * server restarting) is tried again later; once another build is found, asking stops.
 */
export function watchBuild(build: string | null, ask: () => Promise<string | null>, later: (action: () => void) => void): void {
  if (watched) return;
  watched = true;
  if (build === null) return;
  const check = () => {
    ask().then(
      (served) => {
        if (!newBuildAvailable(build, served)) return later(check);
        found = true;
        for (const listener of listeners) listener();
      },
      () => later(check),
    );
  };
  later(check);
}

/** Whether another build was found (for useSyncExternalStore). */
export function newBuildFound(): boolean {
  return found;
}

export function onNewBuild(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: forget the page load's watch. */
export function resetBuildWatch(): void {
  watched = false;
  found = false;
  listeners.clear();
}
