import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../../../plugin/plugin.js';

// executeCommand reads the global PluginAPI SP injects at runtime; tests stub it directly.
declare global {
  // eslint-disable-next-line no-var
  var PluginAPI: {
    addTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
    getAppState?: ReturnType<typeof vi.fn>;
    startTracking?: ReturnType<typeof vi.fn>;
    stopTracking?: ReturnType<typeof vi.fn>;
  };
}

const tasks = [
  { id: 't1', title: 'One', isDone: false, projectId: 'p1', tagIds: [] },
  { id: 't2', title: 'Two', isDone: false, projectId: 'p1', tagIds: [] },
  { id: 'done', title: 'Done', isDone: true, projectId: 'p1', tagIds: [] },
];

describe('executeCommand: loadCurrentTask', () => {
  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn(),
      getTasks: vi.fn().mockResolvedValue(tasks),
    };
  });

  it('reads the running task from app state task.currentTaskId (SP 20)', async () => {
    globalThis.PluginAPI.getAppState = vi.fn().mockResolvedValue({ task: { currentTaskId: 't2' } });
    const res = await executeCommand({ action: 'loadCurrentTask' });
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ id: 't2', title: 'Two' });
  });

  it('returns null when app state has no current task', async () => {
    globalThis.PluginAPI.getAppState = vi.fn().mockResolvedValue({ task: { currentTaskId: null } });
    const res = await executeCommand({ action: 'loadCurrentTask' });
    expect(res.result).toBeNull();
  });

  it('falls back to the currentTimestamp scan when getAppState is unavailable', async () => {
    globalThis.PluginAPI.getTasks.mockResolvedValue([tasks[0], { ...tasks[1], currentTimestamp: 123 }]);
    const res = await executeCommand({ action: 'loadCurrentTask' });
    expect(res.result).toMatchObject({ id: 't2' });
  });

  it('falls back to the scan when getAppState throws', async () => {
    globalThis.PluginAPI.getAppState = vi.fn().mockRejectedValue(new Error('boom'));
    globalThis.PluginAPI.getTasks.mockResolvedValue([{ ...tasks[0], currentTimestamp: 1 }]);
    const res = await executeCommand({ action: 'loadCurrentTask' });
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ id: 't1' });
  });
});

describe('executeCommand: startTask / stopTask with native timer control', () => {
  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn().mockResolvedValue(tasks),
      startTracking: vi.fn().mockResolvedValue(undefined),
      stopTracking: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('startTask calls PluginAPI.startTracking and does not write currentTimestamp', async () => {
    const res = await executeCommand({ action: 'startTask', taskId: 't1' });
    expect(res.success).toBe(true);
    expect(globalThis.PluginAPI.startTracking).toHaveBeenCalledWith('t1');
    expect(globalThis.PluginAPI.updateTask).not.toHaveBeenCalled();
  });

  it('startTask still rejects unknown and completed tasks before calling startTracking', async () => {
    const missing = await executeCommand({ action: 'startTask', taskId: 'nope' });
    const done = await executeCommand({ action: 'startTask', taskId: 'done' });
    expect(missing).toMatchObject({ success: false, error: 'Task not found: nope' });
    expect(done.success).toBe(false);
    expect(done.error).toContain('completed task');
    expect(globalThis.PluginAPI.startTracking).not.toHaveBeenCalled();
  });

  it('stopTask calls PluginAPI.stopTracking', async () => {
    const res = await executeCommand({ action: 'stopTask' });
    expect(res.success).toBe(true);
    expect(globalThis.PluginAPI.stopTracking).toHaveBeenCalledOnce();
    expect(globalThis.PluginAPI.updateTask).not.toHaveBeenCalled();
  });
});

describe('executeCommand: startTask / stopTask fallback without native timer control', () => {
  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn().mockResolvedValue([{ ...tasks[0], currentTimestamp: 5 }, tasks[1]]),
    };
  });

  it('startTask clears the running task and sets currentTimestamp on the new one', async () => {
    await executeCommand({ action: 'startTask', taskId: 't2' });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('t1', { currentTimestamp: null });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('t2', { currentTimestamp: expect.any(Number) });
  });

  it('stopTask clears currentTimestamp on the tracked task', async () => {
    await executeCommand({ action: 'stopTask' });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('t1', { currentTimestamp: null });
  });
});
