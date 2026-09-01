import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../../../plugin/plugin.js';

// executeCommand reads the global PluginAPI SP injects at runtime; tests stub it directly.
declare global {
  // eslint-disable-next-line no-var
  var PluginAPI: {
    addTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
    deleteTask?: ReturnType<typeof vi.fn>;
    getArchivedTasks?: ReturnType<typeof vi.fn>;
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

// PluginAPI exposes getArchivedTasks() for reading but nothing that deletes from
// the archive, so deleting an archived task reported "Task not found" — misleading
// for a task that plainly exists and is visible through get_tasks.
describe('executeCommand: deleteTask on an archived task', () => {
  const active = [{ id: 'live-1', title: 'Active task' }];
  const archived = [{ id: 'arch-1', title: 'Archived task' }];

  beforeEach(() => {
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn(),
      getTasks: vi.fn(async () => active),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      getArchivedTasks: vi.fn(async () => archived),
    };
  });

  const del = (taskId: string) => executeCommand({ action: 'deleteTask', taskId });

  it('says the task is archived rather than missing', async () => {
    const res = await del('arch-1');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/archived/i);
  });

  it('points the user at where deletion is actually possible', async () => {
    const res = await del('arch-1');
    expect(res.error).toMatch(/Super Productivity/i);
  });

  it('does not attempt the delete it cannot perform', async () => {
    await del('arch-1');
    expect(globalThis.PluginAPI.deleteTask).not.toHaveBeenCalled();
  });

  it('still reports a genuinely unknown id as not found', async () => {
    const res = await del('no-such-task');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Task not found: no-such-task');
    expect(res.error).not.toMatch(/archived/i);
  });

  it('still deletes an active task', async () => {
    const res = await del('live-1');
    expect(res.success).toBe(true);
    expect(globalThis.PluginAPI.deleteTask).toHaveBeenCalledWith('live-1');
  });

  it('falls back to not-found when the archive cannot be read', async () => {
    globalThis.PluginAPI.getArchivedTasks = vi.fn(async () => { throw new Error('unsupported'); });
    const res = await del('arch-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Task not found: arch-1');
  });

  it('falls back to not-found on an SP build with no archive API', async () => {
    delete globalThis.PluginAPI.getArchivedTasks;
    const res = await del('arch-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Task not found: arch-1');
  });
});
