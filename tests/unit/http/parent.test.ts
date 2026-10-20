import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { isProcessAlive, parseParentPid, watchParent } from '../../../src/http/parent.js';

describe('parseParentPid (009-FR-011)', () => {
  it('reads --parent-pid <n> and --parent-pid=<n>', () => {
    expect(parseParentPid(['node', 'x', '--http', '--parent-pid', '123'])).toBe(123);
    expect(parseParentPid(['node', 'x', '--parent-pid=456'])).toBe(456);
  });
  it('is undefined when absent (a hand-run --http server has no parent to follow)', () => {
    expect(parseParentPid(['node', 'x', '--http'])).toBeUndefined();
  });
  it.each([['abc'], ['0'], ['-5'], ['1.5'], ['']])('rejects %j rather than watching a bogus pid', (v) => {
    expect(parseParentPid(['--parent-pid', v])).toBeUndefined();
  });
  it('rejects a missing value', () => {
    expect(parseParentPid(['--parent-pid'])).toBeUndefined();
  });
});

describe('isProcessAlive', () => {
  it('is true for this process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  it('is false once a process has exited', async () => {
    const child = spawn(process.execPath, ['-e', '0']);
    await new Promise((r) => child.on('exit', r));
    expect(isProcessAlive(child.pid!)).toBe(false);
  });
});

describe('watchParent (009-FR-011)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls onGone once the parent has died, and keeps quiet while it lives', () => {
    let alive = true;
    const onGone = vi.fn();
    watchParent(99, onGone, 1000, () => alive);
    vi.advanceTimersByTime(3500);
    expect(onGone).not.toHaveBeenCalled();
    alive = false;
    vi.advanceTimersByTime(1000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('fires only once even if the parent stays dead', () => {
    const onGone = vi.fn();
    watchParent(99, onGone, 1000, () => false);
    vi.advanceTimersByTime(10_000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled', () => {
    const onGone = vi.fn();
    const stop = watchParent(99, onGone, 1000, () => false);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('does not keep the process alive on its own', () => {
    const unref = vi.spyOn(globalThis, 'setInterval');
    watchParent(99, () => {}, 1000, () => true);
    const timer = unref.mock.results[0].value as { hasRef(): boolean };
    expect(timer.hasRef()).toBe(false);
  });
});
