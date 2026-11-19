import { describe, it, expect, vi } from "vitest";

// Before any import: i18n.ts reads the browser's languages once, when it loads (each test file loads its own copy).
vi.hoisted(() => Object.defineProperty(navigator, "languages", { value: ["es-MX", "en"], configurable: true }));

import { render, screen, fireEvent } from "@testing-library/react";
import LayersPanel from "./LayersPanel";
import ChartCard from "./ChartCard";
import { PlotProvider } from "../state/PlotContext";
import { resolveConfig } from "../lib/config";
import { ApiFailure } from "../lib/api";
import { lang } from "../lib/i18n";

const params = {
  plot: { type: "Polygon" as const, coordinates: [[[30, -2], [31, -2], [31, -3], [30, -3], [30, -2]]] },
  start: "2000-01-01",
  end: "2025-06-15",
  plotId: "demo",
};

describe("in a Spanish browser", () => {
  it("picks Spanish", () => expect(lang).toBe("es"));

  it("the layers panel speaks Spanish", () => {
    render(
      <PlotProvider params={params} config={resolveConfig(undefined, 2026)}>
        <LayersPanel />
      </PlotProvider>,
    );
    expect(screen.getByText("Capas", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Sentinel-2, últimos 12 meses" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Escena (clic en un punto del gráfico)" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Año de Landsat" })).toBeTruthy();
    const bands = screen.getByRole("combobox", { name: "Bandas de Landsat" });
    expect([...bands.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Falso color", "Color real"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Comparar con" }));
    expect(screen.getByRole("combobox", { name: "Capa a comparar" })).toBeTruthy();
  });

  it("a chart card shows a translated error by its code", () => {
    const state = { status: "error" as const, error: new ApiFailure({ code: "ee_busy", message: "busy", retryable: true }, 503), retry: () => {} };
    render(<ChartCard title="X" state={state}>{() => null}</ChartCard>);
    expect(screen.getByText(/Earth Engine está ocupado/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("configuration notices are in Spanish", () => {
    expect(resolveConfig(JSON.stringify({ layers: [{ type: "x" }] }), 2026).notices).toEqual(['Capa "x" omitida: tipo desconocido.']);
  });
});
