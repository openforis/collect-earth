import { useEffect, useState } from "react";
import { usePlot, type LayerId } from "../state/PlotContext";

const MIN_YEAR = 1984;
const COMMIT_DELAY_MS = 400;

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
  const { selectLandsatYear } = p;
  const maxYear = new Date(p.end).getUTCFullYear();
  // A year the slider has been dragged to but that is not committed yet;
  // null when the slider is at rest on the committed year.
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const draftYear = pendingYear ?? p.landsatYear;

  // Debounce: the slider updates the label immediately; the context (year and
  // active layer together, and so the tile request) only sees the value once it
  // has been stable for COMMIT_DELAY_MS.
  useEffect(() => {
    if (pendingYear === null) return;
    const t = setTimeout(() => {
      selectLandsatYear(pendingYear);
      setPendingYear(null);
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [pendingYear, selectLandsatYear]);

  return (
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
    </div>
  );
}
