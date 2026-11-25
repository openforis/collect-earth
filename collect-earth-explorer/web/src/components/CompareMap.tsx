import { useEffect, useRef } from "react";
import { Map as MlMap } from "maplibre-gl";
import Compare from "@maplibre/maplibre-gl-compare";
import "@maplibre/maplibre-gl-compare/dist/maplibre-gl-compare.css";
import { BASE_STYLE, FIT, addPlotOutline, setImagery, useHomeKey } from "./MapView";
import { MAP_LOCALE } from "../lib/i18n";
import { polygonBounds, type Polygon } from "../lib/urlParams";

interface Props {
  plot: Polygon;
  /** The plot the R key returns to; `plot` when left out. */
  home?: Polygon;
  leftTileUrl?: string;
  rightTileUrl?: string;
}

/**
 * Two maps of the same plot, kept in sync and split by a draggable swipe handle:
 * `leftTileUrl` imagery on the left, `rightTileUrl` on the right.
 */
export default function CompareMap({ plot, home = plot, leftTileUrl, rightTileUrl }: Props) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const leftEl = useRef<HTMLDivElement | null>(null);
  const rightEl = useRef<HTMLDivElement | null>(null);
  // Set from each map's "load" handler, so a non-null map has its style loaded.
  const leftRef = useRef<MlMap | null>(null);
  const rightRef = useRef<MlMap | null>(null);
  // Latest URLs, read by the "load" handlers so URLs that arrive before the
  // style finishes loading are the ones first applied.
  const leftUrlRef = useRef(leftTileUrl);
  leftUrlRef.current = leftTileUrl;
  const rightUrlRef = useRef(rightTileUrl);
  rightUrlRef.current = rightTileUrl;

  // Both maps are created once per mount and `plot` is read once: it cannot change
  // while comparing (Redraw polygon is only offered on the single map).
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let disposed = false;
    const opts = {
      style: BASE_STYLE,
      bounds: polygonBounds(plot),
      fitBoundsOptions: FIT,
      locale: MAP_LOCALE,
    };
    const left = new MlMap({ container: leftEl.current!, ...opts });
    const right = new MlMap({ container: rightEl.current!, ...opts });
    // Under StrictMode the first pair is removed before its styles load; a
    // late "load" must not touch a removed map or steal the refs.
    left.on("load", () => {
      if (disposed) return;
      addPlotOutline(left, plot);
      leftRef.current = left;
      setImagery(left, leftUrlRef.current);
    });
    right.on("load", () => {
      if (disposed) return;
      addPlotOutline(right, plot);
      rightRef.current = right;
      setImagery(right, rightUrlRef.current);
    });
    const compare = new Compare(left, right, wrap.current!);
    return () => {
      disposed = true;
      leftRef.current = null;
      rightRef.current = null;
      // The compare control unhooks from both maps, so it goes before them.
      compare.remove();
      left.remove();
      right.remove();
    };
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // The right map follows the left (the compare control keeps them in sync).
  useHomeKey(leftRef, home);

  // See MapView: do not gate on isStyleLoaded(), which is false while tiles load.
  useEffect(() => {
    if (leftRef.current) setImagery(leftRef.current, leftTileUrl);
  }, [leftTileUrl]);
  useEffect(() => {
    if (rightRef.current) setImagery(rightRef.current, rightTileUrl);
  }, [rightTileUrl]);

  return (
    <div ref={wrap} style={{ position: "absolute", inset: 0 }}>
      <div ref={leftEl} style={{ position: "absolute", inset: 0 }} />
      <div ref={rightEl} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
