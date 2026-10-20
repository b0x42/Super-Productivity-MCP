import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../../src/server.js';
import { startHttpSupervisor, type HttpSupervisor } from '../../../src/http/supervisor.js';
import { HTTP_CONFIG_FILENAME } from '../../../src/http/config.js';
import { HTTP_STATUS_FILENAME } from '../../../src/http/status.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';

function makeDirs(): ResolvedDirs {
  const base = mkdtempSync(join(tmpdir(), 'sp-mcp-sup-'));
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  mkdirSync(commands);
  mkdirSync(responses);
  return { base, commands, responses };
}

/** Ask the OS for a currently free port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** True when something accepts TCP connections on the port. */
function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    import('node:net').then(({ connect }) => {
      const c = connect({ port, host: '127.0.0.1' });
      c.once('connect', () => { c.destroy(); resolve(true); });
      c.once('error', () => resolve(false));
    });
  });
}

describe('startHttpSupervisor (009-FR-003)', () => {
  let dirs: ResolvedDirs;
  let sup: HttpSupervisor | undefined;
  const logs: string[] = [];
  const writeCfg = (cfg: unknown) => writeFileSync(join(dirs.base, HTTP_CONFIG_FILENAME), JSON.stringify(cfg));

  beforeEach(() => { dirs = makeDirs(); logs.length = 0; });
  afterEach(async () => {
    await sup?.stop();
    sup = undefined;
    rmSync(dirs.base, { recursive: true, force: true });
  });

  const status = () => {
    try { return JSON.parse(readFileSync(join(dirs.base, HTTP_STATUS_FILENAME), 'utf-8')); } catch { return undefined; }
  };
  const start = (extra: { retryMs?: number; token?: string; maxAttempts?: number; heartbeatMs?: number; parentPid?: number } = {}) =>
    startHttpSupervisor({
      dirs,
      token: extra.token,
      maxAttempts: extra.maxAttempts,
      heartbeatMs: extra.heartbeatMs ?? 1_000_000,
      parentPid: extra.parentPid,
      createMcpServer: () => createServer(dirs).server,
      pollMs: 1_000_000, // tests drive tick() by hand
      retryMs: extra.retryMs ?? 1_000_000,
      log: (m) => logs.push(m),
    });

  it('opens nothing when the plugin has never published a config (off by default)', async () => {
    sup = await start();
    expect(sup.status().listening).toBeNull();
  });

  it('opens nothing when the config says disabled', async () => {
    writeCfg({ enabled: false, host: '127.0.0.1', port: await freePort() });
    sup = await start();
    expect(sup.status().listening).toBeNull();
  });

  it('starts listening on the configured host/port once enabled, without a restart', async () => {
    sup = await start();
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    await sup.tick();
    expect(sup.status().listening).toEqual({ host: '127.0.0.1', port });
    expect(await isListening(port)).toBe(true);
  });

  it('starts at launch if the config is already enabled', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    expect(await isListening(port)).toBe(true);
  });

  it('closes the listener when the setting is switched off', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    writeCfg({ enabled: false, host: '127.0.0.1', port });
    await sup.tick();
    expect(sup.status().listening).toBeNull();
    expect(await isListening(port)).toBe(false);
  });

  it('closes the listener when the config file is deleted', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    unlinkSync(join(dirs.base, HTTP_CONFIG_FILENAME));
    await sup.tick();
    expect(await isListening(port)).toBe(false);
  });

  it('rebinds when the port changes', async () => {
    const [a, b] = [await freePort(), await freePort()];
    writeCfg({ enabled: true, host: '127.0.0.1', port: a });
    sup = await start();
    writeCfg({ enabled: true, host: '127.0.0.1', port: b });
    await sup.tick();
    expect(await isListening(a)).toBe(false);
    expect(await isListening(b)).toBe(true);
    expect(sup.status().listening?.port).toBe(b);
  });

  it('leaves the listener alone when the config has not changed', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    const before = sup.status().listening;
    await sup.tick();
    await sup.tick();
    expect(sup.status().listening).toBe(before); // same object ⇒ not rebuilt
    expect(logs.filter((l) => /listening/i.test(l))).toHaveLength(1);
  });

  it('fails closed on an invalid config and reports the problem once, not every tick', async () => {
    writeCfg({ enabled: true, host: 'bad host!', port: 1234 });
    sup = await start();
    await sup.tick();
    await sup.tick();
    expect(sup.status().listening).toBeNull();
    expect(logs.filter((l) => /host/i.test(l))).toHaveLength(1);
  });

  it('closes an open listener when the config becomes invalid', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    writeFileSync(join(dirs.base, HTTP_CONFIG_FILENAME), '{corrupt');
    await sup.tick();
    expect(await isListening(port)).toBe(false);
  });

  it('stop() closes the listener and halts polling', async () => {
    const port = await freePort();
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    sup = await start();
    await sup.stop();
    expect(await isListening(port)).toBe(false);
    writeCfg({ enabled: true, host: '127.0.0.1', port });
    await sup.tick(); // a stopped supervisor must not reopen
    expect(await isListening(port)).toBe(false);
  });

  describe('status file, how the plugin learns what happened (009-FR-010)', () => {
    it("reports 'off' when nothing is configured", async () => {
      sup = await start();
      expect(status()).toMatchObject({ state: 'off', pid: process.pid });
    });

    it("reports 'listening' with the bind", async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start();
      expect(status()).toMatchObject({ state: 'listening', host: '127.0.0.1', port });
      expect(status().error).toBeUndefined();
    });

    it("reports 'invalid-config' with the validation message", async () => {
      writeCfg({ enabled: true, host: 'bad host!', port: 1 });
      sup = await start();
      expect(status()).toMatchObject({ state: 'invalid-config' });
      expect(status().error).toMatch(/host/i);
    });

    it("reports 'off' after being disabled, and 'stopped' after stop()", async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start();
      writeCfg({ enabled: false });
      await sup.tick();
      expect(status().state).toBe('off');
      await sup.stop();
      expect(status().state).toBe('stopped');
    });

    it('does not rewrite the file between heartbeats while nothing changes', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start();
      const before = status().updatedAt;
      await new Promise((r) => setTimeout(r, 15));
      await sup.tick();
      await sup.tick();
      expect(status().updatedAt).toBe(before);
    });

    it('refreshes updatedAt on a heartbeat so the plugin can tell a live server from a dead one', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ heartbeatMs: 20 });
      const before = status().updatedAt;
      await new Promise((r) => setTimeout(r, 40));
      await sup.tick();
      expect(status().updatedAt).toBeGreaterThan(before);
      expect(status().state).toBe('listening');
    });

    it('also heartbeats while off, so an idle server still reads as alive', async () => {
      sup = await start({ heartbeatMs: 20 });
      const before = status().updatedAt;
      await new Promise((r) => setTimeout(r, 40));
      await sup.tick();
      expect(status().updatedAt).toBeGreaterThan(before);
    });

    it('marks itself managed, with the parent it watches, only when launched by the plugin', async () => {
      sup = await start({ parentPid: 4242 });
      expect(status()).toMatchObject({ managed: true, parentPid: 4242 });
      await sup.stop();
      sup = await start();
      expect(status().managed).toBeFalsy();
    });
  });

  describe('a busy port: 3 attempts, then stop trying (009-FR-009)', () => {
    const busy = async () => {
      const blocker = createNetServer();
      await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
      return { blocker, port: (blocker.address() as { port: number }).port };
    };
    const free = (b: ReturnType<typeof createNetServer>) => new Promise<void>((r) => b.close(() => r()));
    const until = async (pred: () => boolean, ms = 3000) => {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
      if (!pred()) throw new Error('timed out waiting');
    };
    const attemptsLogged = () => logs.filter((l) => /cannot listen/i.test(l)).length;

    it("reports 'retrying' (not a failure) after the first miss", async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 1_000_000 });
      expect(status()).toMatchObject({ state: 'retrying', attempt: 1, maxAttempts: 3, port });
      expect(status().error).toMatch(/EADDRINUSE/);
      await free(blocker);
    });

    it('tries exactly 3 times, retryMs apart, then reports bind-failed and stops', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 30 });
      await until(() => status()?.state === 'bind-failed');
      expect(status()).toMatchObject({ state: 'bind-failed', attempt: 3, maxAttempts: 3, host: '127.0.0.1', port });
      // It ends up in a toast, so the OS code must not be stated twice.
      expect(status().error.match(/EADDRINUSE/g)).toHaveLength(1);
      expect(attemptsLogged()).toBe(3);

      // ...and it really has stopped: more time and more ticks change nothing.
      await new Promise((r) => setTimeout(r, 150));
      await sup.tick();
      await sup.tick();
      expect(attemptsLogged()).toBe(3);

      // Even once the port is free, it does not quietly start by itself.
      await free(blocker);
      await sup.tick();
      expect(sup.status().listening).toBeNull();
    });

    it('waits retryMs between attempts rather than hammering', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 1_000_000 });
      await sup.tick();
      await sup.tick();
      expect(attemptsLogged()).toBe(1);
      await free(blocker);
    });

    it('recovers without a failure report if the port frees up between attempts', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 60 });
      await free(blocker);
      await until(() => sup!.status().listening !== null);
      expect(status()).toMatchObject({ state: 'listening', port });
      expect(logs.some((l) => /bind-failed/.test(l))).toBe(false);
    });

    it('tries again from scratch when the user changes a setting', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 20 });
      await until(() => status()?.state === 'bind-failed');
      await free(blocker);

      writeCfg({ enabled: true, host: '127.0.0.1', port, allowedOrigins: ['http://c.example.org'] });
      await sup.tick();
      expect(sup.status().listening).toEqual({ host: '127.0.0.1', port });
    });

    it('tries again from scratch when the user switches the server off and on (the restart gesture)', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 20 });
      await until(() => status()?.state === 'bind-failed');
      await free(blocker);

      writeCfg({ enabled: false, host: '127.0.0.1', port });
      await sup.tick();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      await sup.tick();
      expect(sup.status().listening).toEqual({ host: '127.0.0.1', port });
    });

    it('a second round gets its own 3 attempts', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 20 });
      await until(() => status()?.state === 'bind-failed');
      writeCfg({ enabled: false });
      await sup.tick();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      await sup.tick();
      await until(() => attemptsLogged() === 6);
      await new Promise((r) => setTimeout(r, 100));
      expect(attemptsLogged()).toBe(6);
      await free(blocker);
    });

    it('honours maxAttempts', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 10, maxAttempts: 1 });
      expect(status()).toMatchObject({ state: 'bind-failed', attempt: 1, maxAttempts: 1 });
      await free(blocker);
    });

    it('stop() cancels a pending retry', async () => {
      const { blocker, port } = await busy();
      writeCfg({ enabled: true, host: '127.0.0.1', port });
      sup = await start({ retryMs: 40 });
      await sup.stop();
      await free(blocker);
      await new Promise((r) => setTimeout(r, 120));
      expect(attemptsLogged()).toBe(1);
    });
  });

  describe('everything in the config takes effect live (009-FR-003)', () => {
    const httpStatus = (port: number, headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
      }).then((r) => r.status);

    it('applies a changed allowed-origins list without a port change', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port, allowedOrigins: ['http://other.example.org'] });
      sup = await start();
      expect(await httpStatus(port, { origin: 'http://c.example.org' })).toBe(403);
      writeCfg({ enabled: true, host: '127.0.0.1', port, allowedOrigins: ['http://c.example.org'] });
      await sup.tick();
      expect(await httpStatus(port, { origin: 'http://c.example.org' })).toBe(200);
    });

    it('enforces the token from the config file', async () => {
      const port = await freePort();
      const token = 't'.repeat(32);
      writeCfg({ enabled: true, host: '127.0.0.1', port, token });
      sup = await start();
      expect(await httpStatus(port, {})).toBe(401);
      expect(await httpStatus(port, { authorization: `Bearer ${token}` })).toBe(200);
    });

    it('picks up a rotated token', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port, token: 'a'.repeat(32) });
      sup = await start();
      writeCfg({ enabled: true, host: '127.0.0.1', port, token: 'b'.repeat(32) });
      await sup.tick();
      expect(await httpStatus(port, { authorization: `Bearer ${'a'.repeat(32)}` })).toBe(401);
      expect(await httpStatus(port, { authorization: `Bearer ${'b'.repeat(32)}` })).toBe(200);
    });

    it('lets SP_MCP_HTTP_TOKEN (passed as opts.token) take precedence over the file', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port, token: 'f'.repeat(32) });
      sup = await start({ token: 'env-token-1234567890' });
      expect(await httpStatus(port, { authorization: `Bearer ${'f'.repeat(32)}` })).toBe(401);
      expect(await httpStatus(port, { authorization: 'Bearer env-token-1234567890' })).toBe(200);
    });

    it('never writes the token to the log', async () => {
      const port = await freePort();
      writeCfg({ enabled: true, host: '127.0.0.1', port, token: 'secretsecretsecretsecret' });
      sup = await start();
      await sup.tick();
      expect(logs.join('\n')).not.toContain('secretsecretsecretsecret');
    });
  });
});
