import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync } from 'node:fs';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { errorResult, okResult } from './result.js';


export function registerDiagnosticTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('check_connection', {
    description: 'Check if Super Productivity is running and the MCP Bridge plugin is responding.',
    inputSchema: {},
  }, async () => {
    const res = await sendCommand(dirs, 'ping', {}, 5000);
    if (!res.success) return errorResult(res.error ?? 'Connection check failed');
    return okResult({ status: 'connected', ...res.result as object, dataDir: dirs.base });
  });

  server.registerTool('debug_directories', {
    description: 'Show resolved data directory paths and their existence status. No connection to Super Productivity required.',
    inputSchema: {},
  }, async () => {
    return okResult({
      base: dirs.base,
      commands: dirs.commands,
      responses: dirs.responses,
      exists: {
        base: existsSync(dirs.base),
        commands: existsSync(dirs.commands),
        responses: existsSync(dirs.responses),
      },
    });
  });
}
