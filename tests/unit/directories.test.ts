import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir, platform } from 'node:os';

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
    const result = resolveDataDir([]);
    expect(result).toBe(customDir);
    expect(existsSync(customDir)).toBe(true);
  });

  it('resolveDirectories creates command and response subdirs', async () => {
    const customDir = join(testDir, 'dirs-test');
    process.env.SP_MCP_DATA_DIR = customDir;

    const { resolveDirectories } = await import('../../src/ipc/directories.js');
    const dirs = resolveDirectories([]);
    expect(dirs.base).toBe(customDir);
    expect(dirs.commands).toBe(join(customDir, 'plugin_commands'));
    expect(dirs.responses).toBe(join(customDir, 'plugin_responses'));
    expect(existsSync(dirs.commands)).toBe(true);
    expect(existsSync(dirs.responses)).toBe(true);
  });

  it('prefers the native macOS data directory before the App Store fallback', async () => {
    const { getCandidatePaths } = await import('../../src/ipc/directories.js');
    const paths = getCandidatePaths('darwin', '/Users/test');

    expect(paths).toEqual([
      '/Users/test/Library/Application Support/super-productivity-mcp',
      '/Users/test/Library/Containers/com.super-productivity.app/Data/Library/Application Support/super-productivity-mcp',
    ]);
  });

  it('publishes an explicit override at the canonical discovery path', async () => {
    const customDir = join(testDir, 'custom');
    const canonicalDir = join(testDir, 'canonical');
    process.env.SP_MCP_DATA_DIR = customDir;

    const { resolveDataDir } = await import('../../src/ipc/directories.js');
    const result = resolveDataDir([canonicalDir]);

    expect(result).toBe(customDir);
    expect(JSON.parse(readFileSync(join(canonicalDir, 'mcp_config.json'), 'utf8'))).toEqual({
      dataDir: customDir,
    });
  });

  it('publishes an explicit override to native and sandbox discovery paths', async () => {
    const customDir = join(testDir, 'custom');
    const nativeDir = join(testDir, 'native');
    const sandboxDir = join(testDir, 'sandbox');
    process.env.SP_MCP_DATA_DIR = customDir;

    const { resolveDataDir } = await import('../../src/ipc/directories.js');
    expect(resolveDataDir([nativeDir, sandboxDir])).toBe(customDir);

    for (const candidate of [nativeDir, sandboxDir]) {
      expect(JSON.parse(readFileSync(join(candidate, 'mcp_config.json'), 'utf8'))).toEqual({
        dataDir: customDir,
      });
    }
  });

  it('linux candidates include /tmp fallback', async () => {
    if (platform() !== 'linux') return;
    const { getCandidatePaths } = await import('../../src/ipc/directories.js');
    const paths = getCandidatePaths();
    expect(paths[paths.length - 1]).toBe('/tmp/super-productivity-mcp');
  });

  it('linux candidates prefer Flatpak app data before /tmp fallback', async () => {
    if (platform() !== 'linux') return;
    const { getCandidatePaths } = await import('../../src/ipc/directories.js');
    const paths = getCandidatePaths();
    expect(paths[0]).toBe(join(
      homedir(),
      '.var',
      'app',
      'com.super_productivity.SuperProductivity',
      'data',
      'super-productivity-mcp',
    ));
    expect(paths.indexOf('/tmp/super-productivity-mcp')).toBeGreaterThan(0);
  });
});
