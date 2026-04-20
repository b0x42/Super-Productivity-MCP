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

export function registerNotificationTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('show_notification', {
    description: 'Show a notification (snackbar) in Super Productivity\'s UI.',
    inputSchema: {
      message: z.string().describe('Notification message'),
      type: z.enum(['SUCCESS', 'INFO', 'WARNING', 'ERROR']).optional().default('INFO').describe('Notification type'),
    },
  }, async ({ message, type }) => {
    if (!message?.trim()) return errorResult('Message is required');
    const res = await sendCommand(dirs, 'showSnack', { message, data: { type } });
    if (!res.success) return errorResult(res.error ?? 'Failed to show notification');
    return okResult({ sent: true });
  });
}
