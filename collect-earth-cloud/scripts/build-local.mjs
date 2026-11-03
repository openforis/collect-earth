// The server as two files plain Node runs, with no node_modules (docs/plans/2026-11-03-desktop-dashboard.md,
// Task 2): dist/server.mjs (from src/index.ts) and dist/qualityWorker.mjs (src/qualityWorker.ts),
// which src/qualityService.ts finds beside the server. For the local mode (LOCAL_MODE=1) that
// Collect Earth runs on the desktop: the modules only the cloud uses (the Postgres store and its
// migrations, the AI client, SMTP mail) are replaced by the stand-ins of src/localBuild/, so `pg`,
// `pg-connection-string`, `@google/genai` and `nodemailer` are not in the bundle. The build fails
// if any of them is still reached.
//
//   npm run build:local
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const outdir = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Source module -> its stand-in in the local build. */
const STAND_INS = new Map([
  [join(src, 'store', 'postgres.ts'), join(src, 'localBuild', 'postgres.ts')],
  [join(src, 'store', 'migrate.ts'), join(src, 'localBuild', 'migrate.ts')],
  [join(src, 'ai', 'gemini.ts'), join(src, 'localBuild', 'gemini.ts')],
]);
const PACKAGE_STAND_INS = new Map([['nodemailer', join(src, 'localBuild', 'nodemailer.ts')]]);
/** Packages that must not end up in the bundle. */
const CLOUD_ONLY_PACKAGES = ['pg', 'pg-connection-string', 'pg-pool', 'pg-protocol', '@google/genai', 'google-auth-library', 'nodemailer'];

const localStandIns = {
  name: 'local-stand-ins',
  setup(b) {
    b.onResolve({ filter: /^nodemailer$/ }, (args) => ({ path: PACKAGE_STAND_INS.get(args.path) }));
    b.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
      const target = resolve(args.resolveDir, args.path).replace(/\.js$/, '.ts');
      const standIn = STAND_INS.get(target);
      return standIn ? { path: standIn } : undefined;
    });
  },
};

rmSync(outdir, { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { server: 'src/index.ts', qualityWorker: 'src/qualityWorker.ts' },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Some bundled packages are CommonJS and call require() for Node's own modules.
  banner: { js: "import { createRequire as __ceCreateRequire } from 'node:module'; const require = __ceCreateRequire(import.meta.url);" },
  define: { __COLLECT_EARTH_CLOUD_VERSION__: JSON.stringify(version) },
  plugins: [localStandIns],
  legalComments: 'linked',
  metafile: true,
  logLevel: 'warning',
});

const reached = Object.keys(result.metafile.inputs).filter((input) =>
  CLOUD_ONLY_PACKAGES.some((pkg) => input.includes(`node_modules/${pkg}/`)),
);
if (reached.length > 0) {
  console.error(`The local bundle reaches cloud-only packages:\n  ${reached.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  if (file.endsWith('.mjs')) {
    console.log(`${file}  ${(output.bytes / 1024 / 1024).toFixed(2)} MB`);
  }
}
