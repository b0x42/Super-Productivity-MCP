import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedDirs } from '../ipc/directories.js';
import { needsPrune, prune } from './ring.js';
import { truncatePayload } from './truncate.js';

export const LOG_FILENAME = 'tool-calls.jsonl';

/** Retention cap — the log holds at most this many entries (FR-008). */
const DEFAULT_MAX_ENTRIES = 500;
/** Per-payload size cap before the truncation marker takes over (FR-006). */
const DEFAULT_MAX_PAYLOAD_BYTES = 8192;

export interface ToolCallEntry {
  ts: number;
  tool: string;
  args: unknown;
  ms: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface Recorder {
  record(entry: ToolCallEntry): void;
}

export interface RecorderOptions {
  max?: number;
  maxPayloadBytes?: number;
}

function countExistingEntries(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, 'utf-8').split('\n').filter(line => line.trim() !== '').length;
  } catch {
    return 0;
  }
}

/**
 * Records tool calls to a JSONL log in the shared IPC directory, where the SP
 * plugin's pane can read it.
 *
 * Recording is best-effort by design: a logging failure must never surface to
 * the caller, because the user asked to update a task, not to write a log
 * (FR-004). Every path here swallows its errors deliberately.
 */
export function createRecorder(dirs: ResolvedDirs, opts: RecorderOptions = {}): Recorder {
  const max = opts.max ?? DEFAULT_MAX_ENTRIES;
  const maxPayloadBytes = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const path = join(dirs.base, LOG_FILENAME);

  // Seeded from disk so a cap survives across sessions — a stdio server is
  // spawned afresh for every client session, so an in-memory-only count would
  // let the log grow without bound.
  let entryCount = countExistingEntries(path);

  function rewritePruned(): void {
    const kept = prune(readFileSync(path, 'utf-8').split('\n'), max);
    // Write-and-rename so a crash mid-prune can't leave a half-written log.
    // Concurrent servers are last-writer-wins; what a race loses is log lines.
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 });
      renameSync(tmp, path);
      entryCount = kept.length;
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
      throw err;
    }
  }

  return {
    record(entry: ToolCallEntry): void {
      try {
        const line = JSON.stringify({
          ...entry,
          args: truncatePayload(entry.args, maxPayloadBytes),
          result: truncatePayload(entry.result, maxPayloadBytes),
        });
        appendFileSync(path, `${line}\n`, { mode: 0o600 });
        entryCount++;

        if (needsPrune(entryCount, max)) rewritePruned();
      } catch {
        // Deliberate: the tool call's result matters, this log doesn't.
      }
    },
  };
}
