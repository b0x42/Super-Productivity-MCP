import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../../../plugin/plugin.js';

// executeCommand reads the global PluginAPI SP injects at runtime; tests stub it directly.
declare global {
  // eslint-disable-next-line no-var
  var PluginAPI: {
    addTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
  };
}

describe('executeCommand: addTask deadlineDay follow-up', () => {
  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn().mockResolvedValue('task-1'),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn(),
    };
  });

  it('persists deadlineDay via a follow-up updateTask call (addTask itself drops it)', async () => {
    const res = await executeCommand({
      action: 'addTask',
      data: { title: 'Test task', deadlineDay: '2026-12-01' },
    });
    expect(res.success).toBe(true);
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('task-1', { deadlineDay: '2026-12-01' });
  });

  it('clears deadlineDay via follow-up call when explicitly null', async () => {
    await executeCommand({ action: 'addTask', data: { title: 'Test task', deadlineDay: null } });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('task-1', { deadlineDay: null });
  });

  it('does not touch deadlineDay when the key is absent from data', async () => {
    await executeCommand({ action: 'addTask', data: { title: 'Test task' } });
    const deadlineCalls = globalThis.PluginAPI.updateTask.mock.calls.filter(
      ([, patch]) => patch && 'deadlineDay' in patch,
    );
    expect(deadlineCalls).toHaveLength(0);
  });
});

describe('executeCommand: bulkUpdateTasks partial-success with invalid task_id', () => {
  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
    };
  });

  it('reports "Task not found" for an invalid task_id without calling updateTask, and still applies the valid one', async () => {
    const res = await executeCommand({
      action: 'bulkUpdateTasks',
      updates: [
        { taskId: 't1', data: { deadlineDay: '2026-12-01' } },
        { taskId: 'bad', data: { deadlineDay: '2026-12-01' } },
      ],
    });
    expect(res.success).toBe(true);
    expect(res.result.results).toEqual([
      { id: 't1', success: true },
      { id: 'bad', success: false, error: 'Task not found: bad' },
    ]);
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledTimes(1);
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledWith('t1', { deadlineDay: '2026-12-01' });
  });

  it('still reports success:false when updateTask throws for a valid task_id (pre-existing catch path)', async () => {
    globalThis.PluginAPI.updateTask.mockRejectedValueOnce(new Error('boom'));
    const res = await executeCommand({
      action: 'bulkUpdateTasks',
      updates: [{ taskId: 't1', data: { deadlineDay: '2026-12-01' } }],
    });
    expect(res.result.results).toEqual([{ id: 't1', success: false, error: 'boom' }]);
  });
});
