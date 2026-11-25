// A project's survey guide, kept apart from its project file: a PDF the server keeps, or a link to one kept elsewhere.
// The project file carries its address only (GUIDE_PROPERTY), which Collect Earth opens in the browser; the PDF an
// older project file brings inside (GUIDE_ENTRY) is taken out when it is uploaded.
import { readZip, zipCep, CepError } from './cep.js';

/** The key of project_definition.properties with the guide's address; Collect Earth reads it (EarthProperty.SURVEY_GUIDE_URL). */
export const GUIDE_PROPERTY = 'survey_guide_url';
/** The guide inside a project file, as Collect's Survey Designer and Collect Earth 1 put it. */
export const GUIDE_ENTRY = 'survey_guide.pdf';
/** The largest PDF kept (a request holds 32 MB). */
export const MAX_GUIDE_BYTES = 25 * 1024 * 1024;
const MAX_LINK = 2000;

export interface SurveyGuide {
  kind: 'file' | 'link';
  /** The address people open */
  url: string;
  filename: string;
  /** The PDF's size; 0 for a link */
  bytes: number;
  token: string;
  updatedAt: number;
}

/** The server's address of a project's PDF, under its public base. */
export const guideAddress = (base: string, projectId: string, token: string): string => `${base.replace(/\/+$/, '')}/guide/${projectId}/${token}`;

export const isPdf = (data: Uint8Array): boolean => data.length > 5 && Buffer.from(data.subarray(0, 5)).toString('latin1') === '%PDF-';

/** Why a link cannot be a guide's address, in words; null when it can. */
export function linkProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return 'url must be the address of the guide';
  const url = raw.trim();
  if (url.length > MAX_LINK) return `url must be at most ${MAX_LINK} characters`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'url must be a full address, starting with https://';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'url must start with https:// or http://';
  return null;
}

/** A file name fit for a header and a list: its last part, without control characters; "survey_guide.pdf" when empty. */
export function guideFilename(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200) : '';
  return name === '' ? GUIDE_ENTRY : name;
}

/**
 * A project file without the guide it brings inside, and that guide: null when it has none, or one that is no PDF or
 * larger than the server keeps (the project file is then left as it is). Throws CepError for a zip the server cannot read.
 */
export function withoutBundledGuide(zip: Buffer, date: Date): { cep: Buffer; guide: Buffer | null } {
  const entries = readZip(zip);
  const guide = entries.get(GUIDE_ENTRY);
  if (!guide || !isPdf(guide) || guide.length > MAX_GUIDE_BYTES) return { cep: zip, guide: null };
  const rest = new Map(entries);
  rest.delete(GUIDE_ENTRY);
  return { cep: zipCep(rest, date), guide: Buffer.from(guide) };
}

export { CepError };
