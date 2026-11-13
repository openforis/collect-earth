import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// src/wire/ holds the types of what the server and the dashboard send each other (its README.md).
// The dashboard imports them with `import type`, so the folder must stay types only: a value or an
// import from elsewhere would pull server code into the dashboard's typecheck or bundle.
const dir = join(import.meta.dirname, '..', 'src', 'wire');

/** The file's statements, comments left out, one per line where they start. */
function code(file: string): string[] {
  const text = readFileSync(join(dir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return text.split('\n').filter((line) => /^\S/.test(line) && !/^[})\]|]/.test(line));
}

describe('src/wire', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('has files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s declares types only, and imports types of this folder only', (file) => {
    for (const line of code(file)) {
      if (line.startsWith('import ')) {
        expect(line, `${file}: ${line}`).toMatch(/^import type \{[^}]*\} from '\.\/[\w-]+\.js';$/);
      } else {
        expect(line, `${file}: ${line}`).toMatch(/^export (interface|type) /);
      }
    }
  });
});
