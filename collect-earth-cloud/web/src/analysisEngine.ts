// The analysis page's engine: DuckDB-WASM holds the tables and builds each cube (SQL from src/analysisView.ts);
// Perspective shows the pivot. Both run in the browser, from files the dashboard serves itself (web/dist/assets), or
// that the stand-alone file holds (src/analysisAssets.ts): nothing is fetched from elsewhere, so both work offline. Loaded with the page only (its code and
// wasm are most of the dashboard's size). What trial S7 found (collect-earth-cloud/trials/s7-pivot/README.md):
// @perspective-dev 5.6, one apache-arrow (DuckDB's, 17), Perspective given an ArrayBuffer, the viewer element made
// from script after the library loaded, CSV read with the types stated.
import * as duckdb from "@duckdb/duckdb-wasm";
import perspective from "@perspective-dev/client";
import { init_client as initViewer } from "@perspective-dev/viewer";
import "@perspective-dev/viewer/dist/css/pro.css";
import viewerEs from "@perspective-dev/viewer/dist/css/intl/es.css?inline";
import viewerFr from "@perspective-dev/viewer/dist/css/intl/fr.css?inline";
import viewerPt from "@perspective-dev/viewer/dist/css/intl/pt.css?inline";
import { tableFromIPC } from "apache-arrow";
import { analysisAssets } from "./analysisAssets";
import type { AnalysisData } from "./api";
import { codesCsv, readCsvSql, type Cube, type ViewConfig } from "./analysisView";

type PerspectiveClient = Awaited<ReturnType<typeof perspective.worker>>;
type PerspectiveTable = Awaited<ReturnType<PerspectiveClient["table"]>>;

/** The viewer element's methods used here. */
export interface Viewer extends HTMLElement {
  load(client: PerspectiveClient): Promise<void>;
  restore(config: ViewConfig): Promise<void>;
  save(): Promise<ViewConfig>;
  reset(all?: boolean): Promise<void>;
  delete(): Promise<void>;
  getView(): Promise<{ to_csv(): Promise<string>; column_paths(): Promise<unknown[][]>; to_arrow(): Promise<ArrayBuffer> }>;
  toggleConfig(force?: boolean): Promise<void>;
}

let started: Promise<{ client: PerspectiveClient }> | null = null;

/** Perspective's three wasm and its worker, once per page load. */
function startPerspective(): Promise<{ client: PerspectiveClient }> {
  if (!started) {
    started = (async () => {
      perspective.init_server(analysisAssets.perspectiveServer());
      // The client shares the viewer's wasm (it takes the registered viewer's module): no second one
      await initViewer(analysisAssets.perspectiveViewer());
      await Promise.all([import("@perspective-dev/viewer-datagrid"), import("@perspective-dev/viewer-charts")]);
      return { client: await perspective.worker() };
    })();
    started.catch(() => (started = null));
  }
  return started;
}

