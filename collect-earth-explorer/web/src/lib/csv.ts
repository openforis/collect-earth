export interface Point { date: number; value: number; [k: string]: unknown }

export function pointsToCsv(points: Point[], extraCols: string[] = []): string {
  const header = ["date", "value", ...extraCols].join(",");
  const rows = points.map((p) => [new Date(p.date).toISOString().slice(0, 10), p.value, ...extraCols.map((c) => p[c] ?? "")].join(","));
  return header + "\n" + rows.join("\n") + "\n";
}

export function downloadText(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
