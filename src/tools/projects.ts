import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { errorResult, okResult } from './result.js';


export function registerProjectTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('create_project', {
    description:
      'Create a new project in Super Productivity. Note: folder_id must be obtained from the ' +
      'Super Productivity UI — this server has no way to list folders. Pass folder_id: null (or ' +
      'omit it) to leave the project unfiled.',
    inputSchema: {
      title: z.string().describe('Project title'),
      description: z.string().optional().describe('Project description'),
      color: z.string().optional().describe('Project color (hex code, e.g. #2196F3)'),
      folder_id: z
        .string()
        .nullable()
        .optional()
        .describe(
          'ID of the folder to place the project in (from the Super Productivity UI), or null to leave unfiled',
        ),
    },
  }, async ({ title, description, color, folder_id }) => {
    if (!title?.trim()) return errorResult('Title is required');
    if (folder_id !== undefined && folder_id !== null && !folder_id.trim()) {
      return errorResult('folder_id must not be empty');
    }
    const data: Record<string, unknown> = { title };
    if (description) data.description = description;
    if (color) data.theme = { primary: color };
    if (folder_id !== undefined) data.folderId = folder_id;
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
    description:
      'Update an existing project. Note: folder_id must be obtained from the Super Productivity ' +
      'UI — this server has no way to list folders. Pass folder_id: null to clear the folder ' +
      'assignment (move the project back to the root); omit folder_id to leave it unchanged.',
    inputSchema: {
      project_id: z.string().describe('Project ID to update'),
      title: z.string().optional().describe('New title'),
      color: z.string().optional().describe('New color (hex code)'),
      folder_id: z
        .string()
        .nullable()
        .optional()
        .describe(
          'ID of the folder to move the project into (from the Super Productivity UI), or null to clear it',
        ),
    },
  }, async ({ project_id, title, color, folder_id }) => {
    if (!project_id?.trim()) return errorResult('project_id is required');
    if (folder_id !== undefined && folder_id !== null && !folder_id.trim()) {
      return errorResult('folder_id must not be empty');
    }
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (color !== undefined) data.theme = { primary: color };
    if (folder_id !== undefined) data.folderId = folder_id;
    const res = await sendCommand(dirs, 'updateProject', { projectId: project_id, data });
    if (!res.success) return errorResult(res.error ?? 'Failed to update project');
    return okResult(res.result);
  });
}
