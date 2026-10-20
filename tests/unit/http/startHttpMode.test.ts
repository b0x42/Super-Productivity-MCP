import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHttpMode } from '../../../src/server.js';
import { getCandidatePaths } from '../../../src/ipc/directories.js';

describe('startHttpMode (009-FR-010, 009-FR-012)', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sp-mcp-mode-'));
    process.env.SP_MCP_DATA_DIR = base;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.SP_MCP_DATA_DIR;
    delete process.env.SP_MCP_HTTP_TOKEN;
    vi.restoreAllMocks();
    rmSync(base, { recursive: true, force: true });
  });
  const status = () => JSON.parse(readFileSync(join(base, 'http_status.json'), 'utf-8'));

  it('reports itself unmanaged when run by hand', async () => {
    const sup = await startHttpMode({ candidatePaths: [] });
    expect(status().managed).toBeFalsy();
    await sup.stop();
  });

  it('reports itself managed, with the pid it follows, when the plugin launched it', async () => {
    const sup = await startHttpMode({ parentPid: process.pid, candidatePaths: [] });
    expect(status()).toMatchObject({ managed: true, parentPid: process.pid });
    await sup.stop();
  });

  it('takes the token from SP_MCP_HTTP_TOKEN over the config file', async () => {
    process.env.SP_MCP_HTTP_TOKEN = 'env-token-1234567890';
    writeFileSync(join(base, 'http_config.json'), JSON.stringify({ enabled: true, port: 0 + 18899, token: 'f'.repeat(32) }));
    const sup = await startHttpMode({ candidatePaths: [] });
    const post = (auth: string) => fetch('http://127.0.0.1:18899/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: auth },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    }).then((r) => r.status);
    expect(await post('Bearer env-token-1234567890')).toBe(200);
    expect(await post(`Bearer ${'f'.repeat(32)}`)).toBe(401);
    await sup.stop();
  });

  // Starting with SP_MCP_DATA_DIR set advertises the directory in mcp_config.json at the standard per-user
  // locations, so a plugin that cannot see the server's environment can find it. A server the plugin launched
  // was *given* its directory by the plugin, so advertising it would only rewrite per-user config for nothing.
  describe('advertising the data directory', () => {
    let fakeHome: string;
    const realHome = process.env.HOME;
    const realXdg = process.env.XDG_DATA_HOME;
    const advertised = () => getCandidatePaths(undefined, fakeHome).filter((p) => p.startsWith(fakeHome)).map((p) => join(p, 'mcp_config.json'));

    beforeEach(() => {
      fakeHome = mkdtempSync(join(tmpdir(), 'sp-mcp-home-'));
      process.env.HOME = fakeHome;
      delete process.env.XDG_DATA_HOME;
    });
    afterEach(() => {
      process.env.HOME = realHome;
      if (realXdg !== undefined) process.env.XDG_DATA_HOME = realXdg;
      rmSync(fakeHome, { recursive: true, force: true });
    });

    it('a hand-run server advertises it (control: this is the behaviour being skipped below)', async () => {
      const sup = await startHttpMode({ candidatePaths: getCandidatePaths(undefined, fakeHome).filter((p) => p.startsWith(fakeHome)) });
      const files = advertised().filter((f) => existsSync(f));
      expect(files.length).toBeGreaterThan(0);
      expect(JSON.parse(readFileSync(files[0], 'utf-8')).dataDir).toBe(base);
      await sup.stop();
    });

    it('a plugin-launched server does not', async () => {
      const sup = await startHttpMode({ parentPid: process.pid });
      expect(advertised().filter((f) => existsSync(f))).toEqual([]);
      await sup.stop();
    });
  });
});
