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
  const { setLandsatYear } = p;
  const maxYear = new Date(p.end).getUTCFullYear();
  const [draftYear, setDraftYear] = useState(p.landsatYear);

  // Debounce: the slider updates draftYear immediately; the context (and so the tile
  // request) only sees the value once it has been stable for COMMIT_DELAY_MS.
  useEffect(() => {
    const t = setTimeout(() => setLandsatYear(draftYear), COMMIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [draftYear, setLandsatYear]);

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
        onChange={(e) => {
          setDraftYear(Number(e.target.value));
          p.setActiveLayer("landsat");
        }}
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
