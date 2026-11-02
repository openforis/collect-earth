const EPOCH_DAY = 719529; // Wiell library J_DAYS epoch (days since 0000-01-00)

/** Converts a Wiell "jDays" day number (CCDC tStart/tEnd/tBreak with dateFormat 0) to epoch milliseconds. */
function jDaysToMillis(t) { return Math.round((t - EPOCH_DAY) * 86400000); }

/**
 * Reshapes evaluated chartPoint features (values scaled x10000) into chart JSON.
 * Raw observations carry `raw`; fitted points carry `segments[i].value` for
 * exactly one segment index i. Dates arrive as ee.Date objects ({type, value})
 * or plain epoch-millisecond numbers.
 */
function shapeCcdc(fc, tBreaks) {
  const observed = [];
  const segments = [];
  for (const { properties: p } of fc.features) {
    const date = p.date && typeof p.date === "object" ? p.date.value : p.date;
    if (p.raw !== undefined && p.raw !== null) observed.push({ date, value: p.raw / 10000 });
    if (Array.isArray(p.segments)) {
      p.segments.forEach((s, i) => {
        if (s && s.value !== undefined && s.value !== null) {
          (segments[i] = segments[i] || []).push({ date, value: s.value / 10000 });
        }
      });
    }
  }
  observed.sort((a, b) => a.date - b.date);
  for (const s of segments) if (s) s.sort((a, b) => a.date - b.date);
  const breaks = (tBreaks || []).filter((t) => t > 0).map(jDaysToMillis);
  return { observed, segments: Array.from(segments, (s) => s || []), breaks };
}

module.exports = { shapeCcdc, jDaysToMillis };
