// Dates, numbers and file sizes in the person's language.

export function formatDate(ms: number | null, language: string): string {
  if (ms === null) return "";
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function formatDay(ms: number | null, language: string): string {
  if (ms === null) return "";
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export function formatNumber(n: number, language: string): string {
  try {
    return new Intl.NumberFormat(language).format(n);
  } catch {
    return String(n);
  }
}

export function formatBytes(bytes: number, language: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  try {
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
  } catch {
    return `${value.toFixed(digits)} ${units[unit]}`;
  }
}
