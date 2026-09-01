// Retention for the tool-call log. The log is append-only on the hot path; the
// cap is enforced by an occasional rewrite rather than on every call, so a chatty
// session doesn't pay to rewrite the whole file each time a tool runs.

/** Slack above the cap before a rewrite is worth doing. */
const PRUNE_SLACK = 1.2;

/**
 * Whether the file has drifted far enough over the cap to be worth rewriting.
 * The slack spans at least 100 appends, keeping the rewrite off the append path
 * for 99 calls out of 100 (SC-003).
 */
export function needsPrune(lineCount: number, max: number): boolean {
  return lineCount > Math.floor(max * PRUNE_SLACK);
}

/** Keep the newest `max` entries, dropping the oldest. Blank lines are discarded. */
export function prune(lines: string[], max: number): string[] {
  const entries = lines.filter(line => line.trim() !== '');
  return entries.length <= max ? entries : entries.slice(-max);
}
