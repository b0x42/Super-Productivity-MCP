import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveDirectories, type ResolvedDirs } from './ipc/directories.js';
import { cleanStaleFiles } from './ipc/command-sender.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';
import { registerTagTools } from './tools/tags.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerDiagnosticTools } from './tools/diagnostics.js';

export function createServer(): { server: McpServer; dirs: ResolvedDirs } {
  const dirs = resolveDirectories();
  cleanStaleFiles(dirs);

  const server = new McpServer({
    name: 'super-productivity',
    version: '1.1.1',
  });

  registerTaskTools(server, dirs);
  registerProjectTools(server, dirs);
  registerTagTools(server, dirs);
  registerNotificationTools(server, dirs);
  registerDiagnosticTools(server, dirs);

  return { server, dirs };
}

export async function startServer(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
