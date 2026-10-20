import { vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modeFor, runLikeSp, type ScriptMode } from './spExecutor.js';

export const SP_PID = 111;

export function makeEmbedded(source: string | Buffer = 'console.log("fake server");\n'): { sha256: string; gzB64: string; source: string } {
  const buf = Buffer.from(source);
  return {
    source: buf.toString('utf-8'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    gzB64: gzipSync(buf).toString('base64'),
  };
}

/** What the plugin's settings dialog would have saved. */
export const saved = (config: unknown) => JSON.stringify({ config, savedAt: 1 });

export interface Harness {
  base: string;
  commandDir: string;
  api: Record<string, ReturnType<typeof vi.fn>>;
  secrets: Map<string, string>;
  spawns: Array<{ script: string; args: unknown[] }>;
  kills: number[];
  modes: Array<{ mode: ScriptMode; script: string }>;
  published(): any;
  writeStatus(status: object): void;
  cleanup(): void;
}

export function makeHarness(): Harness {
  const base = mkdtempSync(join(tmpdir(), 'sp-mcp-mgr-'));
  const commandDir = join(base, 'plugin_commands');
  mkdirSync(commandDir);
  const secrets = new Map<string, string>();
  const spawns: Harness['spawns'] = [];
  const kills: number[] = [];
  const modes: Harness['modes'] = [];
  let nextPid = 4000;

  const api = {
    loadSyncedData: vi.fn().mockResolvedValue(null),
    showSnack: vi.fn(),
    getSecret: vi.fn(async (k: string) => secrets.get(k) ?? null),
    setSecret: vi.fn(async (k: string, v: string) => { secrets.set(k, v); }),
    deleteSecret: vi.fn(async (k: string) => { secrets.delete(k); }),
    openDialog: vi.fn().mockResolvedValue(undefined),
    registerMenuEntry: vi.fn(),
    executeNodeScript: vi.fn(async ({ script, args }: { script: string; args: unknown[] }) => {
      modes.push({ mode: modeFor(script), script });
      // The two scripts that would really launch / signal a process are recorded, not executed.
      if (script.includes('detached: true')) {
        spawns.push({ script, args });
        return { success: true, result: { success: true, pid: nextPid++, parentPid: SP_PID } };
      }
      if (script.includes('process.kill(')) {
        kills.push(args[0] as number);
        return { success: true, result: { success: true } };
      }
      if (script.includes('process.ppid')) {
        return { success: true, result: { success: true, ppid: SP_PID } };
      }
      return { success: true, result: await runLikeSp(script, args) };
    }),
  };
  (globalThis as { PluginAPI?: unknown }).PluginAPI = api;

  return {
    base, commandDir, api, secrets, spawns, kills, modes,
    published: () => {
      const p = join(base, 'http_config.json');
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : undefined;
    },
    writeStatus: (status) =>
      writeFileSync(join(base, 'http_status.json'), JSON.stringify({ pid: 4000, updatedAt: Date.now(), ...status })),
    cleanup: () => {
      rmSync(base, { recursive: true, force: true });
      delete (globalThis as { PluginAPI?: unknown }).PluginAPI;
    },
  };
}
