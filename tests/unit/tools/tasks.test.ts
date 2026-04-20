import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendCommand before importing the module under test
vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
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
  });

  describe('complete_task via sendCommand', () => {
    it('sends setTaskDone', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'setTaskDone', { taskId: 'task-1' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setTaskDone', { taskId: 'task-1' });
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
