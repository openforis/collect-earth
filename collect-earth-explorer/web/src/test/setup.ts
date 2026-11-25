import { afterEach } from "vitest";

// The remembered view and folds (and the other explorer.* preferences) must not leak from one test into the next.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
