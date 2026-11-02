/**
 * The Content-Disposition of a download, the one helper of every route that sends a file
 * (the export, plot files, "To check again" files). A header may hold no CR, LF or
 * character beyond Latin-1 (Node refuses it: a 500), so:
 * - `filename="…"` for old clients: letters, digits, ".", "_" and "-" kept, every other
 *   character (a space, a quote, a backslash, a line break, an emoji) one "_";
 * - `filename*=UTF-8''…` (RFC 5987) with the real name, percent-encoded; a lone surrogate
 *   (text that is not well-formed) becomes U+FFFD rather than making encodeURIComponent throw.
 */
export function attachment(filename: string, fallback = 'download.csv'): string {
  const wellFormed = filename.replace(/[\ud800-\udfff]/gu, '�');
  const ascii = wellFormed.replace(/[^A-Za-z0-9._-]/gu, '_') || fallback;
  const encoded = encodeURIComponent(wellFormed || fallback).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
