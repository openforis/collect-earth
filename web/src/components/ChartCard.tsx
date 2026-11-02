import type { ReactNode } from "react";
import type { ApiState } from "../hooks/useApi";

interface Props<T> { title: string; state: ApiState<T>; onDownload?: () => void; controls?: ReactNode; children: (data: T) => ReactNode }

export default function ChartCard<T>({ title, state, onDownload, controls, children }: Props<T>) {
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
          <button onClick={state.retry}>Retry</button>
        </div>
      )}
      {state.status === "done" && state.data && children(state.data)}
    </section>
  );
}
