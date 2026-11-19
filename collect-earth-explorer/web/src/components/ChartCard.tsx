import type { ReactNode } from "react";
import type { ApiState } from "../hooks/useApi";
import { isRetryable } from "../lib/api";

interface Props<T> {
  title: string;
  /** The heading's tooltip: what the short title leaves out. */
  tooltip?: string;
  state: ApiState<T>;
  onDownload?: () => void;
  controls?: ReactNode;
  /** False: only the header (the card should hold its request meanwhile). */
  open?: boolean;
  /** Given, the header has a chevron button that folds and unfolds the card. */
  onToggle?: () => void;
  children: (data: T) => ReactNode;
}

const DOWNLOAD = "M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10";
const CHEVRON = "M4 6l4 4 4-4";
const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default function ChartCard<T>({ title, tooltip, state, onDownload, controls, open = true, onToggle, children }: Props<T>) {
  return (
    <section className="chart-card">
      <header className={open ? "chart-card-header" : "chart-card-header chart-card-collapsed"}>
        <h3 title={tooltip}>{title}</h3>
        <div className="chart-card-actions">
          {open && controls}
          {open && state.status === "done" && onDownload && (
            <button className="icon-button" aria-label="Download CSV" title="Download the data as CSV" onClick={onDownload}>
              {icon(DOWNLOAD)}
            </button>
          )}
          {onToggle && (
            <button className="icon-button chart-fold" aria-expanded={open} aria-label={open ? "Fold chart" : "Show chart"} title={open ? "Fold chart" : "Show chart"} onClick={onToggle}>
              {icon(CHEVRON)}
            </button>
          )}
        </div>
      </header>
      {open && (
        <>
          {state.status === "loading" && <div className="chart-placeholder"><span className="spinner" /> Computing…</div>}
          {state.status === "error" && (
            <div className="chart-placeholder chart-error">
              {state.error?.message}
              {isRetryable(state.error) && <button onClick={state.retry}>Retry</button>}
            </div>
          )}
          {state.status === "done" && state.data && children(state.data)}
        </>
      )}
    </section>
  );
}
