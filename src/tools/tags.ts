import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';

function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
}
function okResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerTagTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('create_tag', {
    description: 'Create a new tag in Super Productivity.',
    inputSchema: {
      title: z.string().describe('Tag title'),
      color: z.string().optional().describe('Tag color (hex code, e.g. #FF9800)'),
    },
  }, async ({ title, color }) => {
    if (!title?.trim()) return errorResult('Title is required');
    const data: Record<string, unknown> = { title };
    if (color) data.color = color;
    const res = await sendCommand(dirs, 'addTag', { data });
    if (!res.success) return errorResult(res.error ?? 'Failed to create tag');
    return okResult({ tagId: res.result });
  });

  server.registerTool('get_tags', {
    description: 'Get all tags from Super Productivity.',
    inputSchema: {},
  }, async () => {
    const res = await sendCommand(dirs, 'getAllTags');
    if (!res.success) return errorResult(res.error ?? 'Failed to get tags');
    return okResult(res.result);
  });

  server.registerTool('update_tag', {
    description: 'Update an existing tag.',
    inputSchema: {
      tag_id: z.string().describe('Tag ID to update'),
      title: z.string().optional().describe('New title'),
      color: z.string().optional().describe('New color (hex code)'),
      icon: z.string().optional().describe('New icon'),
    },
  }, async ({ tag_id, title, color, icon }) => {
    if (!tag_id?.trim()) return errorResult('tag_id is required');
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (color !== undefined) data.color = color;
    if (icon !== undefined) data.icon = icon;
    const res = await sendCommand(dirs, 'updateTag', { tagId: tag_id, data });
    if (!res.success) return errorResult(res.error ?? 'Failed to update tag');
    return okResult(res.result);
  });
}
