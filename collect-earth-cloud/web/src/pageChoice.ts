import { localPage } from "./localMode";
import { isLoggedOutRoute, isPublicRoute, type Route } from "./router";

// Which page the dashboard shows for an address, from the server's state and whether
// the person is logged in. Kept apart from the React code so it can be tested.

export type PageChoice =
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "signup" }
  /** The local mode, not signed in: the dashboard is opened, signed in, from Collect Earth. */
  | { kind: "localSignedOut" }
  | { kind: "redirect"; to: string }
  | { kind: "route"; route: Route };

/**
 * `localProjectId`: in the local mode (server.localMode), the one project, from the account's
 * memberships (null while unknown).
 */
export function choosePage(
  route: Route,
  server: { needsSetup: boolean; localMode?: boolean },
  loggedIn: boolean,
  localProjectId: string | null = null,
  /** The server requires two-step sign-in of this person (a coordinator) and they have not set it up yet. */
  secondStepPending = false,
): PageChoice {
  // The local mode (one person, on their own computer): no accounts, setup, mail or invitations;
  // Collect Earth signs the browser in with a one-time link.
  if (server.localMode) {
    if (!loggedIn) return { kind: "localSignedOut" };
    return localPage(route, localProjectId);
  }
  // Invitation and password reset links work for everyone, whatever else is going on.
  if (isPublicRoute(route)) return { kind: "route", route };
  // A new server: nothing else makes sense until its administrator exists.
  if (server.needsSetup) return { kind: "setup" };
  if (!loggedIn) {
    // Any other page needs an account: log in right here, then that page opens.
    return route.name === "signup" ? { kind: "signup" } : { kind: "login" };
  }
  if (isLoggedOutRoute(route)) return { kind: "redirect", to: "/" };
  // The account page sets it up; every other page waits (the server refuses their coordinator pages meanwhile)
  if (secondStepPending && route.name !== "account") return { kind: "redirect", to: "/account" };
  return { kind: "route", route };
}
