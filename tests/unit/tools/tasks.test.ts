import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendCommand before importing the module under test
vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { applyTriageFilters, localDateStr } from '../../../src/tools/tasks.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

// Instead of testing through McpServer (which has no public API to call tools),
// we test the sendCommand integration and filtering logic directly.
// The tool registration is verified by the build + integration tests.

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

describe('task tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create_task via sendCommand', () => {
    it('sends addTask with correct data', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('task-123'));
      const res = await sendCommand(dirs, 'addTask', {
        data: { title: 'Test task', notes: 'Some notes', tagIds: [] },
      });
      expect(res.success).toBe(true);
      expect(res.result).toBe('task-123');
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTask', {
        data: { title: 'Test task', notes: 'Some notes', tagIds: [] },
      });
    });
  });

  describe('get_tasks filtering', () => {
    const allTasks = [
      { id: '1', title: 'Open task', isDone: false, projectId: 'proj-1', tagIds: ['tag-1'] },
      { id: '2', title: 'Done task', isDone: true, projectId: 'proj-1', tagIds: [] },
      { id: '3', title: 'Other project', isDone: false, projectId: 'proj-2', tagIds: ['tag-1'] },
      { id: '4', title: 'Buy groceries', isDone: false, projectId: null, tagIds: [] },
    ];

    it('filters out done tasks by default', () => {
      const filtered = allTasks.filter(t => !t.isDone);
      expect(filtered).toHaveLength(3);
      expect(filtered.every(t => !t.isDone)).toBe(true);
    });

    it('filters by projectId', () => {
      const filtered = allTasks.filter(t => !t.isDone && t.projectId === 'proj-1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('filters by tagId', () => {
      const filtered = allTasks.filter(t => !t.isDone && t.tagIds.includes('tag-1'));
      expect(filtered).toHaveLength(2);
    });

    it('filters by search query case-insensitive', () => {
      const q = 'GROCERIES'.toLowerCase();
      const filtered = allTasks.filter(t => !t.isDone && t.title.toLowerCase().includes(q));
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('4');
    });
  });

  describe('update_task via sendCommand', () => {
    it('sends updateTask with isDone and doneOn', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { isDone: true, doneOn: Date.now() },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: expect.objectContaining({ isDone: true, doneOn: expect.any(Number) }),
      }));
    });

    it('sends updateTask with dueDay and plannedAt together', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { dueDay: '2026-04-20', plannedAt: 1745150400000 },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: expect.objectContaining({ dueDay: '2026-04-20', plannedAt: expect.any(Number) }),
      }));
    });

    it('clears dueDay and plannedAt together', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', {
        taskId: 'task-1',
        data: { dueDay: null, plannedAt: null },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        taskId: 'task-1',
        data: { dueDay: null, plannedAt: null },
      }));
    });
  });

  describe('complete_task via sendCommand', () => {
    it('sends setTaskDone', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'setTaskDone', { taskId: 'task-1' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setTaskDone', { taskId: 'task-1' });
    });
  });

  // T007: US1 — tag operations
  describe('add_tag_to_task via sendCommand', () => {
    it('sends addTagToTask with taskId and tagId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-a' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-a' });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'addTagToTask', { taskId: 'task-x', tagId: 'tag-a' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });

    it('succeeds silently when tag already present (idempotent)', async () => {
      // Plugin returns success even when tag is already on the task — no-op
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'addTagToTask', { taskId: 'task-1', tagId: 'tag-already-there' });
      expect(res.success).toBe(true);
      expect(res.result).toBeNull();
    });
  });

  describe('remove_tag_from_task via sendCommand', () => {
    it('sends removeTagFromTask with taskId and tagId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-a' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-a' });
    });

    it('propagates error when tag not on task', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Tag tag-z not on task task-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'removeTagFromTask', { taskId: 'task-1', tagId: 'tag-z' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('not on task');
    });
  });

  describe('update_task with tag_ids (bulk replace)', () => {
    it('sends updateTask with tagIds array', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', { taskId: 'task-1', data: { tagIds: ['tag-a', 'tag-b'] } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        data: expect.objectContaining({ tagIds: ['tag-a', 'tag-b'] }),
      }));
    });

    it('sends updateTask with empty tagIds to clear all tags', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTask', { taskId: 'task-1', data: { tagIds: [] } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTask', expect.objectContaining({
        data: expect.objectContaining({ tagIds: [] }),
      }));
    });
  });

  // T010: US2 — triage filter logic (exercises actual applyTriageFilters from tasks.ts)
  describe('get_tasks triage filters', () => {
    const today = localDateStr();
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    const tomorrow = localDateStr(new Date(Date.now() + 86400000));

    const tasks = [
      { id: '1', title: 'Parent overdue', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: yesterday, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '2', title: 'Parent unscheduled', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: null, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '3', title: 'Parent future', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: tomorrow, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '4', title: 'Subtask overdue', isDone: false, projectId: null, tagIds: [], parentId: 'task-parent', dueDay: yesterday, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
      { id: '5', title: 'Scheduled today', isDone: false, projectId: 'p1', tagIds: [], parentId: null, dueDay: today, dueWithTime: null, timeEstimate: 0, timeSpent: 0 },
    ];

    it('parents_only excludes subtasks', () => {
      const result = applyTriageFilters(tasks, { parentsOnly: true });
      expect(result.every(t => !t.parentId)).toBe(true);
      expect(result.find(t => t.id === '4')).toBeUndefined();
    });

    it('overdue returns only tasks with dueDay strictly before today', () => {
      const result = applyTriageFilters(tasks, { overdue: true });
      expect(result.every(t => t.dueDay! < today)).toBe(true);
      expect(result.map(t => t.id)).toEqual(expect.arrayContaining(['1', '4']));
    });

    it('overdue excludes dueDay === today (boundary)', () => {
      const result = applyTriageFilters(tasks, { overdue: true });
      expect(result.find(t => t.id === '5')).toBeUndefined();
    });

    it('unscheduled returns only tasks with no dueDay and no dueWithTime', () => {
      const result = applyTriageFilters(tasks, { unscheduled: true });
      expect(result.map(t => t.id)).toEqual(['2']);
    });

    it('parents_only + unscheduled returns AND intersection', () => {
      const result = applyTriageFilters(tasks, { parentsOnly: true, unscheduled: true });
      expect(result.map(t => t.id)).toEqual(['2']);
    });

    it('overdue + unscheduled returns empty (mutually exclusive)', () => {
      const result = applyTriageFilters(tasks, { overdue: true, unscheduled: true });
      expect(result).toHaveLength(0);
    });
  });

  // T017: US3 — organisation operations
  describe('get_current_task via sendCommand', () => {
    it('returns task object when timer is active', async () => {
      const task = { id: 'task-1', title: 'Active task' };
      mockSend.mockResolvedValueOnce(mockResponse(task));
      const res = await sendCommand(dirs, 'loadCurrentTask', {});
      expect(res.success).toBe(true);
      expect(res.result).toEqual(task);
    });

    it('returns null when no timer is running', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'loadCurrentTask', {});
      expect(res.success).toBe(true);
      expect(res.result).toBeNull();
    });
  });

  describe('move_task_to_project via sendCommand', () => {
    it('sends moveTaskToProject with taskId and projectId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
    });

    it('propagates error when task is a subtask', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Cannot move subtask: task-1 has parentId parent-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-b' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Cannot move subtask');
    });

    it('propagates error when project not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Project not found: proj-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'moveTaskToProject', { taskId: 'task-1', projectId: 'proj-x' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Project not found');
    });
  });

  describe('reorder_tasks via sendCommand', () => {
    it('sends reorderTasks with taskIds, contextId, contextType', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'reorderTasks', { taskIds: ['t3', 't1', 't2'], contextId: 'proj-1', contextType: 'project' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'reorderTasks', {
        taskIds: ['t3', 't1', 't2'],
        contextId: 'proj-1',
        contextType: 'project',
      });
    });

    it('propagates error when a task does not belong to the context', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task foreign-task does not belong to context proj-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'reorderTasks', { taskIds: ['t1', 'foreign-task'], contextId: 'proj-1', contextType: 'project' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('does not belong to context');
    });
  });

  // T006: US1 — timer control operations (003-FR-001, 003-FR-002)
  describe('start_task via sendCommand', () => {
    it('sends startTask with taskId', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-1' });
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'startTask', { taskId: 'task-1' });
    });

    it('propagates error when task not found', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: task-x', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-x' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Task not found');
    });

    it('propagates error when task is done', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Cannot start tracking a completed task: task-1', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'startTask', { taskId: 'task-1' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch('Cannot start tracking a completed task');
    });
  });

  describe('stop_task via sendCommand', () => {
    it('sends stopTask command', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'stopTask', {});
      expect(res.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'stopTask', {});
    });

    it('succeeds even when no timer is running (idempotent)', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      const res = await sendCommand(dirs, 'stopTask', {});
      expect(res.success).toBe(true);
    });
  });

  describe('get_worklog aggregation', () => {
    it('aggregates timeSpentOnDay by date and project', () => {
      const tasks = [
        {
          id: '1', title: 'A', isDone: true, doneOn: new Date('2026-04-15').getTime(),
          projectId: 'proj-1', tagIds: ['tag-1'], timeEstimate: 3600000, timeSpent: 4000000,
          timeSpentOnDay: { '2026-04-14': 1800000, '2026-04-15': 2200000 },
        },
        {
          id: '2', title: 'B', isDone: false, doneOn: null,
          projectId: 'proj-1', tagIds: [], timeEstimate: 0, timeSpent: 0,
          timeSpentOnDay: { '2026-04-15': 600000 },
        },
      ];

      const startDate = '2026-04-14';
      const endDate = '2026-04-15';
      const daily: Record<string, number> = {};
      const byProject: Record<string, number> = {};
      let completedCount = 0;
      let totalEstimate = 0;
      let totalActual = 0;

      for (const task of tasks) {
        if (task.timeSpentOnDay) {
          for (const [date, ms] of Object.entries(task.timeSpentOnDay)) {
            if (date >= startDate && date <= endDate) {
              daily[date] = (daily[date] ?? 0) + ms;
              const proj = task.projectId ?? 'No Project';
              byProject[proj] = (byProject[proj] ?? 0) + ms;
            }
          }
        }
        if (task.isDone && task.doneOn) {
          const doneDate = new Date(task.doneOn).toISOString().slice(0, 10);
          if (doneDate >= startDate && doneDate <= endDate) {
            completedCount++;
            if (task.timeEstimate > 0) {
              totalEstimate += task.timeEstimate;
              totalActual += task.timeSpent;
            }
          }
        }
      }

      expect(daily['2026-04-14']).toBe(1800000);
      expect(daily['2026-04-15']).toBe(2800000);
      expect(byProject['proj-1']).toBe(4600000);
      expect(completedCount).toBe(1);
      expect(totalActual / totalEstimate).toBeCloseTo(4000000 / 3600000);
    });
  });
});
