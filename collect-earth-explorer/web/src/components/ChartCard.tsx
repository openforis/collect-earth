import type { ReactNode } from "react";
import type { ApiState } from "../hooks/useApi";
import { isRetryable } from "../lib/api";

interface Props<T> {
  title: string;
  state: ApiState<T>;
  onDownload?: () => void;
  controls?: ReactNode;
  /** Only the header with a Show button (which calls `onExpand`); the card should hold its request meanwhile. */
  collapsed?: boolean;
  onExpand?: () => void;
  children: (data: T) => ReactNode;
}

export default function ChartCard<T>({ title, state, onDownload, controls, collapsed, onExpand, children }: Props<T>) {
  if (collapsed)
    return (
      <section className="chart-card">
        <header className="chart-card-header chart-card-collapsed">
          <h3>{title}</h3>
          <div className="chart-card-actions"><button onClick={onExpand}>Show</button></div>
        </header>
      </section>
    );
  return (
    <section className="chart-card">
      <header className="chart-card-header">
        <h3>{title}</h3>
        <div className="chart-card-actions">{controls}{state.status === "done" && onDownload && <button onClick={onDownload}>CSV</button>}</div>
      </header>
      {state.status === "loading" && <div className="chart-placeholder"><span className="spinner" /> Computing…</div>}
      {state.status === "error" && (
        <div className="chart-placeholder chart-error">
          {state.error?.message}
          {isRetryable(state.error) && <button onClick={state.retry}>Retry</button>}
        </div>
      )}
      {state.status === "done" && state.data && children(state.data)}
    </section>
  );
}
