import { createContext, useContext } from "react";
import type { Me, ServerInfo, Session } from "./api";
import type { Language } from "./i18n";

export interface AppState {
  info: ServerInfo;
  me: Me | null;
  language: Language;
  setLanguage: (language: Language) => void;
  /** Keeps the new session and loads the person's profile. */
  loggedIn: (session: Session) => Promise<void>;
  logOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshInfo: () => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("useApp outside AppContext");
  return state;
}
