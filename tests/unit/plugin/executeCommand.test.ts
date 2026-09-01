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

// logTime writes the per-day map itself: PluginAPI has no addTimeSpent, only the
// generic updateTask, so the plugin owns recomputing timeSpent and rolling the
// delta up to the parent — the two things SP's own addTimeSpent action does.
describe('executeCommand: logTime', () => {
  const HOUR = 3_600_000;
  let tasks: Record<string, unknown>[];

  beforeEach(() => {
    tasks = [];
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn(async () => tasks),
    };
  });

  const logTime = (taskId: string, data: Record<string, unknown>) =>
    executeCommand({ action: 'logTime', taskId, data });

  const patchFor = (taskId: string) =>
    globalThis.PluginAPI.updateTask.mock.calls.find(([id]) => id === taskId)?.[1];

  it("adds to an existing day's tracked time", async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-31': HOUR } }];
    const res = await logTime('t1', { date: '2026-08-31', durationMs: HOUR / 2, mode: 'add' });
    expect(res.success).toBe(true);
    expect(patchFor('t1')).toEqual({
      timeSpentOnDay: { '2026-08-31': HOUR * 1.5 },
      timeSpent: HOUR * 1.5,
    });
  });

  it('creates the day entry when none exists yet', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-30': HOUR } }];
    await logTime('t1', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    expect(patchFor('t1')).toEqual({
      timeSpentOnDay: { '2026-08-30': HOUR, '2026-08-31': HOUR },
      timeSpent: HOUR * 2,
    });
  });

  it('handles a task that has never been tracked', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0 }];
    await logTime('t1', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    expect(patchFor('t1')).toEqual({ timeSpentOnDay: { '2026-08-31': HOUR }, timeSpent: HOUR });
  });

  it("overwrites the day's value in set mode", async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR * 3, timeSpentOnDay: { '2026-08-30': HOUR * 2, '2026-08-31': HOUR } }];
    await logTime('t1', { date: '2026-08-31', durationMs: HOUR / 2, mode: 'set' });
    expect(patchFor('t1')).toEqual({
      timeSpentOnDay: { '2026-08-30': HOUR * 2, '2026-08-31': HOUR / 2 },
      timeSpent: HOUR * 2.5,
    });
  });

  it('removes the day entry when set to zero', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR * 3, timeSpentOnDay: { '2026-08-30': HOUR * 2, '2026-08-31': HOUR } }];
    await logTime('t1', { date: '2026-08-31', durationMs: 0, mode: 'set' });
    expect(patchFor('t1')).toEqual({
      timeSpentOnDay: { '2026-08-30': HOUR * 2 },
      timeSpent: HOUR * 2,
    });
  });

  it('rolls the added time up to the parent task', async () => {
    tasks = [
      { id: 'sub', parentId: 'parent', timeSpent: 0, timeSpentOnDay: {} },
      { id: 'parent', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-31': HOUR } },
    ];
    await logTime('sub', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    expect(patchFor('parent')).toEqual({
      timeSpentOnDay: { '2026-08-31': HOUR * 2 },
      timeSpent: HOUR * 2,
    });
  });

  it('rolls a set-mode reduction down on the parent', async () => {
    tasks = [
      { id: 'sub', parentId: 'parent', timeSpent: HOUR * 2, timeSpentOnDay: { '2026-08-31': HOUR * 2 } },
      { id: 'parent', parentId: null, timeSpent: HOUR * 3, timeSpentOnDay: { '2026-08-31': HOUR * 3 } },
    ];
    await logTime('sub', { date: '2026-08-31', durationMs: HOUR, mode: 'set' });
    expect(patchFor('parent')).toEqual({
      timeSpentOnDay: { '2026-08-31': HOUR * 2 },
      timeSpent: HOUR * 2,
    });
  });

  it('never drives the parent below zero', async () => {
    tasks = [
      { id: 'sub', parentId: 'parent', timeSpent: HOUR * 2, timeSpentOnDay: { '2026-08-31': HOUR * 2 } },
      { id: 'parent', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-31': HOUR } },
    ];
    await logTime('sub', { date: '2026-08-31', durationMs: 0, mode: 'set' });
    expect(patchFor('parent')).toEqual({ timeSpentOnDay: {}, timeSpent: 0 });
  });

  it('leaves the parent alone for a top-level task', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    await logTime('t1', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledTimes(1);
  });

  it('errors on an unknown task instead of silently no-opping', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    const res = await logTime('nope', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('nope');
    expect(globalThis.PluginAPI.updateTask).not.toHaveBeenCalled();
  });

  it('returns the updated map and total', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    const res = await logTime('t1', { date: '2026-08-31', durationMs: HOUR, mode: 'add' });
    // The result reports every day it touched; the single-day form is a one-item list.
    expect(res.result).toEqual({
      taskId: 't1',
      dates: ['2026-08-31'],
      timeSpentOnDay: { '2026-08-31': HOUR },
      timeSpent: HOUR,
    });
  });
});

