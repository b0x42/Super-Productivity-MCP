import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveDirectories, type ResolvedDirs } from './ipc/directories.js';
import { cleanStaleFiles } from './ipc/command-sender.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';
import { registerTagTools } from './tools/tags.js';
import { registerHabitTools } from './tools/habits.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerDiagnosticTools } from './tools/diagnostics.js';
import { registerResources } from './resources/index.js';
import { createRecorder } from './recording/recorder.js';
import { instrumentServer } from './recording/instrument.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read the version from package.json rather than repeating it here — the
 * hardcoded copy went stale at the 1.7.0 release without anything noticing.
 * The relative path resolves the same from src/ and from the bundled dist/.
 */
export function readPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string;
  } catch {
    return '0.0.0';
  }
}

export function createServer(): { server: McpServer; dirs: ResolvedDirs } {
  const dirs = resolveDirectories();
  cleanStaleFiles(dirs);

  const server = new McpServer({
    name: 'super-productivity',
    version: readPackageVersion(),
  });

  // Every tool registers through the instrumented wrapper, so all of them are
  // recorded without a per-tool change. Non-tool members pass straight through.
  const recording = instrumentServer(server, createRecorder(dirs));

  registerTaskTools(recording, dirs);
  registerProjectTools(recording, dirs);
  registerTagTools(recording, dirs);
  registerHabitTools(recording, dirs);
  registerNotificationTools(recording, dirs);
  registerDiagnosticTools(recording, dirs);
  registerResources(recording, dirs);

  return { server, dirs };
}

export async function startServer(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
