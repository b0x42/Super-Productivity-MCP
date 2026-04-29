import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { applyTriageFilters } from '../tools/tasks.js';

interface TaskRecord {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
  parentId?: string | null;
  tagIds: string[];
  dueDay?: string | null;
  plannedAt?: number | null;
  timeEstimate: number;
  timeSpent: number;
  [key: string]: unknown;
}

function shapeTask(t: TaskRecord) {
  return {
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    tagIds: t.tagIds,
    dueDay: t.dueDay ?? null,
    plannedAt: t.plannedAt ?? null,
    timeEstimate: t.timeEstimate,
    timeSpent: t.timeSpent,
    parentId: t.parentId ?? null,
  };
}

export function registerResources(server: McpServer, dirs: ResolvedDirs): void {
  server.registerResource('sp-projects', 'sp://projects', {
    description: 'All Super Productivity projects with IDs and colors',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getAllProjects');
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const projects = (res.result as Array<Record<string, unknown>>).map(p => ({
      id: p.id,
      title: p.title,
      color: (p.theme as Record<string, unknown>)?.primary ?? null,
    }));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(projects) }] };
  });

  server.registerResource('sp-tags', 'sp://tags', {
    description: 'All Super Productivity tags with IDs, colors, and icons',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getAllTags');
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const tags = (res.result as Array<Record<string, unknown>>).map(t => ({
      id: t.id,
      title: t.title,
      color: (t.theme as Record<string, unknown>)?.primary ?? t.color ?? null,
      icon: t.icon ?? null,
    }));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tags) }] };
  });

  server.registerResource('sp-tasks-today', 'sp://tasks/today', {
    description: "Today's planned tasks",
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getTasks', { filters: {} });
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const tasks = applyTriageFilters(res.result as TaskRecord[], { plannedForToday: true });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tasks.map(shapeTask)) }] };
  });

  server.registerResource('sp-tasks-overdue', 'sp://tasks/overdue', {
    description: 'Overdue tasks (due date strictly before today)',
    mimeType: 'application/json',
  }, async (uri) => {
    const res = await sendCommand(dirs, 'getTasks', { filters: {} });
    if (!res.success) throw new Error(res.error ?? 'SP not responding');
    const tasks = applyTriageFilters(res.result as TaskRecord[], { overdue: true });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(tasks.map(shapeTask)) }] };
  });
}
