// Who holds a plot as a main plot, kept small: most plots of a divided file have one holder.

/**
 * Who holds a plot as a main plot: nobody (null), one username, or a set when several do
 * (a whole project of plots held by one person each costs a string per plot, not a Set).
 */
export type Holders = string | ReadonlySet<string> | null;

export function holderCount(h: Holders | undefined): number {
  return h == null ? 0 : typeof h === 'string' ? 1 : h.size;
}

export function holderHas(h: Holders | undefined, username: string): boolean {
  return h == null ? false : typeof h === 'string' ? h === username : h.has(username);
}

export function holderList(h: Holders | undefined): readonly string[] {
  return h == null ? [] : typeof h === 'string' ? [h] : [...h];
}
