import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test resolveDataDir by setting SP_MCP_DATA_DIR
describe('directories', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `sp-mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SP_MCP_DATA_DIR;
  });

  it('uses SP_MCP_DATA_DIR when set', async () => {
    const customDir = join(testDir, 'custom');
    process.env.SP_MCP_DATA_DIR = customDir;

    const { resolveDataDir } = await import('../../src/ipc/directories.js');
    const result = resolveDataDir();
    expect(result).toBe(customDir);
    expect(existsSync(customDir)).toBe(true);
  });

  it('resolveDirectories creates command and response subdirs', async () => {
    const customDir = join(testDir, 'dirs-test');
    process.env.SP_MCP_DATA_DIR = customDir;

    const { resolveDirectories } = await import('../../src/ipc/directories.js');
    const dirs = resolveDirectories();
    expect(dirs.base).toBe(customDir);
    expect(dirs.commands).toBe(join(customDir, 'plugin_commands'));
    expect(dirs.responses).toBe(join(customDir, 'plugin_responses'));
    expect(existsSync(dirs.commands)).toBe(true);
    expect(existsSync(dirs.responses)).toBe(true);
  });
});
