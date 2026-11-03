// The local bundle's stand-in for the `nodemailer` package (SMTP mail): see notInLocalBuild.ts.
import { notInLocalBuild } from './notInLocalBuild.js';

export function createTransport(): never {
  throw notInLocalBuild('Sending mail over SMTP');
}
