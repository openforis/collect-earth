import { useEffect, useState } from "react";
import { LAST_12_MONTHS, usePlot, type LayerId, type Year } from "../state/PlotContext";
import { layerChoices, yearRange, type LayerEntry } from "../lib/config";

const COMMIT_DELAY_MS = 400;
/** Below this width (matches the CSS breakpoint) the panel starts collapsed behind a Layers button. */
const NARROW_QUERY = "(max-width: 900px)";

/** Whether the viewport is currently narrow; false where `matchMedia` is missing (jsdom). */
const isNarrow = () => window.matchMedia?.(NARROW_QUERY).matches ?? false;

/** Tracks the narrow-screen media query. */
function useNarrow() {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const onChange = (e: { matches: boolean }) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

interface RadioProps {
  id: LayerId;
  label: string;
  active: LayerId;
  disabled?: boolean;
  onSelect: (id: LayerId) => void;
}

/** One row of the layer radio group. Module-level so it keeps its identity across renders. */
function Radio({ id, label, active, disabled, onSelect }: RadioProps) {
  return (
    <label className="layer-row">
      <input type="radio" name="layer" checked={active === id} disabled={disabled} onChange={() => onSelect(id)} />
      {label}
    </label>
  );
}

/** An entry's name: its label, else its sensor. */
const nameOf = (entry: LayerEntry) => (entry.params.label as string | undefined) ?? (entry.type === "landsat" ? "Landsat" : "Sentinel-2");

/** An entry's row label: its name and year; an unlabelled Sentinel-2 one with a fixed window carries the window. */
function labelOf(entry: LayerEntry, year: Year | undefined) {
  const { label, start, end } = entry.params as { label?: string; start?: string; end?: string };
  if (typeof year === "number") return `${nameOf(entry)} ${year}`;
  return label ?? (start ? `Sentinel-2 ${start} to ${end}` : "Sentinel-2, last 12 months");
}

/** "false-colour" -> "False colour". */
const bandsText = (v: string) => v[0].toUpperCase() + v.slice(1).replace("-", " ");

/**
 * An imagery entry's radio row with its band selector, and its year slider; each entry owns its pending year.
 * A Sentinel-2 slider has one stop past its last year for the last 12 months; one with a fixed window has none.
 */
function LayerRow({ i, entry }: { i: number; entry: LayerEntry }) {
  const p = usePlot();
  const { compare, selectYear, setYear } = p;
  const [min, max] = yearRange(entry, p.end);
  const lastStop = entry.type === "sentinel2" ? max + 1 : max;
  // A year the slider has been dragged to but that is not committed yet;
  // null when the slider is at rest on the committed year.
  const [pendingYear, setPendingYear] = useState<Year | null>(null);
  const draftYear = pendingYear ?? p.yearOf(i);

  // Debounce: the slider updates the label immediately; the context (and so the
  // tile request) only sees the value once it has been stable for COMMIT_DELAY_MS.
  // Normally the commit also makes this entry the active layer. While comparing it
  // only sets the year: a right-hand layer showing this entry follows it, and the
  // left layer stays as the user chose it.
  useEffect(() => {
    if (pendingYear === null) return;
    const t = setTimeout(() => {
      if (compare) setYear(i, pendingYear);
      else selectYear(i, pendingYear);
      setPendingYear(null);
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [pendingYear, compare, i, selectYear, setYear]);

  return (
    <>
      <div className="layer-line">
        <Radio id={i} label={labelOf(entry, draftYear)} active={p.activeLayer} onSelect={p.setActiveLayer} />
        <select aria-label={`${nameOf(entry)} bands`} value={p.bandsOf(i)} onChange={(e) => p.setBands(i, e.target.value)}>
          {layerChoices(entry.type, "bands").map((v) => (
            <option key={v} value={v}>
              {bandsText(v)}
            </option>
          ))}
        </select>
      </div>
      {draftYear !== undefined && min < lastStop && (
        // A timeline, not a level: the first and last year at its ends and a tick per year (index.css).
        <div className="year-slider">
          <span>{min}</span>
          <input
            type="range"
            aria-label={`${nameOf(entry)} year`}
            min={min}
            max={lastStop}
            value={draftYear === LAST_12_MONTHS ? lastStop : draftYear}
            // The last stop's number is a year that does not exist for this slider: say what it is.
            aria-valuetext={draftYear === LAST_12_MONTHS ? "Last 12 months" : undefined}
            onChange={(e) => setPendingYear(Number(e.target.value) > max ? LAST_12_MONTHS : Number(e.target.value))}
            style={{ "--stops": lastStop - min } as React.CSSProperties}
          />
          <span>{lastStop > max ? "Last 12 mo" : max}</span>
        </div>
      )}
    </>
  );
}

export default function LayersPanel() {
  const p = usePlot();
  // Collapsed by default on narrow screens, open on wide ones (where the toggle
  // button is hidden by CSS). Crossing the breakpoint resets it to that default.
  const narrow = useNarrow();
  const [open, setOpen] = useState(!narrow);
  const [prevNarrow, setPrevNarrow] = useState(narrow);
  if (narrow !== prevNarrow) {
    setPrevNarrow(narrow);
    setOpen(!narrow);
  }

  const toggle = (
    <button className="layers-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      Layers
    </button>
  );
  if (!open) return toggle;

  return (
    <>
      {toggle}
      <div className="layers-panel">
        <strong>Layers</strong>
        {p.layers.map((entry, i) => (
          <LayerRow key={i} i={i} entry={entry} />
        ))}
        <Radio
          id="scene"
          label={p.scene ? `Scene: ${p.scene.label}` : "Scene (click a chart point)"}
          active={p.activeLayer}
          disabled={!p.scene}
          onSelect={p.setActiveLayer}
        />
        <label className="layer-row">
          <input type="checkbox" checked={p.compare} onChange={(e) => p.setCompare(e.target.checked)} />
          Compare with
        </label>
        {p.compare && (
          <select
            aria-label="Compare layer"
            value={p.compareLayer}
            onChange={(e) => p.setCompareLayer(e.target.value === "scene" ? "scene" : Number(e.target.value))}
          >
            {/* The committed year: the right-hand tiles only change when the slider commits. */}
            {p.layers.map((entry, i) => (
              <option key={i} value={i}>
                {labelOf(entry, p.yearOf(i))}
              </option>
            ))}
            <option value="scene" disabled={!p.scene}>
              {p.scene ? `Scene: ${p.scene.label}` : "Scene (click a chart point)"}
            </option>
          </select>
        )}
      </div>
    </>
  );
}
