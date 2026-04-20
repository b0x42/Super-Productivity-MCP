import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sendCommand, cleanStaleFiles } from '../../src/ipc/command-sender.js';
import type { ResolvedDirs } from '../../src/ipc/directories.js';
import type { Response } from '../../src/ipc/types.js';

function makeDirs(): ResolvedDirs {
  const base = join(tmpdir(), `sp-mcp-cmd-test-${Date.now()}`);
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  mkdirSync(commands, { recursive: true });
  mkdirSync(responses, { recursive: true });
  return { base, commands, responses };
}

describe('sendCommand', () => {
  it('writes a command file and reads a response', async () => {
    const dirs = makeDirs();

    // Simulate plugin: watch for command, write response
    const promise = sendCommand(dirs, 'ping', {}, 5000);

    // Wait for command file to appear
    await new Promise(r => setTimeout(r, 300));
    const files = readdirSync(dirs.commands).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(1);

    // Write mock response
    const cmdId = files[0].replace('.json', '');
    const response: Response = { success: true, result: { pong: true }, timestamp: Date.now() };
    writeFileSync(join(dirs.responses, `${cmdId}_response.json`), JSON.stringify(response));

    const result = await promise;
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).pong).toBe(true);
  });

  it('returns timeout error when no response', async () => {
    const dirs = makeDirs();
    const result = await sendCommand(dirs, 'ping', {}, 1000);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not responding');
    // Orphaned command should be cleaned up
    const remaining = readdirSync(dirs.commands).filter(f => f.endsWith('.json'));
    expect(remaining.length).toBe(0);
  });
});

describe('cleanStaleFiles', () => {
  it('removes files older than 5 minutes', () => {
    const dirs = makeDirs();
    const stalePath = join(dirs.commands, 'stale_cmd.json');
    writeFileSync(stalePath, '{}');
    // Manually set mtime to 10 minutes ago
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const { utimesSync } = require('node:fs');
    utimesSync(stalePath, tenMinAgo, tenMinAgo);

    cleanStaleFiles(dirs);
    expect(existsSync(stalePath)).toBe(false);
  });

  it('keeps recent files', () => {
    const dirs = makeDirs();
    const recentPath = join(dirs.commands, 'recent_cmd.json');
    writeFileSync(recentPath, '{}');

    cleanStaleFiles(dirs);
    expect(existsSync(recentPath)).toBe(true);
  });
});
