import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { errorResult, okResult } from './result.js';


export function registerProjectTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('create_project', {
    description: 'Create a new project in Super Productivity.',
    inputSchema: {
      title: z.string().describe('Project title'),
      description: z.string().optional().describe('Project description'),
      color: z.string().optional().describe('Project color (hex code, e.g. #2196F3)'),
    },
  }, async ({ title, description, color }) => {
    if (!title?.trim()) return errorResult('Title is required');
    const data: Record<string, unknown> = { title };
    if (description) data.description = description;
    if (color) data.theme = { primary: color };
    const res = await sendCommand(dirs, 'addProject', { data });
    if (!res.success) return errorResult(res.error ?? 'Failed to create project');
    return okResult({ projectId: res.result });
  });

  server.registerTool('get_projects', {
    description: 'Get all projects from Super Productivity.',
    inputSchema: {},
  }, async () => {
    const res = await sendCommand(dirs, 'getAllProjects');
    if (!res.success) return errorResult(res.error ?? 'Failed to get projects');
    return okResult(res.result);
  });

  server.registerTool('update_project', {
    description: 'Update an existing project.',
    inputSchema: {
      project_id: z.string().describe('Project ID to update'),
      title: z.string().optional().describe('New title'),
      color: z.string().optional().describe('New color (hex code)'),
    },
  }, async ({ project_id, title, color }) => {
    if (!project_id?.trim()) return errorResult('project_id is required');
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (color !== undefined) data.theme = { primary: color };
    const res = await sendCommand(dirs, 'updateProject', { projectId: project_id, data });
    if (!res.success) return errorResult(res.error ?? 'Failed to update project');
    return okResult(res.result);
  });
}
