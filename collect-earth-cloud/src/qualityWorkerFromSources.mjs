// The quality worker run from the TypeScript sources (npm start under tsx, vitest): Node 22.18 and later
// load a .ts worker by themselves (type stripping), without tsx, so its imports of './x.js' would not find
// './x.ts'. tsx is registered in this thread first, then the worker is loaded through it.
import { register } from 'tsx/esm/api';

register();
await import('./qualityWorker.ts');
