import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecorder, LOG_FILENAME } from '../../../src/recording/recorder.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';

let base: string;
let dirs: ResolvedDirs;
const logPath = () => join(base, LOG_FILENAME);
const lines = () =>
  readFileSync(logPath(), 'utf-8').split('\n').filter(l => l.trim() !== '');
const entries = () => lines().map(l => JSON.parse(l));

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sp-mcp-rec-'));
  dirs = { base, commands: join(base, 'pc'), responses: join(base, 'pr') };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const entry = (over: Record<string, unknown> = {}) => ({
  ts: 1_756_742_531_000, tool: 'get_tasks', args: {}, ms: 82, ok: true, result: { n: 1 }, ...over,
});

describe('createRecorder', () => {
  it('appends one JSON line per call', () => {
    const rec = createRecorder(dirs);
    rec.record(entry());
    rec.record(entry({ tool: 'log_time' }));
    expect(entries().map(e => e.tool)).toEqual(['get_tasks', 'log_time']);
  });

  it('preserves every field of the entry', () => {
    createRecorder(dirs).record(entry({ ms: 1904, ok: false, error: 'Task not found: abc' }));
    expect(entries()[0]).toMatchObject({
      ts: 1_756_742_531_000, tool: 'get_tasks', ms: 1904, ok: false, error: 'Task not found: abc',
    });
  });

  it('creates the log 0600 so captured task content is not world-readable', () => {
    createRecorder(dirs).record(entry());
    expect(statSync(logPath()).mode & 0o777).toBe(0o600);
  });

  it('truncates an oversized result rather than mirroring the task database', () => {
    createRecorder(dirs).record(entry({ result: { tasks: 'x'.repeat(20_000) } }));
    expect(entries()[0].result._truncated).toBe(true);
  });

  it('truncates oversized args too', () => {
    createRecorder(dirs).record(entry({ args: { notes: 'y'.repeat(20_000) } }));
    expect(entries()[0].args._truncated).toBe(true);
  });

  it('enforces the cap, keeping the newest entries', () => {
    const rec = createRecorder(dirs, { max: 5 });
    for (let i = 0; i < 12; i++) rec.record(entry({ tool: `tool-${i}` }));
    const tools = entries().map(e => e.tool);
    expect(tools.length).toBeLessThanOrEqual(6);
    expect(tools).toContain('tool-11');
    expect(tools).not.toContain('tool-0');
  });

  it('counts entries already on disk from a previous session', () => {
    createRecorder(dirs, { max: 5 }).record(entry({ tool: 'from-session-1' }));
    const rec2 = createRecorder(dirs, { max: 5 });
    for (let i = 0; i < 12; i++) rec2.record(entry({ tool: `tool-${i}` }));
    expect(entries().length).toBeLessThanOrEqual(6);
  });

  it('never throws when the log cannot be written (FR-004)', () => {
    const unwritable = { base: '/proc/nope/deep', commands: '/proc/nope/c', responses: '/proc/nope/r' };
    const rec = createRecorder(unwritable);
    expect(() => rec.record(entry())).not.toThrow();
  });

  it('does not create a log file merely by existing', () => {
    createRecorder(dirs);
    expect(existsSync(logPath())).toBe(false);
  });
});
