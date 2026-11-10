/**
 * The query of a Collect Earth import: the accounts the coordinator typed for the operators of the backup, the empty
 * ones left out (their records keep the name Collect Earth wrote). "" when none was typed.
 */
export function collectImportQuery(accounts: Record<string, string>): string {
  const named = Object.fromEntries(Object.entries(accounts).map(([name, username]) => [name, username.trim()]).filter(([, username]) => username !== ""));
  return Object.keys(named).length === 0 ? "" : `?operators=${encodeURIComponent(JSON.stringify(named))}`;
}
