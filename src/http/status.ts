import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedDirs } from '../ipc/directories.js';

/** Written by `--http` mode, read by the SP plugin so it can tell the user what happened. */
export const HTTP_STATUS_FILENAME = 'http_status.json';

export type HttpState =
  | 'listening'
  /** Bind failed but attempts remain; not yet worth telling the user. */
  | 'retrying'
  /** Bind failed on the last attempt; the server has stopped trying. */
  | 'bind-failed'
  | 'invalid-config'
  | 'off'
  | 'stopped';

export interface HttpStatus {
  state: HttpState;
  host?: string;
  port?: number;
  /** Human-readable cause for `bind-failed` / `invalid-config`. Never contains the token. */
  error?: string;
  /** Bind attempt number and the cap, while `retrying` / after `bind-failed`. */
  attempt?: number;
  maxAttempts?: number;
  /** True when the SP plugin launched this process and owns its lifecycle. */
  managed?: boolean;
  /** The process this server exits along with (the SP app), when managed. */
  parentPid?: number;
}

/**
 * Publish the listener's state next to the config (009-FR-010). This is how a failure the
 * plugin cannot see for itself (EADDRINUSE, a hand-edited bad file) reaches the
 * user as a toast. Best-effort: it is telemetry, so a failure to write it must
 * never disturb the server it describes.
 */
export function writeHttpStatus(dirs: ResolvedDirs, status: HttpStatus): void {
  const target = join(dirs.base, HTTP_STATUS_FILENAME);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ ...status, pid: process.pid, updatedAt: Date.now() }), { mode: 0o600 });
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}
