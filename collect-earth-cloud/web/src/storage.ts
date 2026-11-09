// Browser storage, wrapped: localStorage can be missing or throw (private windows,
// blocked site data). The dashboard keeps working without it - the person just has
// to log in again after a reload.

const TOKEN_KEY = "collectEarthCloud.session";
const LANGUAGE_KEY = "collectEarthCloud.language";
const ANNOUNCEMENT_KEY = "collectEarthCloud.announcementDismissed";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore: storage unavailable
  }
}

let memoryToken: string | null = null;

export function getToken(): string | null {
  return memoryToken ?? read(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  memoryToken = token;
  write(TOKEN_KEY, token);
}

export function getStoredLanguage(): string | null {
  return read(LANGUAGE_KEY);
}

export function storeLanguage(language: string): void {
  write(LANGUAGE_KEY, language);
}

/** The announcement this browser dismissed (announcementKey), or null. */
export function getDismissedAnnouncement(): string | null {
  return read(ANNOUNCEMENT_KEY);
}

export function storeDismissedAnnouncement(key: string): void {
  write(ANNOUNCEMENT_KEY, key);
}

// The analysis page's saved views, per project, in this browser (src/analysisView.ts reads them).
const ANALYSIS_VIEWS_KEY = "collectEarthCloud.analysisViews.";

export function getAnalysisViews(projectId: string): string | null {
  return read(ANALYSIS_VIEWS_KEY + projectId);
}

export function storeAnalysisViews(projectId: string, text: string | null): void {
  write(ANALYSIS_VIEWS_KEY + projectId, text);
}
