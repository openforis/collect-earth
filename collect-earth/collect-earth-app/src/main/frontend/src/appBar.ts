import { ApiError, apiPost } from "./apiClient";
import type { AppInfo } from "./appInfo";
import type { MenuItem } from "./menus";

/** What an entry of the menus does. Each stage of the HTML UI adds its own here, as it builds them. */
export type AppAction = "quit" | "settings" | "export" | "importZip" | "updateCsv";

// A Map, not an object: an entry called "constructor" would find a property of every object
const ACTIONS = new Map<string, AppAction>([["quit", "quit"], ["properties", "settings"], ["export", "export"], ["importZip", "importZip"], ["updateCsv", "updateCsv"]]);

/** The action of an entry of the menus, or null for one that does nothing yet. */
export function actionOf(item: MenuItem): AppAction | null {
  return item.enabled ? ACTIONS.get(item.id) ?? null : null;
}

/** Whether the entry shows, disabled, as "Coming soon": the menus show all of Swing's, built or not. */
export function comingSoon(item: MenuItem): boolean {
  return actionOf(item) === null;
}

/**
 * Whether the operator has to be given before anything else, as the Swing window asked for it: only once the app is
 * known to have none (a name of spaces is none), so the dialog does not flash while /api/app loads.
 */
export function operatorRequired(info: AppInfo | null): boolean {
  return info !== null && !info.operator?.trim();
}

/**
 * Asks the server to quit. It stops within seconds of answering, and may stop before the answer leaves, so a server
 * that could not be reached has quit too; any other error (a refusal) is the caller's to show.
 */
export async function quitServer(post: () => Promise<unknown> = () => apiPost("actions/quit")): Promise<void> {
  try {
    await post();
  } catch (e) {
    if (e instanceof ApiError && e.code === "network") return;
    throw e;
  }
}

/**
 * The message of an error as the user should see it: the API's own, already in the UI language, or, for a server that
 * could not be reached, the text given (the browser's "Failed to fetch" says nothing to the user).
 */
export function errorText(e: unknown, unreachable: string): string {
  if (e instanceof ApiError && e.code === "network" && unreachable) return unreachable;
  return e instanceof Error ? e.message : String(e);
}