/** IPC bytes as Perspective takes them: an ArrayBuffer, not a view on one. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export type Step = "database" | "tables" | "pivot";

export class AnalysisEngine {
  private constructor(
    private readonly db: duckdb.AsyncDuckDB,
    private readonly conn: duckdb.AsyncDuckDBConnection,
    private readonly client: PerspectiveClient,
  ) {}

  private table: PerspectiveTable | null = null;

  /** Starts DuckDB and Perspective and loads the tables (the code tables with labels in the language). */
  static async open(data: AnalysisData, language: string, onStep: (step: Step) => void = () => {}): Promise<AnalysisEngine> {
    onStep("database");
    const perspectiveReady = startPerspective();
    const worker = new Worker(await analysisAssets.duckdbWorker());
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(await analysisAssets.duckdbWasm());
    const conn = await db.connect();
    onStep("tables");
    for (const t of data.tables) {
      if (t.name === "_lists") continue;
      const file = `${t.name}.csv`;
      await db.registerFileText(file, t.csv);
      await conn.query(readCsvSql(t.name, file, t.columns));
      await db.dropFile(file);
    }
    const engine = new AnalysisEngine(db, conn, (await perspectiveReady).client);
    await engine.setLanguage(data, language);
    return engine;
  }

  /** The code tables' labels in another language. */
  async setLanguage(data: AnalysisData, language: string): Promise<void> {
    const codes = codesCsv(data.model, language);
    await this.db.registerFileText("_codes.csv", codes.csv);
    await this.conn.query(readCsvSql("_codes", "_codes.csv", codes.columns));
    await this.db.dropFile("_codes.csv");
  }

  /** The rows of a cube, given to the viewer as a table of the client (the previous one deleted). */
  async show(viewer: Viewer, cube: Cube, config: ViewConfig, title: string): Promise<number> {
    // The Arrow bytes DuckDB wrote, given to Perspective as they are. Not read into JavaScript and written again:
    // apache-arrow's writer leaves out the values of a boolean column whose rows are all null (a yes/no question
    // nobody answered), which Perspective refuses ("Buffer #1 too small in array of type bool").
    const bytes = await this.conn.useUnsafe((bindings, conn) => bindings.runQuery(conn, cube.sql));
    const rows = tableFromIPC(bytes);
    const name = `${cube.table}_${++this.shown}`;
    const table = await this.client.table(toBuffer(bytes), { name });
    if (!this.viewers.has(viewer)) {
      await viewer.load(this.client);
      this.viewers.add(viewer);
    }
    await viewer.restore({ ...config, table: name, title });
    const previous = this.table;
    this.table = table;
    if (previous) await previous.delete().catch(() => {});
    return rows.numRows;
  }

  private shown = 0;
  private readonly viewers = new WeakSet<Viewer>();

  /** The rows of a query as plain objects (numbers for DuckDB's big integers, ISO days for dates). */
  async rows(sql: string): Promise<Record<string, unknown>[]> {
    const result = await this.conn.query(sql);
    const dates = new Set(result.schema.fields.filter((f) => String(f.type).startsWith("Date")).map((f) => f.name));
    return result.toArray().map((row: { toJSON(): Record<string, unknown> }) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.toJSON())) {
        out[k] = typeof v === "bigint" ? Number(v) : dates.has(k) && typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : v;
      }
      return out;
    });
  }

  /**
   * What the colours of the viewer's chart are given by, in the order the chart takes them (analysisColors.ts): its
   * series (the values of its split field, from the view's column paths) and the values of a column `colour` (a
   * treemap's Color column: Perspective's charts number them as its Arrow dictionary does).
   */
  async chartOrder(viewer: Viewer, colour: string | null): Promise<{ paths: unknown[][]; colourValues: unknown[] | null }> {
    const view = await viewer.getView();
    const paths = await view.column_paths();
    let colourValues: unknown[] | null = null;
    if (colour) {
      const column = tableFromIPC(new Uint8Array(await view.to_arrow())).getChild(colour);
      const dictionary = column?.data[0]?.dictionary;
      colourValues = dictionary ? [...dictionary] : column ? [...new Set([...column])] : null;
    }
    return { paths, colourValues };
  }

  /** What the viewer shows, as CSV (the pivot as it is: its rows, columns and totals). */
  async viewCsv(viewer: Viewer): Promise<string> {
    const view = await viewer.getView();
    return view.to_csv();
  }

  async close(): Promise<void> {
    await this.table?.delete().catch(() => {});
    await this.conn.close().catch(() => {});
    await this.db.terminate().catch(() => {});
  }
}

/** A fresh viewer element: made from script, once the library is loaded (one in the page before crashed, S7). */
export function createViewer(): Viewer {
  const viewer = document.createElement("perspective-viewer") as Viewer;
  viewer.setAttribute("theme", "Pro Light");
  return viewer;
}

/** Perspective's own words (Group By, Where, the chart names…) in the dashboard's language: English is its own. */
const VIEWER_LANGUAGES: Record<string, string> = { es: viewerEs, fr: viewerFr, pt: viewerPt };

export function setViewerLanguage(language: string): void {
  let style = document.getElementById("perspective-language") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "perspective-language";
    document.head.appendChild(style);
  }
  style.textContent = VIEWER_LANGUAGES[language] ?? "";
}
