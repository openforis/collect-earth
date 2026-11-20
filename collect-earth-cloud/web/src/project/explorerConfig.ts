// The Imagery card's Explorer section: the configuration document (`explorer_config`) of the Explorer window, edited on
// the Explorer's own page (/configure) in a dialog. Here: the one-line summary of what is stored, the page's address and
// which of its messages to believe.

/** The parts of the Explorer's catalogue (collect-earth-explorer/functions/catalogue.json) the dashboard reads. */
export type Catalogue = {
  layers: Record<string, { title: string }>;
  charts: Record<string, { title: string }>;
  standard: { layers: { type: string }[]; charts: { type: string }[] };
};
type Kind = "layers" | "charts";
/** A half's number of entries, or "standard" when it is the standard list and the catalogue is not at hand to count it. */
export type ExplorerSummary = { layers: number | "standard"; charts: number | "standard"; names: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What the stored document shows, as the Explorer reads it; null for the standard window (nothing stored). */
export function summarise(stored: string, catalogue: Catalogue | null): ExplorerSummary | null {
  if (stored.trim() === "") return null;
  let doc: unknown;
  try {
    doc = JSON.parse(stored);
  } catch {
    return null; // the server stores only JSON objects: the Explorer would show the standard window
  }
  if (!isObject(doc)) return null;
  const names: string[] = [];
  const half = (kind: Kind): number | "standard" => {
    const raw = doc[kind];
    const known = (Array.isArray(raw) ? raw : []).filter(
      (e): e is { type: string } => isObject(e) && typeof e.type === "string" && (!catalogue || Object.hasOwn(catalogue[kind], e.type)),
    );
    // As the Explorer: a half left out, or with nothing it knows, is the standard one; an empty chart list is honoured
    const honoured = known.length > 0 || (kind === "charts" && Array.isArray(raw) && raw.length === 0);
    const list = honoured ? known : catalogue?.standard[kind];
    if (!list) return "standard";
    if (catalogue) names.push(...list.map((e) => catalogue[kind][e.type]?.title ?? e.type));
    return list.length;
  };
  return { layers: half("layers"), charts: half("charts"), names };
}

/** The Explorer's setup page: the stored document, a plot of the project to preview on (else its sample plot), the language. */
export function configureUrl(base: string, stored: string, lang: string, plot: { lat: number; lon: number } | null): string {
  const params = [
    stored ? `config=${encodeURIComponent(stored)}` : "",
    plot ? `geoJson=${encodeURIComponent(JSON.stringify({ type: "Point", coordinates: [plot.lon, plot.lat] }))}` : "",
    `lang=${encodeURIComponent(lang)}`,
  ];
  return `${base}/configure?${params.filter(Boolean).join("&")}`;
}

/**
 * The setup page's report, `{ source: "collect-earth-explorer", type: "config", config, valid }`, from a message event;
 * null unless it comes from the Explorer's origin, from the dialog's own frame, and has that shape.
 */
export function configMessage(
  event: { origin: string; source: unknown; data: unknown },
  origin: string,
  frame: unknown,
): { config: string; valid: boolean } | null {
  if (event.origin !== origin || !frame || event.source !== frame) return null;
  const d = event.data;
  if (!isObject(d) || d.source !== "collect-earth-explorer" || d.type !== "config" || typeof d.config !== "string" || typeof d.valid !== "boolean") return null;
  return { config: d.config, valid: d.valid };
}
