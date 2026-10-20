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
import { createRecorder, type Recorder } from './recording/recorder.js';
import { startHttpSupervisor, type HttpSupervisor } from './http/supervisor.js';
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

/**
 * Build a fully-registered server. The HTTP transport builds one per request,
 * so it passes in an already-resolved data directory and a shared recorder:
 * re-probing the filesystem and re-counting tool-calls.jsonl on every request
 * would be wasted work.
 */
export function createServer(
  existingDirs?: ResolvedDirs,
  sharedRecorder?: Recorder,
): { server: McpServer; dirs: ResolvedDirs } {
  const dirs = existingDirs ?? resolveDirectories();
  if (!existingDirs) cleanStaleFiles(dirs);

  const server = new McpServer({
    name: 'super-productivity',
    version: readPackageVersion(),
  });

  // Every tool registers through the instrumented wrapper, so all of them are
  // recorded without a per-tool change. Non-tool members pass straight through.
  const recording = instrumentServer(server, sharedRecorder ?? createRecorder(dirs));

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

/**
 * Run the long-lived HTTP mode (`--http`, 009-FR-003). Whether a listener is actually open
 * is decided by the plugin's settings (see http/supervisor.ts), which default
 * to off — so on a fresh install this process idles and binds nothing.
 */
export async function startHttpMode(opts: { parentPid?: number; candidatePaths?: string[] } = {}): Promise<HttpSupervisor> {
  // Resolving SP_MCP_DATA_DIR also advertises it (mcp_config.json at the standard per-user locations) so a
  // plugin that can't see this environment can find it. A server the plugin launched was *given* its directory
  // by the plugin, so there is nothing to advertise; skipping it keeps a launch from rewriting per-user config.
  const dirs = resolveDirectories(opts.candidatePaths ?? (opts.parentPid !== undefined ? [] : undefined));
  cleanStaleFiles(dirs);
  const recorder = createRecorder(dirs);
  const token = process.env.SP_MCP_HTTP_TOKEN || undefined;
  console.error(
    'Super Productivity MCP (HTTP mode): following the plugin settings in ' +
    `${dirs.base}. Nothing is listening until HTTP is enabled in the plugin's settings.` +
    (token ? ' Bearer token required.' : ''),
  );
  return startHttpSupervisor({
    dirs,
    token,
    parentPid: opts.parentPid,
    createMcpServer: () => createServer(dirs, recorder).server,
  });
}
