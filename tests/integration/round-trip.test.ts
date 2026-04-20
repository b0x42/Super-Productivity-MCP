import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sendCommand, cleanStaleFiles } from '../../src/ipc/command-sender.js';
import type { ResolvedDirs } from '../../src/ipc/directories.js';
import type { Response } from '../../src/ipc/types.js';

function makeDirs(): ResolvedDirs {
  const base = join(tmpdir(), `sp-mcp-int-${Date.now()}`);
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  mkdirSync(commands, { recursive: true });
  mkdirSync(responses, { recursive: true });
  return { base, commands, responses };
}

// Simulate plugin: watch for command files, execute, write response
function simulatePlugin(dirs: ResolvedDirs, handler: (cmd: any) => any) {
  const interval = setInterval(() => {
    if (!existsSync(dirs.commands)) return;
    for (const file of readdirSync(dirs.commands).filter(f => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(require('fs').readFileSync(join(dirs.commands, file), 'utf-8'));
        const result = handler(data);
        const response: Response = { success: true, result, timestamp: Date.now() };
        writeFileSync(join(dirs.responses, `${data.id}_response.json`), JSON.stringify(response));
        require('fs').unlinkSync(join(dirs.commands, file));
      } catch (e) { /* skip */ }
    }
  }, 100);
  return () => clearInterval(interval);
}

describe('integration: round-trip', () => {
  it('create_task → plugin processes → server gets result', async () => {
    const dirs = makeDirs();
    const stop = simulatePlugin(dirs, (cmd) => {
      if (cmd.action === 'addTask') return 'new-task-id-123';
      return null;
    });

    const res = await sendCommand(dirs, 'addTask', {
      data: { title: 'Integration test task', notes: '', tagIds: [] },
    }, 5000);

    stop();
    expect(res.success).toBe(true);
    expect(res.result).toBe('new-task-id-123');
    // Command file should be cleaned up by simulated plugin
    expect(readdirSync(dirs.commands).filter(f => f.endsWith('.json'))).toHaveLength(0);
    // Response file should be cleaned up by server
    expect(readdirSync(dirs.responses).filter(f => f.endsWith('.json'))).toHaveLength(0);
  });

  it('getTasks → plugin returns tasks → server receives array', async () => {
    const dirs = makeDirs();
    const mockTasks = [
      { id: '1', title: 'Task A', isDone: false, projectId: null, tagIds: [] },
      { id: '2', title: 'Task B', isDone: true, projectId: 'p1', tagIds: ['t1'] },
    ];
    const stop = simulatePlugin(dirs, (cmd) => {
      if (cmd.action === 'getTasks') return mockTasks;
      return null;
    });

    const res = await sendCommand(dirs, 'getTasks', { filters: {} }, 5000);
    stop();
    expect(res.success).toBe(true);
    expect(res.result).toEqual(mockTasks);
  });

  it('ping → plugin responds with version info', async () => {
    const dirs = makeDirs();
    const stop = simulatePlugin(dirs, (cmd) => {
      if (cmd.action === 'ping') return { pong: true, pluginVersion: '1.0.0', protocolVersion: 1 };
      return null;
    });

    const res = await sendCommand(dirs, 'ping', {}, 5000);
    stop();
    expect(res.success).toBe(true);
    const r = res.result as any;
    expect(r.pong).toBe(true);
    expect(r.protocolVersion).toBe(1);
  });

  it('timeout → returns clear error and cleans up command', async () => {
    const dirs = makeDirs();
    // No plugin running
    const res = await sendCommand(dirs, 'ping', {}, 1000);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not responding');
    expect(readdirSync(dirs.commands).filter(f => f.endsWith('.json'))).toHaveLength(0);
  });

  it('stale cleanup removes old files', () => {
    const dirs = makeDirs();
    const stale = join(dirs.commands, 'old_cmd.json');
    writeFileSync(stale, '{}');
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    require('fs').utimesSync(stale, tenMinAgo, tenMinAgo);

    cleanStaleFiles(dirs);
    expect(existsSync(stale)).toBe(false);
  });
});
