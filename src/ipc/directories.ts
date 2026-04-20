import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { McpConfig } from './types.js';

const APP_NAME = 'super-productivity-mcp';

function getCandidatePaths(): string[] {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return [
        join(home, 'Library', 'Containers', 'com.superproductivity.app', 'Data', 'Library', 'Application Support', APP_NAME),
        join(home, 'Library', 'Application Support', APP_NAME),
      ];
    case 'win32':
      return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_NAME)];
    default: // linux
      return [
        join(home, 'snap', 'superproductivity', 'current', '.local', 'share', APP_NAME),
        join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_NAME),
      ];
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function resolveDataDir(): string {
  const envOverride = process.env.SP_MCP_DATA_DIR;
  if (envOverride) {
    ensureDir(envOverride);
    // Write mcp_config.json to standard location so plugin can find it
    const standardPaths = getCandidatePaths();
    for (const p of standardPaths) {
      try {
        ensureDir(p);
        const configPath = join(p, 'mcp_config.json');
        const config: McpConfig = { dataDir: envOverride };
        writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
        break;
      } catch { /* try next */ }
    }
    return envOverride;
  }

  // Check for mcp_config.json in candidate paths
  for (const p of getCandidatePaths()) {
    const configPath = join(p, 'mcp_config.json');
    if (existsSync(configPath)) {
      try {
        const config: McpConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.dataDir && existsSync(config.dataDir)) return config.dataDir;
      } catch { /* ignore invalid config */ }
    }
  }

  // Probe for first writable path
  for (const p of getCandidatePaths()) {
    try {
      ensureDir(p);
      return p;
    } catch { /* try next */ }
  }

  throw new Error('Could not resolve data directory. Set SP_MCP_DATA_DIR environment variable.');
}

export interface ResolvedDirs {
  base: string;
  commands: string;
  responses: string;
}

export function resolveDirectories(): ResolvedDirs {
  const base = resolveDataDir();
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  ensureDir(commands);
  ensureDir(responses);
  return { base, commands, responses };
}
