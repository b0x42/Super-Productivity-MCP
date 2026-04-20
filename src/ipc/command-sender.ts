import { writeFileSync, readFileSync, unlinkSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, Response } from './types.js';
import { PROTOCOL_VERSION } from './types.js';
import type { ResolvedDirs } from './directories.js';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function generateId(action: string): string {
  return `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanStaleFiles(dirs: ResolvedDirs): void {
  const now = Date.now();
  for (const dir of [dirs.commands, dirs.responses]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > STALE_THRESHOLD_MS) unlinkSync(filePath);
      } catch { /* ignore */ }
    }
  }
}

export async function sendCommand(
  dirs: ResolvedDirs,
  action: string,
  fields: Partial<Omit<Command, 'id' | 'action' | 'protocolVersion' | 'timestamp'>> = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const command: Command = {
    id: generateId(action),
    action,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: Date.now(),
    ...fields,
  };

  const commandPath = join(dirs.commands, `${command.id}.json`);
  writeFileSync(commandPath, JSON.stringify(command, null, 2), { mode: 0o600 });

  const responsePath = join(dirs.responses, `${command.id}_response.json`);
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 200;

  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      try {
        const data = readFileSync(responsePath, 'utf-8');
        const response: Response = JSON.parse(data);
        try { unlinkSync(responsePath); } catch { /* ignore */ }
        return response;
      } catch {
        break;
      }
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  // Timeout — clean up orphaned command
  try { unlinkSync(commandPath); } catch { /* ignore */ }

  return {
    success: false,
    error: 'Super Productivity is not responding. Ensure the app is running with the MCP Bridge plugin enabled.',
    timestamp: Date.now(),
  };
}
