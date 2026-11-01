/**
 * Which Collect Earth a member runs, from the User-Agent kept in
 * member_activity.client_agent (Task 21).
 *
 * Collect Earth sends `CollectEarth/<version> cloud-sync`, with `unknown` when it cannot
 * read its version. The releases before that sent `CollectEarth-cloud-sync`. The release
 * that hides checks is the first one that sends a version, so any `CollectEarth/<v>`
 * agent hides checks, and the old agent means an older Collect Earth.
 */
export type ClientVersion =
  | { kind: 'collect-earth'; version: string | null; hidesChecks: boolean }
  | { kind: 'old-collect-earth' }
  | { kind: 'unknown' };

/** The User-Agent of the Collect Earth releases that sent no version. */
export const OLD_COLLECT_EARTH_AGENT = 'CollectEarth-cloud-sync';

const COLLECT_EARTH_AGENT = /^CollectEarth\/(\S+)/;

/** What a stored client agent says; browsers, other clients and none are `unknown`. */
export function parseClientAgent(agent: string | null | undefined): ClientVersion {
  if (!agent) return { kind: 'unknown' };
  if (agent === OLD_COLLECT_EARTH_AGENT) return { kind: 'old-collect-earth' };
  const match = COLLECT_EARTH_AGENT.exec(agent);
  if (!match) return { kind: 'unknown' };
  const version = match[1] === 'unknown' ? null : match[1];
  return { kind: 'collect-earth', version, hidesChecks: true };
}

/** Whether a User-Agent is Collect Earth's, in either form (only those are kept). */
export function isCollectEarthAgent(agent: string | null | undefined): boolean {
  return parseClientAgent(agent).kind !== 'unknown';
}
