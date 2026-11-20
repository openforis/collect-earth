import { describe, expect, it, vi } from "vitest";

// Before any import: i18n.ts reads the browser's languages once, when it loads.
vi.hoisted(() => Object.defineProperty(navigator, "languages", { value: ["es-ES"], configurable: true }));

import examples from "../../../functions/test/tileLabels.json";
import { tileLabel } from "./api";
import { lang } from "./i18n";

describe("tileLabel and the server's labels (functions/lib/labels.js)", () => {
  it("recognises every example label: in Spanish none is shown as it came", () => {
    expect(lang).toBe("es");
    for (const { label } of examples) expect(tileLabel(label), label).not.toBe(label);
    expect(tileLabel("Landsat 8/Landsat 9 2023 composite")).toBe("Composición Landsat 8/Landsat 9 2023");
  });
});
