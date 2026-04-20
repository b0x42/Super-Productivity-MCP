import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import type { TaskFilters } from '../ipc/types.js';

interface TaskRecord {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
  tagIds: string[];
  timeSpentOnDay?: Record<string, number>;
  timeEstimate: number;
  timeSpent: number;
  doneOn?: number | null;
  [key: string]: unknown;
}

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
}

function okResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? null, null, 2) }] };
}

export function registerTaskTools(server: McpServer, dirs: ResolvedDirs): void {
  // T015: create_task
  server.registerTool(
    'create_task',
    {
      description: 'Create a new task in Super Productivity. Supports SP short syntax in the title: #tag, +project (prefix match, min 3 chars), @due-date (e.g. @tomorrow, @friday 3pm), and time estimates (30m, 1h, 1h/2h for spent/estimate). Tasks without a project go to the Inbox.',
      inputSchema: {
        title: z.string().describe('Task title. May include SP short syntax: #tag +project @due-date 30m'),
        notes: z.string().optional().describe('Task notes/description'),
        project_id: z.string().optional().describe('Project ID to assign task to'),
        parent_id: z.string().optional().describe('Parent task ID for creating subtasks'),
        tag_ids: z.array(z.string()).optional().describe('Tag IDs to assign'),
      },
    },
    async ({ title, notes, project_id, parent_id, tag_ids }) => {
      if (!title?.trim()) return errorResult('Title is required');

      const data: Record<string, unknown> = { title, notes: notes ?? '', tagIds: tag_ids ?? [] };
      if (project_id) data.projectId = project_id;
      if (parent_id) data.parentId = parent_id;

      // T016: subtask SP syntax workaround
      const hasSyntax = parent_id && /[@#[+]]/.test(title);
      if (hasSyntax) {
        data.title = title.replace(/\s*[@#[+]]\S+/g, '').trim() || title;
      }

      const res = await sendCommand(dirs, 'addTask', { data });
      if (!res.success) return errorResult(res.error ?? 'Failed to create task');

      // Step 2 of workaround: update with original title to trigger syntax parsing
      if (hasSyntax && res.result) {
        await sendCommand(dirs, 'updateTask', { taskId: res.result as string, data: { title } });
      }

      return okResult({ taskId: res.result });
    },
  );

  // T017: get_tasks
  server.registerTool(
    'get_tasks',
    {
      description: 'Get tasks from Super Productivity with optional filters. By default returns non-done, non-archived tasks.',
      inputSchema: {
        project_id: z.string().optional().describe('Filter by project ID'),
        tag_id: z.string().optional().describe('Filter by tag ID'),
        include_done: z.boolean().optional().default(false).describe('Include completed tasks'),
        include_archived: z.boolean().optional().default(false).describe('Include archived tasks'),
        search_query: z.string().optional().describe('Case-insensitive title search'),
      },
    },
    async ({ project_id, tag_id, include_done, include_archived, search_query }) => {
      const filters: TaskFilters = {
        projectId: project_id,
        tagId: tag_id,
        includeDone: include_done,
        includeArchived: include_archived,
        searchQuery: search_query,
      };
      const res = await sendCommand(dirs, 'getTasks', { filters });
      if (!res.success) return errorResult(res.error ?? 'Failed to get tasks');

      // Server-side filtering
      let tasks = (res.result as TaskRecord[]) ?? [];
      if (!include_done) tasks = tasks.filter(t => !t.isDone);
      if (project_id) tasks = tasks.filter(t => t.projectId === project_id);
      if (tag_id) tasks = tasks.filter(t => t.tagIds?.includes(tag_id));
      if (search_query) {
        const q = search_query.toLowerCase();
        tasks = tasks.filter(t => t.title?.toLowerCase().includes(q));
      }

      return okResult(tasks);
    },
  );

  // T018: update_task
  server.registerTool(
    'update_task',
    {
      description: 'Update an existing task. Supports SP short syntax in the title.',
      inputSchema: {
        task_id: z.string().describe('Task ID to update'),
        title: z.string().optional().describe('New title (may include SP short syntax)'),
        notes: z.string().optional().describe('New notes'),
        is_done: z.boolean().optional().describe('Mark as done/undone'),
        due_day: z.string().optional().describe('Due date in ISO format (e.g. 2026-04-20), or empty string to clear'),
        time_estimate: z.number().optional().describe('Time estimate in milliseconds'),
        time_spent: z.number().optional().describe('Time spent in milliseconds'),
      },
    },
    async ({ task_id, title, notes, is_done, due_day, time_estimate, time_spent }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');

      const data: Record<string, unknown> = {};
      if (title !== undefined) data.title = title;
      if (notes !== undefined) data.notes = notes;
      if (is_done !== undefined) {
        data.isDone = is_done;
        data.doneOn = is_done ? Date.now() : null;
      }
      if (due_day !== undefined) data.dueDay = due_day || null;
      if (time_estimate !== undefined) data.timeEstimate = time_estimate;
      if (time_spent !== undefined) data.timeSpent = time_spent;

      const res = await sendCommand(dirs, 'updateTask', { taskId: task_id, data });
      if (!res.success) return errorResult(res.error ?? 'Failed to update task');
      return okResult(res.result);
    },
  );

  // T019: complete_task
  server.registerTool(
    'complete_task',
    {
      description: 'Mark a task as complete in Super Productivity.',
      inputSchema: {
        task_id: z.string().describe('Task ID to complete'),
      },
    },
    async ({ task_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      const res = await sendCommand(dirs, 'setTaskDone', { taskId: task_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to complete task');
      return okResult(res.result);
    },
  );

  // T030: get_worklog (US5 — registered here since it uses task data)
  server.registerTool(
    'get_worklog',
    {
      description: 'Get a worklog summary for a date range: time spent per day, per project, per tag, tasks completed, and estimate vs actual accuracy.',
      inputSchema: {
        start_date: z.string().describe('Start date (ISO format, e.g. 2026-04-14)'),
        end_date: z.string().describe('End date (ISO format, e.g. 2026-04-20)'),
      },
    },
    async ({ start_date, end_date }) => {
      if (!start_date || !end_date) return errorResult('start_date and end_date are required');

      const res = await sendCommand(dirs, 'getTasks', {
        filters: { includeDone: true, includeArchived: true },
      });
      if (!res.success) return errorResult(res.error ?? 'Failed to get tasks');

      const tasks = (res.result as TaskRecord[]) ?? [];
      const daily: Record<string, number> = {};
      const byProject: Record<string, number> = {};
      const byTag: Record<string, number> = {};
      let completedCount = 0;
      let totalEstimate = 0;
      let totalActual = 0;

      for (const task of tasks) {
        // Aggregate timeSpentOnDay within range
        if (task.timeSpentOnDay) {
          for (const [date, ms] of Object.entries(task.timeSpentOnDay)) {
            if (date >= start_date && date <= end_date) {
              daily[date] = (daily[date] ?? 0) + ms;
              const proj = task.projectId ?? 'No Project';
              byProject[proj] = (byProject[proj] ?? 0) + ms;
              for (const tagId of task.tagIds ?? []) {
                byTag[tagId] = (byTag[tagId] ?? 0) + ms;
              }
            }
          }
        }
        // Count completions in range
        if (task.isDone && task.doneOn) {
          const doneDate = new Date(task.doneOn).toISOString().slice(0, 10);
          if (doneDate >= start_date && doneDate <= end_date) {
            completedCount++;
            if (task.timeEstimate > 0) {
              totalEstimate += task.timeEstimate;
              totalActual += task.timeSpent;
            }
          }
        }
      }

      return okResult({
        dateRange: { start: start_date, end: end_date },
        daily,
        byProject,
        byTag,
        tasksCompleted: completedCount,
        estimateAccuracy: totalEstimate > 0
          ? { estimateMs: totalEstimate, actualMs: totalActual, ratio: totalActual / totalEstimate }
          : null,
      });
    },
  );
}
