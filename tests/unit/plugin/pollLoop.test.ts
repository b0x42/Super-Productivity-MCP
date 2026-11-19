import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Regression tests for #148: a poll cycle longer than POLL_INTERVAL_MS must not start a
// second overlapping cycle (it re-ran pending commands and corrupted their response files).

type Plugin = typeof import('../../../plugin/plugin.js');

interface Harness {
  plugin: Plugin;
  listCalls: () => number;
  writeOps: string[];
  sweepScripts: string[];
  pending: { id: string; action: string; protocolVersion: number }[];
  failOp: { current: string | null };
  failDelete: { current: boolean };
  gate: { current: Promise<void> | null };
}

// The plugin keeps poll state in module scope, so each test loads a fresh copy.
async function load(): Promise<Harness> {
  vi.resetModules();
  let lists = 0;
  const h: Harness = {
    plugin: undefined as unknown as Plugin,
    listCalls: () => lists,
    writeOps: [],
    sweepScripts: [],
    pending: [],
    failOp: { current: null },
    failDelete: { current: false },
    gate: { current: null },
  };
  (globalThis as any).PluginAPI = {
    // Defined so the module's own startup hook does not schedule an init() of its own.
    onReady: vi.fn(),
    getTasks: vi.fn(),
    executeNodeScript: vi.fn(async ({ script, args }: { script: string; args: unknown[] }) => {
      if (script.includes('const since')) {
        lists++;
        if (h.gate.current) await h.gate.current;
        const commands = h.pending.map(data => ({ file: `${data.id}.json`, path: `/c/${data.id}.json`, data, mtime: 1 }));
        return { success: true, result: { success: true, commands } };
      }
      if (script.includes('300000')) {
        h.sweepScripts.push(script);
        return { success: true, result: { success: true } };
      }
      if (script.includes('const op = args[2]')) {
        const op = args[2] as string;
        h.writeOps.push(op);
        return h.failOp.current === op ? { success: false, error: 'boom' } : { success: true, result: { success: true } };
      }
      if (script.includes('unlinkSync(args[0])')) {
        return h.failDelete.current ? { success: false, error: 'EACCES' } : { success: true, result: { success: true } };
      }
      return { success: true, result: { success: true, commandDir: '/c', responseDir: '/r' } };
    }),
  };
  h.plugin = (await import('../../../plugin/plugin.js')) as Plugin;
  return h;
}

describe('poll loop', () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    h = await load();
  });

  afterEach(() => {
    h.plugin.stopPolling();
    vi.useRealTimers();
  });

  it('does not start a new cycle while one is in flight', async () => {
    let release!: () => void;
    h.gate.current = new Promise<void>(r => { release = r; });
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.listCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.listCalls()).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.listCalls()).toBe(2);
  });

  it('stopPolling stops an in-flight cycle from re-arming', async () => {
    let release!: () => void;
    h.gate.current = new Promise<void>(r => { release = r; });
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(2000);
    h.plugin.stopPolling();
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.listCalls()).toBe(1);
  });

  it('re-init does not overlap a cycle left over from before', async () => {
    let release!: () => void;
    h.gate.current = new Promise<void>(r => { release = r; });
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.listCalls()).toBe(1);

    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.listCalls()).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.listCalls()).toBeGreaterThan(1);
  });

  it('overlapping init() calls start a single loop', async () => {
    await Promise.all([h.plugin.init(), h.plugin.init()]);
    await vi.advanceTimersByTimeAsync(6000);
    // one loop: ticks at 2s, 4s, 6s
    expect(h.listCalls()).toBe(3);
    h.plugin.stopPolling();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.listCalls()).toBe(3);
  });

  it('times out a hung command, answers with an error and keeps polling', async () => {
    (globalThis as any).PluginAPI.getTasks = vi.fn(() => new Promise(() => {}));
    h.pending.push({ id: 'c1', action: 'getTasks', protocolVersion: 1 });
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.writeOps).toEqual([]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.writeOps).toEqual(['start', 'append', 'finish']);
    const before = h.listCalls();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.listCalls()).toBeGreaterThan(before);
  });

  it('does not re-run a command whose file could not be deleted', async () => {
    (globalThis as any).PluginAPI.getTasks = vi.fn().mockResolvedValue([]);
    h.pending.push({ id: 'c1', action: 'getTasks', protocolVersion: 1 });
    h.failDelete.current = true;
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.listCalls()).toBeGreaterThan(2);
    expect((globalThis as any).PluginAPI.getTasks).toHaveBeenCalledTimes(1);
  });
});

describe('writeResponse failure', () => {
  afterEach(() => vi.useRealTimers());

  it('removes the partial .tmp file', async () => {
    vi.useFakeTimers();
    const h = await load();
    (globalThis as any).PluginAPI.getTasks = vi.fn().mockResolvedValue([]);
    h.pending.push({ id: 'c1', action: 'getTasks', protocolVersion: 1 });
    h.failOp.current = 'append';
    await h.plugin.init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.writeOps).toContain('abort');
    h.plugin.stopPolling();
  });
});

describe('startup sweep', () => {
  afterEach(() => vi.useRealTimers());

  it('removes stale .json and .json.tmp files but keeps fresh ones', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = await load();
    await h.plugin.init();
    h.plugin.stopPolling();
    expect(h.sweepScripts).toHaveLength(1);

    const dir = mkdtempSync(join(tmpdir(), 'sp-sweep-'));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    for (const name of ['a_response.json', 'b_response.json.tmp']) {
      writeFileSync(join(dir, name), '{}');
      utimesSync(join(dir, name), old, old);
    }
    writeFileSync(join(dir, 'fresh_response.json.tmp'), '{}');

    const run = new Function('require', 'args', h.sweepScripts[0]);
    run(require, [dir, dir]);

    expect(existsSync(join(dir, 'a_response.json'))).toBe(false);
    expect(existsSync(join(dir, 'b_response.json.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'fresh_response.json.tmp'))).toBe(true);
  });
});
