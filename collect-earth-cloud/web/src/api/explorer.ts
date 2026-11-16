// The Explorer (collect-earth-explorer), the window Collect Earth opens on each plot: not this server, so a plain
// cross-origin fetch of its public catalogue (it answers any origin), without the session.

import type { Catalogue } from "../project/explorerConfig";

/** Where the Explorer runs; a self-hosted server can build its dashboard for its own Explorer (DEPLOY.md). */
export const EXPLORER_URL: string = import.meta.env.VITE_EXPLORER_URL || "https://explorer.collectearth.org";

/** GET /api/catalogue: the layer and chart types the Explorer offers, their parameters and its standard configuration. */
export async function getCatalogue(): Promise<Catalogue> {
  const response = await fetch(`${EXPLORER_URL}/api/catalogue`, { credentials: "omit", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`The Explorer's catalogue answered HTTP ${response.status}`);
  const body: unknown = await response.json();
  const b = (body ?? {}) as Partial<Catalogue>;
  if (typeof body !== "object" || !b.layers || !b.charts || !b.standard) throw new Error("The Explorer's answer is not a catalogue");
  return body as Catalogue;
}
