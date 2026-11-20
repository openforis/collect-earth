// The /configure page: an editor of the configuration document (`config`) with a live preview, for the dashboard and
// Collect Earth to embed in an iframe. Its input is the address only (`config`, `geoJson`, `lang`), never a message.
//
// When framed it tells the host, on load and after every change:
//   window.parent.postMessage({ source: "collect-earth-explorer", type: "config", config, valid }, "*")
// `config` is the text to store (compact JSON without defaults and blanks, "" for the standard configuration) and
// `valid` whether it may be saved. The document is not secret and hosts are self-hosted at unknown origins, hence "*".
// The host has its own Save and Cancel.
import { useEffect, useId, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import {
  add, ANALYSES, catalogue, docValid, entryErrors, EXPLORER_CONFIG_MAX, isCustom, isFixed, move, parseDoc, presetDoc, PRESETS,
  previewUrl, remove, serialiseDoc, summarize, type Doc, type Entry, type EntryError, type Kind,
} from "./configDoc";
import { CONFIGURE_DICTIONARIES, ct, type CKey } from "./texts";
import "./Configure.css";

const THIS_YEAR = new Date().getUTCFullYear();
// The dashboard's sample: a forest edge in Rondônia, Brazil.
const SAMPLE_PLOT = JSON.stringify({ type: "Point", coordinates: [-62.98, -9.97] });
const KINDS: Kind[] = ["layers", "charts"];
const SIZE_SHOWN = 1500;
const PREVIEW_DELAY = 800;
/** Kept out of the main fields: what few surveys change. */
const MORE = ["label", "years", "maxCloud"];
const CUSTOM = "*custom";

/** A text by a key built from a catalogue name, or `fallback` for a name newer than the texts. */
const ctOr = (key: string, fallback: string) => (Object.hasOwn(CONFIGURE_DICTIONARIES.en, key) ? ct(key as CKey) : fallback);
const typeName = (kind: Kind, type: string) => ctOr(`type.${type}`, catalogue[kind][type].title);

type Undo = { doc: Doc; message: string };

export default function Configure() {
  const [query] = useState(() => new URLSearchParams(window.location.search));
  const [{ doc: first, unknown }] = useState(() => parseDoc(query.get("config") ?? ""));
  const [doc, setDoc] = useState(first);
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const stored = serialiseDoc(doc);
  const valid = docValid(doc, THIS_YEAR);
  const plot = query.get("geoJson") || SAMPLE_PLOT;
  const langParam = query.get("lang") ?? undefined;
  const [preview, setPreview] = useState(() => previewUrl(stored, plot, langParam));

  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ source: "collect-earth-explorer", type: "config", config: stored, valid }, "*");
  }, [stored, valid]);
  useEffect(() => {
    if (!valid) return;
    const timer = setTimeout(() => setPreview(previewUrl(stored, plot, langParam)), PREVIEW_DELAY);
    return () => clearTimeout(timer);
  }, [stored, valid, plot, langParam]);

  const edit = (next: Doc) => {
    setDoc(next);
    setUndo(null);
  };
  const replace = (next: Doc, message: string) => {
    setUndo({ doc, message });
    setDoc(next);
    setOpen(null);
  };
  const setList = (kind: Kind, list: Entry[]) => edit({ ...doc, [kind]: list });
  const size = stored.length;

  return (
    <div className="configure">
      <main className="configure-editor">
        <header className="brand">
          <img src="/logo.png" alt="Collect Earth · Open Foris" width="129" height="56" />
          <span>Explorer</span>
        </header>
        <h1>{ct("title")}</h1>
        <p className="configure-explain">{ct("explain")}</p>
        {unknown && <p className="config-notice" role="alert">{ct("unknown")}</p>}

        <section aria-labelledby="configure-presets">
          <h2 id="configure-presets">{ct("presets")}</h2>
          <p className="configure-hint">{ct("presetsHint")}</p>
          <ul className="configure-presets">
            {PRESETS.map((name) => {
              const label = ct(`preset.${name}` as CKey);
              const current = valid && serialiseDoc(presetDoc(name)) === stored;
              return (
                <li key={name}>
                  <button type="button" className="configure-preset" aria-current={current || undefined}
                    onClick={() => replace(presetDoc(name), name === "standard" ? ct("restored") : ct("replaced", { name: label }))}>
                    <strong>{label}</strong>{" "}
                    <span>{ct(`presetHelp.${name}` as CKey)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {undo && (
          <p className="configure-undo" role="status">
            {undo.message}{" "}
            <button type="button" onClick={() => { setDoc(undo.doc); setUndo(null); }}>{ct("undo")}</button>
          </p>
        )}

        {KINDS.map((kind) => (
          <section key={kind} aria-labelledby={`configure-${kind}`}>
            <h2 id={`configure-${kind}`}>{ct(kind)}</h2>
            {doc[kind].length === 0 && <p className="configure-hint">{ct("noCharts")}</p>}
            <ol className="configure-list">
              {doc[kind].map((entry, index) => {
                const key = `${kind}:${index}`;
                return (
                  <EntryRow key={key} kind={kind} entry={entry} index={index} count={doc[kind].length} open={open === key}
                    onToggle={() => setOpen(open === key ? null : key)}
                    onChange={(e) => setList(kind, doc[kind].map((old, i) => (i === index ? e : old)))}
                    onMove={(delta) => {
                      setList(kind, move(doc[kind], index, delta));
                      if (open === key) setOpen(`${kind}:${index + delta}`);
                    }}
                    onRemove={() => {
                      setList(kind, remove(doc[kind], index));
                      setOpen(null);
                    }} />
                );
              })}
            </ol>
            <AddMenu kind={kind} onAdd={(type) => {
              setList(kind, add(doc[kind], type));
              setOpen(`${kind}:${doc[kind].length}`);
            }} />
          </section>
        ))}

        <footer className="configure-footer">
          <button type="button" className="configure-link" onClick={() => replace(presetDoc("standard"), ct("restored"))}>{ct("reset")}</button>
          {size > SIZE_SHOWN && (
            <span className={size > EXPLORER_CONFIG_MAX ? "configure-error" : undefined} role={size > EXPLORER_CONFIG_MAX ? "alert" : undefined}>
              {ct(size > EXPLORER_CONFIG_MAX ? "sizeOver" : "size", { n: size.toLocaleString(), max: EXPLORER_CONFIG_MAX.toLocaleString() })}
            </span>
          )}
        </footer>
      </main>

      <section className="configure-preview" aria-labelledby="configure-preview">
        <div className="configure-preview-head">
          <h2 id="configure-preview">{ct("preview")}</h2>
          {!query.get("geoJson") && <span>{ct("sample")}</span>}
          {!valid && <span className="configure-error">{ct("previewPaused")}</span>}
        </div>
        <iframe title={ct("preview")} src={preview} />
      </section>
    </div>
  );
}

const ICONS = { up: "M8 13V3M4 7l4-4 4 4", down: "M8 3v10M4 9l4 4 4-4", remove: "M4 4l8 8M12 4l-8 8", chevron: "M6 4l4 4-4 4" };
const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function EntryRow({ kind, entry, index, count, open, onToggle, onChange, onMove, onRemove }: {
  kind: Kind; entry: Entry; index: number; count: number; open: boolean;
  onToggle: () => void; onChange: (e: Entry) => void; onMove: (delta: number) => void; onRemove: () => void;
}) {
  const id = useId();
  const errors = entryErrors(kind, entry, THIS_YEAR);
  const broken = Object.keys(errors).length > 0;
  const summary = summarize(kind, entry);
  const last = kind === "layers" && count === 1;
  return (
    <li className={broken ? "configure-entry configure-broken" : "configure-entry"}>
      <div className="configure-row">
        <button type="button" className="configure-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={onToggle}>
          {icon(ICONS.chevron)}
          <span>
            <span className="configure-name" id={`${id}-name`}>{index + 1}. {typeName(kind, entry.type)}</span>
            <span className="configure-summary">
              {broken && <strong>{ct("needsFixing")}</strong>}
              {broken && summary.length > 0 && " · "}
              {summary.length ? summary.join(", ") : !broken && ct("standardSettings")}
            </span>
          </span>
        </button>
        <button type="button" className="icon-button" aria-label={ct("moveUp")} title={ct("moveUp")} aria-describedby={`${id}-name`} disabled={index === 0} onClick={() => onMove(-1)}>{icon(ICONS.up)}</button>
        <button type="button" className="icon-button" aria-label={ct("moveDown")} title={ct("moveDown")} aria-describedby={`${id}-name`} disabled={index === count - 1} onClick={() => onMove(1)}>{icon(ICONS.down)}</button>
        <button type="button" className="icon-button" aria-label={ct("remove")} title={last ? ct("lastLayer") : ct("remove")} aria-describedby={`${id}-name`} disabled={last} onClick={onRemove}>{icon(ICONS.remove)}</button>
      </div>
      {open && (
        <div className="configure-panel" id={`${id}-panel`}>
          <EntryFields kind={kind} entry={entry} errors={errors} onChange={onChange} />
        </div>
      )}
    </li>
  );
}

/** The entry with parameter `name` set to `value`, or left out for undefined. */
function withParams(entry: Entry, changes: Record<string, unknown>): Entry {
  const params = { ...entry.params };
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete params[name];
    else params[name] = value;
  }
  return { ...entry, params };
}

function EntryFields({ kind, entry, errors, onChange }: { kind: Kind; entry: Entry; errors: Record<string, EntryError>; onChange: (e: Entry) => void }) {
  const specs = catalogue[kind][entry.type].params;
  const p = entry.params;
  const set = (changes: Record<string, unknown>) => onChange(withParams(entry, changes));
  const has = (name: string) => Object.hasOwn(specs, name);
  const field = (name: string) => (
    <ParamField key={name} type={entry.type} name={name} value={p[name]} error={errors[name]} onChange={(v) => set({ [name]: v })} />
  );
  const fixed = isFixed(entry);
  const more = MORE.filter((n) => has(n) && !(fixed && n === "years" && p.years === undefined));
  const [moreOpen, setMoreOpen] = useState(() => more.some((n) => errors[n]));
  const moreId = useId();
  const modeName = useId();
  const analyses = ANALYSES.filter(has);
  const analysisErrors = analyses.filter((n) => errors[n]);

  return (
    <>
      {has("bands") && field("bands")}
      {has("band") && field("band")}
      {has("formula") ? <IndexField entry={entry} errors={errors} set={set} field={field} /> : has("index") && field("index")}
      {entry.type === "sentinel2" ? (
        <fieldset className="configure-group">
          <legend>{ct("mode")}</legend>
          <div className="configure-choices">
            <label>
              <input type="radio" name={modeName} checked={!fixed} onChange={() => set({ start: undefined, end: undefined })} />
              {ct("mode.slider")}
            </label>
            <label>
              <input type="radio" name={modeName} checked={fixed} onChange={() => set({ year: undefined, years: undefined, start: "", end: "" })} />
              {ct("mode.fixed")}
            </label>
          </div>
          {/* A fixed period still shows a year it was given, so its error can be seen and cleared. */}
          {fixed ? ["start", "end", ...(p.year !== undefined ? ["year"] : [])].map(field) : field("year")}
        </fieldset>
      ) : (
        has("year") && field("year")
      )}
      {analyses.length > 0 && (
        <fieldset className="configure-group" aria-describedby={analysisErrors.length ? `${moreId}-analyses` : undefined}>
          <legend>{ct("analyses")}</legend>
          <div className="chart-options chart-chips configure-chips">
            {analyses.map((n) => (
              <label key={n}>
                <input type="checkbox" checked={(p[n] ?? specs[n].default) === true}
                  onChange={(e) => set({ [n]: e.target.checked === specs[n].default ? undefined : e.target.checked })} />
                {ct(`analysis.${n}` as CKey)}
              </label>
            ))}
          </div>
          {analysisErrors.length > 0 && <p className="configure-error" id={`${moreId}-analyses`}>{ct("error.invalid")}</p>}
        </fieldset>
      )}
      {has("rainfall") && field("rainfall")}
      {has("collapsed") && field("collapsed")}
      {more.length > 0 && (
        <>
          <button type="button" className="configure-more" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!moreOpen)}>
            {icon(ICONS.chevron)} {ct("more")}
          </button>
          {moreOpen && <div id={moreId}>{more.map(field)}</div>}
        </>
      )}
    </>
  );
}

/** An index chart's index list, ending with "Custom formula…", which shows the formula and its name. */
function IndexField({ entry, errors, set, field }: {
  entry: Entry; errors: Record<string, EntryError>; set: (changes: Record<string, unknown>) => void; field: (name: string) => ReactNode;
}) {
  const id = useId();
  const spec = catalogue.charts[entry.type].params.index;
  const p = entry.params;
  const custom = isCustom(entry);
  // An index besides a formula (a document written by hand) stays shown, so the formula's error can be resolved here.
  const shown = p.index !== undefined && p.index !== spec.default ? String(p.index) : custom ? CUSTOM : String(p.index ?? spec.default);
  const values = spec.values as string[];
  const options = values.includes(shown) || shown === CUSTOM ? values : [shown, ...values];
  return (
    <>
      <Field id={id} label={ct("param.index")} error={errors.index && message(errors.index, spec, [])}>
        {(a11y) => (
          <select {...a11y} value={shown} onChange={(e) =>
            set(e.target.value === CUSTOM ? { index: undefined, formula: p.formula ?? "" } : { index: e.target.value, formula: undefined, name: undefined })}>
            {options.map((v) => <option key={v} value={v}>{v}</option>)}
            <option value={CUSTOM}>{ct("custom")}</option>
          </select>
        )}
      </Field>
      {custom && field("name")}
      {custom && field("formula")}
    </>
  );
}

function message(error: EntryError, spec: { min?: number; max?: number; type: string }, bands: string[]) {
  const max = spec.type === "year" || spec.type === "yearRange" ? THIS_YEAR : spec.max;
  return ct(`error.${error}` as CKey, { min: String(spec.min ?? ""), max: String(max ?? ""), bands: bands.join(", ") });
}

type A11y = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

/** A labelled control with its error and hint under it, tied to it for screen readers. */
function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: (a11y: A11y) => ReactNode }) {
  const notes = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ");
  return (
    <div className="configure-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": notes || undefined })}
      {error && <p id={`${id}-error`} className="configure-error">{error}</p>}
      {hint && <p id={`${id}-hint`} className="configure-hint">{hint}</p>}
    </div>
  );
}

