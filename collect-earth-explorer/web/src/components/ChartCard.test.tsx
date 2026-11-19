import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartCard from "./ChartCard";
import type { ApiState } from "../hooks/useApi";
import { ApiFailure } from "../lib/api";

type Data = { points: number[] };

function state(partial: Partial<ApiState<Data>> & Pick<ApiState<Data>, "status">): ApiState<Data> {
  return { retry: vi.fn(), ...partial };
}

const children = (d: Data) => <div data-testid="body">{d.points.length} points</div>;

describe("ChartCard", () => {
  it("renders only the header when idle", () => {
    render(<ChartCard title="T" state={state({ status: "idle" })} onDownload={() => {}}>{children}</ChartCard>);
    expect(screen.getByRole("heading", { name: "T" })).toBeTruthy();
    expect(screen.queryByText(/Computing/)).toBeNull();
    expect(screen.queryByTestId("body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("shows a computing placeholder while loading", () => {
    render(<ChartCard title="T" state={state({ status: "loading" })} onDownload={() => {}}>{children}</ChartCard>);
    expect(screen.getByText(/Computing…/)).toBeTruthy();
    expect(screen.queryByTestId("body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("shows the error message and a Retry button that calls state.retry for a plain Error", () => {
    const s = state({ status: "error", error: new Error("boom") });
    render(<ChartCard title="T" state={s}>{children}</ChartCard>);
    expect(screen.getByText(/boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(s.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("body")).toBeNull();
  });

  it("shows Retry for a retryable ApiFailure", () => {
    const s = state({ status: "error", error: new ApiFailure({ code: "ee_busy", message: "busy", retryable: true }, 503) });
    render(<ChartCard title="T" state={s}>{children}</ChartCard>);
    expect(screen.getByText(/busy/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(s.retry).toHaveBeenCalledTimes(1);
  });

  it("shows the message without Retry for a non-retryable ApiFailure", () => {
    const s = state({ status: "error", error: new ApiFailure({ code: "bad_plot", message: "Plot too large", retryable: false }, 400) });
    render(<ChartCard title="T" state={s}>{children}</ChartCard>);
    expect(screen.getByText(/Plot too large/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("renders children and the CSV button when done", () => {
    const onDownload = vi.fn();
    render(<ChartCard title="T" state={state({ status: "done", data: { points: [1, 2, 3] } })} onDownload={onDownload}>{children}</ChartCard>);
    expect(screen.getByTestId("body").textContent).toBe("3 points");
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("omits the CSV button when done without onDownload, and renders controls", () => {
    render(
      <ChartCard title="T" state={state({ status: "done", data: { points: [] } })} controls={<span>ctl</span>}>
        {children}
      </ChartCard>,
    );
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
    expect(screen.getByText("ctl")).toBeTruthy();
  });

  it("the CSV button is a labelled icon button", () => {
    render(<ChartCard title="T" state={state({ status: "done", data: { points: [] } })} onDownload={() => {}}>{children}</ChartCard>);
    const button = screen.getByRole("button", { name: "Download CSV" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.getAttribute("title")).toBeTruthy();
  });

  it("puts the tooltip on the heading", () => {
    render(<ChartCard title="T" tooltip="More about T" state={state({ status: "idle" })}>{children}</ChartCard>);
    expect(screen.getByRole("heading", { name: "T" }).getAttribute("title")).toBe("More about T");
  });

  it("with onToggle has a fold button; folded it shows only the header with the title", () => {
    const onToggle = vi.fn();
    const done = state({ status: "done", data: { points: [1] } });
    const { rerender } = render(<ChartCard title="T" state={done} onDownload={() => {}} controls={<span>ctl</span>} onToggle={onToggle}>{children}</ChartCard>);
    const fold = screen.getByRole("button", { name: "Fold chart" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ChartCard title="T" state={done} onDownload={() => {}} controls={<span>ctl</span>} open={false} onToggle={onToggle}>{children}</ChartCard>);
    expect(screen.getByRole("heading", { name: "T" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show chart" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("body")).toBeNull();
    expect(screen.queryByText("ctl")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });
});
