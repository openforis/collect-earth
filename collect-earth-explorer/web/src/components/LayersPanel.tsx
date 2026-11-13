import { useEffect, useState } from "react";
import { usePlot, type LayerId } from "../state/PlotContext";

const MIN_YEAR = 1984;
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

export default function LayersPanel() {
  const p = usePlot();
  const { compare, selectLandsatYear, setLandsatYear } = p;
  const maxYear = new Date(p.end).getUTCFullYear();
  // A year the slider has been dragged to but that is not committed yet;
  // null when the slider is at rest on the committed year.
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const draftYear = pendingYear ?? p.landsatYear;
  // Collapsed by default on narrow screens, open on wide ones (where the toggle
  // button is hidden by CSS). Crossing the breakpoint resets it to that default.
  const narrow = useNarrow();
  const [open, setOpen] = useState(!narrow);
  const [prevNarrow, setPrevNarrow] = useState(narrow);
  if (narrow !== prevNarrow) {
    setPrevNarrow(narrow);
    setOpen(!narrow);
  }

  // Debounce: the slider updates the label immediately; the context (and so the
  // tile request) only sees the value once it has been stable for COMMIT_DELAY_MS.
  // Normally the commit also makes Landsat the active layer. While comparing it
  // only sets the year: the right-hand Landsat layer follows it, and the left
  // layer stays as the user chose it.
  useEffect(() => {
    if (pendingYear === null) return;
    const t = setTimeout(() => {
      if (compare) setLandsatYear(pendingYear);
      else selectLandsatYear(pendingYear);
      setPendingYear(null);
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [pendingYear, compare, selectLandsatYear, setLandsatYear]);

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
        <Radio id="sentinel2" label="Sentinel-2, last 12 months" active={p.activeLayer} onSelect={p.setActiveLayer} />
        <Radio id="landsat" label={`Landsat ${draftYear}`} active={p.activeLayer} onSelect={p.setActiveLayer} />
        <input
          type="range"
          aria-label="Landsat year"
          min={MIN_YEAR}
          max={maxYear}
          value={draftYear}
          onChange={(e) => setPendingYear(Number(e.target.value))}
          style={{ width: "100%" }}
        />
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
            onChange={(e) => p.setCompareLayer(e.target.value as LayerId)}
          >
            <option value="sentinel2">Sentinel-2, last 12 months</option>
            {/* The committed year: the right-hand tiles only change when the slider commits. */}
            <option value="landsat">Landsat {p.landsatYear}</option>
            <option value="scene" disabled={!p.scene}>
              {p.scene ? `Scene: ${p.scene.label}` : "Scene (click a chart point)"}
            </option>
          </select>
        )}
      </div>
    </>
  );
}