/** One parameter's control, as its catalogue spec says. Blank means "not set": the default applies and nothing is stored. */
function ParamField({ type, name, value, error, onChange }: { type: string; name: string; value: unknown; error?: EntryError; onChange: (v: unknown) => void }) {
  const id = useId();
  const kind: Kind = Object.hasOwn(catalogue.layers, type) ? "layers" : "charts";
  const spec = catalogue[kind][type].params[name];
  const bands = catalogue.bands[type] ?? [];
  const label = ctOr(`param.${name}`, name);
  const text = error && message(error, spec, bands);
  const shown = value === undefined || value === null ? "" : String(value);
  const toNumber = (s: string) => (s === "" ? undefined : Number(s));
  const max = spec.type === "year" || spec.type === "yearRange" ? THIS_YEAR : spec.max;

  switch (spec.type) {
    case "choice": {
      const current = shown === "" ? String(spec.default) : shown;
      // A value the catalogue does not list (a document edited elsewhere) stays a choice, marked as an error.
      const values = spec.values as string[];
      const options = values.includes(current) ? values : [current, ...values];
      return (
        <Field id={id} label={label} error={text}>
          {(a11y) => (
            <select {...a11y} value={current} onChange={(e) => onChange(e.target.value === spec.default ? undefined : e.target.value)}>
              {options.map((v) => <option key={v} value={v}>{ctOr(`choice.${v}`, v)}</option>)}
            </select>
          )}
        </Field>
      );
    }
    case "bool":
      return (
        <div className="configure-field">
          <label className="configure-check">
            <input type="checkbox" checked={(value ?? spec.default) === true} aria-invalid={error ? true : undefined} aria-describedby={text ? `${id}-note` : undefined}
              onChange={(e) => onChange(e.target.checked === spec.default ? undefined : e.target.checked)} />
            {label}
          </label>
          {text && <p id={`${id}-note`} className="configure-error">{text}</p>}
        </div>
      );
    case "int":
    case "year": {
      const placeholder = spec.default !== undefined ? String(spec.default) : type === "sentinel2" ? ct("last12") : ct("lastYear");
      return (
        <Field id={id} label={label} error={text}>
          {(a11y) => <input {...a11y} type="number" min={spec.min} max={max} step={1} value={shown} placeholder={placeholder} onChange={(e) => onChange(toNumber(e.target.value))} />}
        </Field>
      );
    }
    case "yearRange": {
      const [from, to] = Array.isArray(value) ? value : [undefined, undefined];
      const set = (a: unknown, b: unknown) => onChange(a === undefined && b === undefined ? undefined : [a, b]);
      const describedBy = text ? `${id}-note` : undefined;
      return (
        <fieldset className="configure-field configure-range" aria-describedby={describedBy}>
          <legend>{label}</legend>
          <label>
            {ct("from")}
            <input type="number" min={spec.min} max={max} step={1} value={from ?? ""} placeholder={String(spec.min)} aria-invalid={text ? true : undefined}
              onChange={(e) => set(toNumber(e.target.value), to)} />
          </label>
          <label>
            {ct("to")}
            <input type="number" min={spec.min} max={max} step={1} value={to ?? ""} placeholder={String(max)} aria-invalid={text ? true : undefined}
              onChange={(e) => set(from, toNumber(e.target.value))} />
          </label>
          {text && <p id={`${id}-note`} className="configure-error">{text}</p>}
        </fieldset>
      );
    }
    case "date":
      return (
        <Field id={id} label={label} error={text}>
          {(a11y) => <input {...a11y} type="date" value={shown} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case "text":
      return (
        <Field id={id} label={label} error={text}>
          {(a11y) => (
            <input {...a11y} type="text" value={shown} maxLength={spec.max} onChange={(e) => onChange(e.target.value)}
              placeholder={name === "name" ? t("config.customIndex") : ct("automatic")} />
          )}
        </Field>
      );
    case "formula":
      return (
        <Field id={id} label={label} error={text} hint={ct("formulaHint", { bands: bands.join(", ") })}>
          {(a11y) => (
            <input {...a11y} type="text" className="configure-formula" value={shown} maxLength={spec.max} spellCheck={false}
              placeholder="(nir - red) / (nir + red)" onChange={(e) => onChange(e.target.value)} />
          )}
        </Field>
      );
    default:
      return null; // a parameter type newer than this page: left as stored
  }
}

function AddMenu({ kind, onAdd }: { kind: Kind; onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="configure-add" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        + {ct(kind === "layers" ? "addLayer" : "addChart")}
      </button>
      {open && (
        <ul id={id} className="configure-types">
          {Object.keys(catalogue[kind]).map((type) => (
            <li key={type}>
              <button type="button" onClick={() => { onAdd(type); setOpen(false); }}>
                <strong>{typeName(kind, type)}</strong>{" "}
                <span>{ctOr(`typeHelp.${type}`, "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
