import type { ListFilter } from "./types";

// UI preferences. Best effort: storage can be unavailable (private mode,
// blocked site data), in which case the defaults are used.
export interface Prefs {
  filter?: ListFilter;
}

const KEY = "ce.plotsMap.prefs";

export function loadPrefs(): Prefs {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; }
}

export function savePrefs(prefs: Prefs): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