// 007: multi-day logging. The caller sends durations per day, never a whole map,
// so there is no agent-length window in which SP's timer can be clobbered.
describe('executeCommand: logTimeEntries', () => {
  const HOUR = 3_600_000;
  let tasks: Record<string, unknown>[];

  beforeEach(() => {
    tasks = [];
    globalThis.PluginAPI = {
      addTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(undefined),
      getTasks: vi.fn(async () => tasks),
    };
  });

  const logEntries = (taskId: string, entries: unknown[], mode = 'add') =>
    executeCommand({ action: 'logTimeEntries', taskId, data: { entries, mode } });

  const patchFor = (taskId: string) =>
    globalThis.PluginAPI.updateTask.mock.calls.find(([id]) => id === taskId)?.[1];

  it('applies every day in one call', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    await logEntries('t1', [
      { date: '2026-08-30', durationMs: HOUR * 2 },
      { date: '2026-08-31', durationMs: HOUR },
    ]);
    expect(patchFor('t1')).toEqual({
      timeSpentOnDay: { '2026-08-30': HOUR * 2, '2026-08-31': HOUR },
      timeSpent: HOUR * 3,
    });
  });

  it('writes the task once, not once per day', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    await logEntries('t1', [
      { date: '2026-08-29', durationMs: HOUR },
      { date: '2026-08-30', durationMs: HOUR },
      { date: '2026-08-31', durationMs: HOUR },
    ]);
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledTimes(1);
  });

  it('adds onto days that already have time', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-30': HOUR } }];
    await logEntries('t1', [{ date: '2026-08-30', durationMs: HOUR }]);
    expect(patchFor('t1')).toEqual({ timeSpentOnDay: { '2026-08-30': HOUR * 2 }, timeSpent: HOUR * 2 });
  });

  it('overwrites each day in set mode', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR * 3, timeSpentOnDay: { '2026-08-30': HOUR * 3 } }];
    await logEntries('t1', [{ date: '2026-08-30', durationMs: HOUR }], 'set');
    expect(patchFor('t1')).toEqual({ timeSpentOnDay: { '2026-08-30': HOUR }, timeSpent: HOUR });
  });

  it('rolls every affected day up to the parent in a single update', async () => {
    tasks = [
      { id: 'sub', parentId: 'parent', timeSpent: 0, timeSpentOnDay: {} },
      { id: 'parent', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-30': HOUR } },
    ];
    await logEntries('sub', [
      { date: '2026-08-30', durationMs: HOUR },
      { date: '2026-08-31', durationMs: HOUR * 2 },
    ]);
    expect(patchFor('parent')).toEqual({
      timeSpentOnDay: { '2026-08-30': HOUR * 2, '2026-08-31': HOUR * 2 },
      timeSpent: HOUR * 4,
    });
    expect(globalThis.PluginAPI.updateTask).toHaveBeenCalledTimes(2); // task + parent
  });

  it('reports the previous total when it disagreed with the worklog', async () => {
    // A task imported from elsewhere: a total with no day attribution. SP would
    // discard it at the next write, so the correction is surfaced, not hidden.
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR * 128, timeSpentOnDay: {} }];
    const res = await logEntries('t1', [{ date: '2026-08-31', durationMs: HOUR }]);
    expect((res.result as { previousTimeSpent?: number }).previousTimeSpent).toBe(HOUR * 128);
    expect((res.result as { timeSpent: number }).timeSpent).toBe(HOUR);
  });

  it('omits previousTimeSpent when the total already matched the worklog', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: HOUR, timeSpentOnDay: { '2026-08-30': HOUR } }];
    const res = await logEntries('t1', [{ date: '2026-08-31', durationMs: HOUR }]);
    expect(res.result).not.toHaveProperty('previousTimeSpent');
  });

  it('returns every date it touched', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    const res = await logEntries('t1', [
      { date: '2026-08-30', durationMs: HOUR },
      { date: '2026-08-31', durationMs: HOUR },
    ]);
    expect((res.result as { dates: string[] }).dates).toEqual(['2026-08-30', '2026-08-31']);
  });

  it('errors on an unknown task without writing anything', async () => {
    tasks = [{ id: 't1', parentId: null, timeSpent: 0, timeSpentOnDay: {} }];
    const res = await logEntries('nope', [{ date: '2026-08-31', durationMs: HOUR }]);
    expect(res.success).toBe(false);
    expect(globalThis.PluginAPI.updateTask).not.toHaveBeenCalled();
  });
});
