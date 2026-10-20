import { createRequire } from 'node:module';
import * as vm from 'node:vm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const nodeRequire = createRequire(import.meta.url);

/**
 * Faithful copy of how Super Productivity's electron/plugin-node-executor.ts runs
 * PluginAPI.executeNodeScript, so tests catch scripts that only work by accident:
 *
 *  - a script matching `dangerousPatterns` runs in a real (spawned) Node process with full `require`;
 *  - any other script runs in a vm sandbox that has only fs/path/os, no `process`, no `console` beyond log/error.
 *
 * A script that uses `process.kill` but contains none of the trigger words silently throws
 * "process is not defined" inside SP. Running every script through this makes that a red test.
 */
export const SP_DANGEROUS_PATTERNS =
  /require\s*\(\s*['"`](?!fs|path|os)[^'"]+['"`]\s*\)|child_process|exec|spawn|eval|Function|process\.exit/;

export type ScriptMode = 'vm' | 'spawn';

export function modeFor(script: string): ScriptMode {
  return SP_DANGEROUS_PATTERNS.test(script) ? 'spawn' : 'vm';
}

export async function runLikeSp(script: string, args: unknown[] = []): Promise<unknown> {
  if (modeFor(script) === 'spawn') {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>;
    return new AsyncFunction('require', 'args', script)(nodeRequire, args);
  }
  const sandbox: Record<string, unknown> = {
    require: (m: string) => {
      if (m === 'fs') return fs;
      if (m === 'path') return path;
      if (m === 'os') return os;
      throw new Error(`Module '${m}' is not allowed`);
    },
    console: { log: () => {}, error: () => {} },
    JSON,
    args,
    __result: undefined,
  };
  const ctx = vm.createContext(sandbox);
  await vm.runInContext(
    `(async function() { const result = await (async function() { ${script} })(); __result = result; })()`,
    ctx,
    { timeout: 5000 },
  );
  return sandbox.__result;
}

/**
 * The same replica, but the heavyweight mode really starts a child process the way SP does
 * (`process.execPath -e <script>` with an environment stripped to NODE_ENV and ELECTRON_RUN_AS_NODE,
 * no PATH, no HOME), so a script that leans on anything inherited from the test process fails here.
 * For integration tests; unit tests use runLikeSp, which is faster and runs everything in-process.
 */
export async function runLikeSpIsolated(script: string, args: unknown[] = [], timeoutMs = 30_000): Promise<unknown> {
  if (modeFor(script) === 'vm') return runLikeSp(script, args);
  const { spawn } = await import('node:child_process');
  const wrapped =
    `'use strict'; (async function() { const args = ${JSON.stringify(args)}; ` +
    `try { const result = await (async function() { ${script} })(); console.log(JSON.stringify({ __result: result })); } ` +
    `catch (error) { console.error(JSON.stringify({ __error: error.message || String(error) })); process.exit(1); } })();`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '-e', wrapped], {
      env: { NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Script execution timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Failed to execute script: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (out) {
          const parsed = JSON.parse(out.trim());
          if (parsed.__error) reject(new Error(parsed.__error)); else resolve(parsed.__result);
        } else if (code !== 0) reject(new Error(err || `Process exited with code ${code}`));
        else resolve(undefined);
      } catch (e) { reject(new Error(`Failed to parse output: ${e}`)); }
    });
  });
}

/** `PluginAPI.executeNodeScript` as SP provides it, for integration tests. */
export async function executeNodeScriptLikeSp(req: { script: string; args?: unknown[]; timeout?: number }): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    return { success: true, result: await runLikeSpIsolated(req.script, req.args ?? [], req.timeout) };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
