import { describe, expect, it } from 'vitest';
import { attachment } from '../src/download.js';

/** The real name back from filename*, as a browser reads it (RFC 5987). */
const realName = (header: string) => decodeURIComponent(/filename\*=UTF-8''([^;]*)$/.exec(header)![1]);
const asciiName = (header: string) => /filename="([^"]*)"/.exec(header)![1];

describe('Content-Disposition of every download (attachment)', () => {
  it('a plain name as it is', () => {
    expect(attachment('plots.csv')).toBe(`attachment; filename="plots.csv"; filename*=UTF-8''plots.csv`);
  });

  it('only safe ASCII in the plain name; the real one in filename*, for quotes, CR/LF, beyond Latin-1 and emoji', () => {
    for (const name of ['To check again – North Ñandú.csv', 'a "quoted" \\ name.csv', 'line\r\nInjected: header.csv', 'plots \u{1f332}\u{1f333}.csv', "it's (a) *star*.csv"]) {
      const header = attachment(name);
      // A header must hold no CR, LF or character beyond Latin-1 (Node refuses it), and the
      // plain name no quote or backslash that would end it early.
      expect(header, name).toMatch(/^[\x20-\x7e]+$/);
      expect(asciiName(header), name).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(realName(header), name).toBe(name);
    }
    // One "_" per character, an emoji too (not one per UTF-16 half).
    expect(asciiName(attachment('plots \u{1f332}.csv'))).toBe('plots__.csv');
    expect(asciiName(attachment('Bolivia NFI-data.csv'))).toBe('Bolivia_NFI-data.csv');
  });

  it('a lone surrogate (a name that is not well-formed text) does not throw', () => {
    const header = attachment('bad \ud800 name.csv');
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(realName(header)).toBe('bad � name.csv');
  });

  it('an empty name gets a fallback', () => {
    expect(asciiName(attachment('', 'export.csv'))).toBe('export.csv');
  });
});
