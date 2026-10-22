import { useSyncExternalStore } from "react";

/**
 * Smaller text and spacing in small windows: the plots map narrowed next to Google Earth Web, a laptop screen, the
 * form inside it. MUI sizes text in rem and spacing from --mui-spacing (both themes use CSS variables), so changing
 * the root font size and that variable scales every component at once. Two steps, by width or height:
 */
const STEPS = [
  { query: "(max-width: 900px), (max-height: 820px)", scale: 15 / 16 },
  { query: "(max-width: 520px), (max-height: 680px)", scale: 14 / 16 },
];

/** Global styles for the root (":root:root" beats the one MUI writes the default spacing in). */
export const uiScaleStyles = Object.fromEntries(STEPS.map(({ query, scale }) => [
  `@media ${query}`,
  { ":root:root": { fontSize: `${16 * scale}px`, "--mui-spacing": `${8 * scale}px` } },
]));

const media = typeof window !== "undefined" && window.matchMedia ? STEPS.map(({ query }) => window.matchMedia(query)) : [];

function subscribe(onChange: () => void) {
  media.forEach((m) => m.addEventListener("change", onChange));
  return () => media.forEach((m) => m.removeEventListener("change", onChange));
}

function currentScale(): number {
  let scale = 1;
  media.forEach((m, i) => { if (m.matches) scale = STEPS[i].scale; });
  return scale;
}

/** The scale of the root in this window (1 = full size), for sizes set in px (list rows, panel widths). */
export function useUiScale(): number {
  return useSyncExternalStore(subscribe, currentScale, () => 1);
}
