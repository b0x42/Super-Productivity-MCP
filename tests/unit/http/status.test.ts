import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HTTP_STATUS_FILENAME, writeHttpStatus } from '../../../src/http/status.js';

describe('writeHttpStatus (009-FR-010)', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sp-mcp-status-')); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); });
  const dirs = () => ({ base, commands: join(base, 'c'), responses: join(base, 'r') });
  const read = () => JSON.parse(readFileSync(join(base, HTTP_STATUS_FILENAME), 'utf-8'));

  it('writes state, bind and error with the writer pid and a timestamp', () => {
    writeHttpStatus(dirs(), { state: 'bind-failed', host: '127.0.0.1', port: 8765, error: 'EADDRINUSE: port in use' });
    expect(read()).toMatchObject({ state: 'bind-failed', host: '127.0.0.1', port: 8765, error: 'EADDRINUSE: port in use', pid: process.pid });
    expect(typeof read().updatedAt).toBe('number');
  });

  it('is owner-only and leaves no temp file behind', () => {
    writeHttpStatus(dirs(), { state: 'off' });
    expect(statSync(join(base, HTTP_STATUS_FILENAME)).mode & 0o777).toBe(0o600);
    expect(readdirSync(base).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces the previous status', () => {
    writeHttpStatus(dirs(), { state: 'bind-failed', host: 'h', port: 1, error: 'x' });
    writeHttpStatus(dirs(), { state: 'listening', host: 'h', port: 1 });
    expect(read().state).toBe('listening');
    expect(read().error).toBeUndefined();
  });

  it('never throws, even when the directory is gone (status is best-effort telemetry)', () => {
    rmSync(base, { recursive: true, force: true });
    expect(() => writeHttpStatus(dirs(), { state: 'off' })).not.toThrow();
    writeFileSync(join(tmpdir(), '.keep-status-test'), '');
  });
});
