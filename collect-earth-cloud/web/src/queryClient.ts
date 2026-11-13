import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { ApiError, type ProjectInfo } from "./api";
import { onTokenChange } from "./storage";

// The dashboard's one cache of the server's answers (TanStack Query), used through useLoad (useLoad.ts). An answer is
// kept under a key that names what it is and from where (["project", <id>, "listMembers"]), so every screen that shows
// it shares one load and sees the same copy, and a change made on one screen (useLoad's setData, or invalidating a key
// after a save) reaches all of them.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A page asks again each time it opens (showing what it has meanwhile), as before; never behind its back while
      // a form may hold a person's edits.
      staleTime: 0,
      refetchOnWindowFocus: false,
      // Once more when the server could not be reached at all; a refusal or a "busy" answer is for the page to say.
      retry: (failures, error) => failures < 1 && error instanceof ApiError && error.status === 0,
    },
  },
});

// The cached answers belong to the session that asked: signing in, out or in another tab's account forgets them all.
onTokenChange(() => queryClient.clear());

/**
 * A project's name or status changed here: every screen showing the project's info sees it at once (the project's
 * page and header), and the lists of projects are asked again.
 */
export function projectChanged(projectId: string, change: Partial<ProjectInfo>): void {
  queryClient.setQueryData<ProjectInfo>(["project", projectId, "getProject"], (info) => (info ? { ...info, ...change } : info));
  void queryClient.invalidateQueries({ queryKey: ["app", "listProjects"] });
}

/**
 * Whether two keys are about the same place (the same project, or both outside any): a screen keeps showing what it
 * had while its next answer loads there, but never one project's answer under another.
 */
export function samePlace(a: QueryKey, b: QueryKey): boolean {
  return a[0] === b[0] && (a[0] !== "project" || a[1] === b[1]);
}
