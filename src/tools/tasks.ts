import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import type { TaskFilters } from '../ipc/types.js';
import { errorResult, okResult } from './result.js';

interface TaskRecord {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
  parentId?: string | null;
  tagIds: string[];
  dueDay?: string | null;
  dueWithTime?: number | null;
  timeSpentOnDay?: Record<string, number>;
  timeEstimate: number;
  timeSpent: number;
  doneOn?: number | null;
  [key: string]: unknown;
}



/** Compute local YYYY-MM-DD date string (not UTC — spec requires local timezone boundary). */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Apply triage filters to a task list. Exported for testability. */
export function applyTriageFilters(
  tasks: TaskRecord[],
  opts: { parentsOnly?: boolean; overdue?: boolean; unscheduled?: boolean },
): TaskRecord[] {
  let result = tasks;
  if (opts.parentsOnly) result = result.filter(t => !t.parentId);
  if (opts.overdue) {
    const today = localDateStr();
    result = result.filter(t => t.dueDay != null && (t.dueDay as string) < today);
  }
  if (opts.unscheduled) result = result.filter(t => !t.dueDay && !t.dueWithTime);
  return result;
}

export function registerTaskTools(server: McpServer, dirs: ResolvedDirs): void {
  // create_task
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

      // SP auto-assigns plannedAt/dueDay to today when viewing Today context.
      // Passing null satisfies SP's `'dueDay' in additional` guard, preventing auto-scheduling
      // unless the title contains @date syntax (which SP will parse into a date itself).
      const hasDateSyntax = /@/.test(title);
      if (!hasDateSyntax) {
        data.plannedAt = null;
        data.dueDay = null;
      }

      // T016: subtask SP syntax workaround
      const hasSyntax = parent_id && /[@#+]/.test(title);
      if (hasSyntax) {
        data.title = title.replace(/\s*[@#+]\S+/g, '').trim() || title;
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

  // get_tasks
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
        parents_only: z.boolean().optional().default(false).describe('Exclude subtasks — return only top-level tasks'),
        overdue: z.boolean().optional().default(false).describe('Return only tasks with a due date strictly before today'),
        unscheduled: z.boolean().optional().default(false).describe('Return only tasks with no due date and no scheduled time'),
      },
    },
    async ({ project_id, tag_id, include_done, include_archived, search_query, parents_only, overdue, unscheduled }) => {
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

      // Triage filters (FR-004, FR-005, FR-006)
      tasks = applyTriageFilters(tasks, { parentsOnly: parents_only, overdue, unscheduled });

      return okResult(tasks);
    },
  );

  // update_task
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
        tag_ids: z.array(z.string()).optional().describe('Bulk-replace all tags with this list (FR-003)'),
      },
    },
    async ({ task_id, title, notes, is_done, due_day, time_estimate, time_spent, tag_ids }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');

      const data: Record<string, unknown> = {};
      if (title !== undefined) data.title = title;
      if (notes !== undefined) data.notes = notes;
      if (is_done !== undefined) {
        data.isDone = is_done;
        data.doneOn = is_done ? Date.now() : null;
      }
      if (due_day !== undefined) {
        data.dueDay = due_day || null;
        data.plannedAt = due_day ? Date.now() : null;
      }
      if (time_estimate !== undefined) data.timeEstimate = time_estimate;
      if (time_spent !== undefined) data.timeSpent = time_spent;
      // tag_ids replaces the entire tag list; use add_tag_to_task / remove_tag_from_task for incremental changes
      if (tag_ids !== undefined) data.tagIds = tag_ids;

      const res = await sendCommand(dirs, 'updateTask', { taskId: task_id, data });
      if (!res.success) return errorResult(res.error ?? 'Failed to update task');
      return okResult(res.result);
    },
  );

  // complete_task
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

  // T004: add_tag_to_task (FR-001 — add single tag without replacing others)
  server.registerTool(
    'add_tag_to_task',
    {
      description: 'Add a single tag to a task without modifying its other existing tags. Idempotent: calling with an already-present tag succeeds silently.',
      inputSchema: {
        task_id: z.string().describe('Task ID'),
        tag_id: z.string().describe('Tag ID to add'),
      },
    },
    async ({ task_id, tag_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      if (!tag_id?.trim()) return errorResult('tag_id is required');
      const res = await sendCommand(dirs, 'addTagToTask', { taskId: task_id, tagId: tag_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to add tag');
      return okResult(null);
    },
  );

  // T005: remove_tag_from_task (FR-002 — remove single tag; error if not present)
  server.registerTool(
    'remove_tag_from_task',
    {
      description: 'Remove a single tag from a task without modifying its other existing tags. Returns an error if the tag is not currently on the task.',
      inputSchema: {
        task_id: z.string().describe('Task ID'),
        tag_id: z.string().describe('Tag ID to remove'),
      },
    },
    async ({ task_id, tag_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      if (!tag_id?.trim()) return errorResult('tag_id is required');
      const res = await sendCommand(dirs, 'removeTagFromTask', { taskId: task_id, tagId: tag_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to remove tag');
      return okResult(null);
    },
  );

  // T014: get_current_task (FR-010 — return currently time-tracked task or null)
  server.registerTool(
    'get_current_task',
    {
      description: 'Get the currently time-tracked task in Super Productivity. Returns null when no task has an active timer.',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'loadCurrentTask', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to get current task');
      return okResult(res.result ?? null);
    },
  );

  // start_task (003-FR-001 — start time tracker on a task)
  server.registerTool(
    'start_task',
    {
      description: 'Start the time tracker on a task. If another task is being tracked, it will be stopped automatically. Cannot start tracking a completed task.',
      inputSchema: {
        task_id: z.string().describe('Task ID to start tracking'),
      },
    },
    async ({ task_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      const res = await sendCommand(dirs, 'startTask', { taskId: task_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to start task');
      return okResult(null);
    },
  );

  // stop_task (003-FR-002 — stop the currently running timer)
  server.registerTool(
    'stop_task',
    {
      description: 'Stop the currently running time tracker. Succeeds silently if no timer is running (idempotent).',
      inputSchema: {},
    },
    async () => {
      const res = await sendCommand(dirs, 'stopTask', {});
      if (!res.success) return errorResult(res.error ?? 'Failed to stop task');
      return okResult(null);
    },
  );

  // move_task_to_project (FR-008 — move top-level task; error on subtask)
  server.registerTool(
    'move_task_to_project',
    {
      description: 'Move a top-level task to a different project. Returns an error if called on a subtask.',
      inputSchema: {
        task_id: z.string().describe('Task ID to move'),
        project_id: z.string().describe('Destination project ID'),
      },
    },
    async ({ task_id, project_id }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      if (!project_id?.trim()) return errorResult('project_id is required');
      const res = await sendCommand(dirs, 'moveTaskToProject', { taskId: task_id, projectId: project_id });
      if (!res.success) return errorResult(res.error ?? 'Failed to move task');
      return okResult(null);
    },
  );

  // reorder_tasks (FR-009 — reorder tasks within a project or parent)
  server.registerTool(
    'reorder_tasks',
    {
      description: 'Reorder tasks within a project or subtasks within a parent task. Provide a complete ordered list of task IDs — partial reordering is not supported.',
      inputSchema: {
        task_ids: z.array(z.string()).describe('Complete ordered list of task IDs'),
        context_id: z.string().describe('Project ID (if context_type is "project") or parent task ID (if "parent")'),
        context_type: z.enum(['project', 'parent']).describe('Whether context_id refers to a project or a parent task'),
      },
    },
    async ({ task_ids, context_id, context_type }) => {
      if (!task_ids?.length) return errorResult('task_ids must not be empty');
      if (!context_id?.trim()) return errorResult('context_id is required');
      const res = await sendCommand(dirs, 'reorderTasks', { taskIds: task_ids, contextId: context_id, contextType: context_type });
      if (!res.success) return errorResult(res.error ?? 'Failed to reorder tasks');
      return okResult(null);
    },
  );

  // get_worklog (US5 — registered here since it uses task data)
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
          const d = new Date(task.doneOn);
          const doneDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
