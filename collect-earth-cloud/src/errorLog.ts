// The server's recent warnings and errors, kept in memory for the owner's "many server errors" alert (src/ownerAlerts.ts),
// which attaches them to its mail: the administrator sees what failed without opening the hosting's log viewer.
//
// The lines are the server's own log lines (pino's JSON, one per line), copied as they are written: the same redaction
// applies (src/logRedact.ts: no token of an address, no body), so nothing is in the attachment that the log does not
// already say. Only warnings and errors (pino level 40 and above): the 500s Fastify logs, the database busy (503), the
// failures of the background work. At most MAX_BYTES are kept, the newest: the oldest lines go first. Per server
// instance, as the alert's counts are; a restart starts empty.
import { Writable } from 'node:stream';

/** What the mail may carry: 500 KB, the most recent lines. */
export const MAX_BYTES = 500 * 1024;
/** pino's "warn" */
const MIN_LEVEL = 40;
const LEVEL = /"level":(\d+)/;

export class ErrorLog {
  private lines: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes = MAX_BYTES) {}

  /** A line of the log (pino's JSON): kept when it is a warning or an error. */
  add(line: string): void {
    const level = Number(LEVEL.exec(line)?.[1] ?? 0);
    if (level < MIN_LEVEL) return;
    let text = line.endsWith('\n') ? line : `${line}\n`;
    // a line alone over the limit (a huge error): its start, the part that names it
    if (Buffer.byteLength(text) > this.maxBytes) text = `${Buffer.from(text).subarray(0, this.maxBytes - 1).toString('utf8').replace(/�+$/, '')}\n`;
    this.lines.push(text);
    this.bytes += Buffer.byteLength(text);
    while (this.bytes > this.maxBytes && this.lines.length > 0) this.bytes -= Buffer.byteLength(this.lines.shift()!);
  }

  /** The lines kept, oldest first (at most maxBytes), or null when there are none. */
  text(): string | null {
    return this.lines.length ? this.lines.join('') : null;
  }

  /** How many lines are kept. */
  size(): number {
    return this.lines.length;
  }

  /**
   * A stream for the logger that writes everything to `target` (the log as before: stdout, stderr) and keeps the
   * warnings and errors here. pino writes one whole line per write.
   */
  tee(target: NodeJS.WritableStream): Writable {
    return new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        for (const line of text.split('\n')) if (line) this.add(line);
        if (target.write(chunk)) callback();
        else target.once('drain', () => callback());
      },
    });
  }
}
