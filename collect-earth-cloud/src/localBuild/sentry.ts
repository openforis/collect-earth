// The local bundle's stand-in for the `@sentry/node` package: the local mode never turns error
// reports on (its configuration has no telemetry; the desktop app reports its own errors).
import { notInLocalBuild } from './notInLocalBuild.js';

export function init(): never {
  throw notInLocalBuild('Sending error reports to Sentry');
}
export function setTag(): void {}
export function withScope(): void {}
export function captureException(): void {}
export function flush(): Promise<boolean> {
  return Promise.resolve(true);
}
export function getClient(): undefined {
  return undefined;
}
