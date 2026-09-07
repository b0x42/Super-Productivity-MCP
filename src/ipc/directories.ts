import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { McpConfig } from './types.js';

const APP_NAME = 'super-productivity-mcp';
const TMP_ROOT = '/tmp';

export function getCandidatePaths(
  platformName: NodeJS.Platform = platform(),
  home = homedir(),
): string[] {
  switch (platformName) {
    case 'darwin':
      // Native macOS builds use ~/Library/Application Support. The container
      // path is retained as a fallback for Mac App Store installations. The
      // native path must come first so a stale Store container cannot shadow a
      // working native installation.
      return [
        join(home, 'Library', 'Application Support', APP_NAME),
        join(home, 'Library', 'Containers', 'com.super-productivity.app', 'Data', 'Library', 'Application Support', APP_NAME),
      ];
    case 'win32':
      return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_NAME)];
    default: // linux
      return [
        join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'data', APP_NAME),
        join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'config', APP_NAME),
        join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_NAME),
        join(home, 'snap', 'superproductivity', 'common', '.local', 'share', APP_NAME),
        join(home, 'snap', 'superproductivity', 'current', '.local', 'share', APP_NAME),
        join('/tmp', APP_NAME), // last-resort: world-writable dir, but mode 0o700 restricts access
      ];
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function ensureWritableDir(dir: string): void {
  ensureDir(dir);
  const testPath = join(dir, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(testPath, 'ok', { mode: 0o600 });
  unlinkSync(testPath);
}

function ensureIpcDirs(base: string): void {
  ensureWritableDir(base);
  ensureWritableDir(join(base, 'plugin_commands'));
  ensureWritableDir(join(base, 'plugin_responses'));
}

function isTmpDataDir(dir: string): boolean {
  return dir === TMP_ROOT || dir.startsWith(`${TMP_ROOT}/`);
}

function publishConfig(dataDir: string, candidatePaths: string[]): void {
  // The plugin cannot inherit the MCP client's environment. Publish the
  // selected directory at every writable canonical location so native and
  // App Store sandbox installations can discover the same explicit override.
  for (const configRoot of candidatePaths) {
    try {
      ensureWritableDir(configRoot);
      const configPath = join(configRoot, 'mcp_config.json');
      const config: McpConfig = { dataDir };
      writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch {
      // The configured data directory itself remains usable even if one
      // discovery marker cannot be written; continue with the next candidate.
    }
  }
}

export function resolveDataDir(candidatePaths = getCandidatePaths()): string {
  const envOverride = process.env.SP_MCP_DATA_DIR;
  if (envOverride) {
    ensureIpcDirs(envOverride);
    publishConfig(envOverride, candidatePaths);
    return envOverride;
  }

  // Check for mcp_config.json in candidate paths
  for (const p of candidatePaths) {
    try {
      const configPath = join(p, 'mcp_config.json');
      if (existsSync(configPath)) {
        const config: McpConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.dataDir && existsSync(config.dataDir) && !isTmpDataDir(config.dataDir)) {
          ensureIpcDirs(config.dataDir);
          return config.dataDir;
        }
      }
    } catch { /* ignore inaccessible or invalid config */ }
  }

  // Probe for first writable path
  for (const p of candidatePaths) {
    try {
      ensureIpcDirs(p);
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

export function resolveDirectories(candidatePaths = getCandidatePaths()): ResolvedDirs {
  const base = resolveDataDir(candidatePaths);
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  ensureWritableDir(commands);
  ensureWritableDir(responses);
  return { base, commands, responses };
}
