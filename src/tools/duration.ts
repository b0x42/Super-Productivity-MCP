// Duration short syntax ("1h30m", "45m", "90s") — the same shape SP accepts in a
// task title. Kept pure and separately tested, like habit-streak.ts: the log_time
// tool turns a parse failure into an errorResult rather than a silent zero, so a
// typo can never be mistaken for "logged nothing".

const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000 };

// Only whole `<digits><h|m|s>` tokens, and the pattern must consume the entire
// string — that rejects "90" (no unit), "1h30" (trailing unitless number),
// "1.5h", "-1h" and "1d" instead of silently parsing the part it recognizes.
const DURATION_RE = /^(?:\d+\s*[hms]\s*)+$/i;
const TOKEN_RE = /(\d+)\s*([hms])/gi;

/** Parse a duration string to milliseconds. Returns null if the string isn't a valid duration. */
export function parseDuration(input: string): number | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!DURATION_RE.test(trimmed)) return null;

  let ms = 0;
  for (const [, amount, unit] of trimmed.matchAll(TOKEN_RE)) {
    ms += parseInt(amount, 10) * UNIT_MS[unit.toLowerCase()];
  }
  return ms;
}
