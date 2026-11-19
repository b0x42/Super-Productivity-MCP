import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { init, stopPolling } from '../../../plugin/plugin.js';

// Regression for #148: a poll cycle longer than POLL_INTERVAL_MS must not start a second
// overlapping cycle (it re-ran pending commands and corrupted their response files).
describe('poll loop', () => {
  let listCalls: number;
  let releaseList: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    listCalls = 0;
    const gate = new Promise<void>(r => { releaseList = r; });
    (globalThis as any).PluginAPI = {
      executeNodeScript: vi.fn(async ({ script }: { script: string }) => {
        if (script.includes('readdirSync(dir)') && script.includes('since')) {
          listCalls++;
          await gate; // slow cycle
          return { success: true, result: { success: true, commands: [] } };
        }
        return { success: true, result: { success: true, commandDir: '/c', responseDir: '/r' } };
      }),
    };
  });

  afterEach(() => {
    stopPolling();
    vi.useRealTimers();
  });

  it('does not start a new cycle while one is in flight', async () => {
    await init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(listCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listCalls).toBe(1);

    releaseList();
    await vi.advanceTimersByTimeAsync(2000);
    expect(listCalls).toBe(2);
  });

  it('stopPolling cancels an in-flight cycle from re-arming', async () => {
    await init();
    await vi.advanceTimersByTimeAsync(2000);
    stopPolling();
    releaseList();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listCalls).toBe(1);
  });
});
