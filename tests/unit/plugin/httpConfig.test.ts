import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  normalizeHttpSettings,
  syncHttpConfig,
  showTokenDialog,
  __setCommandDirForTest,
} from '../../../plugin/plugin.js';
import { parseHttpConfig } from '../../../src/http/config.js';

const nodeRequire = createRequire(import.meta.url);

interface Stub {
  loadSyncedData: ReturnType<typeof vi.fn>;
  showSnack: ReturnType<typeof vi.fn>;
  executeNodeScript: ReturnType<typeof vi.fn>;
  getSecret: ReturnType<typeof vi.fn>;
  setSecret: ReturnType<typeof vi.fn>;
  deleteSecret: ReturnType<typeof vi.fn>;
  openDialog: ReturnType<typeof vi.fn>;
  registerMenuEntry: ReturnType<typeof vi.fn>;
}

/** What SP's settings dialog persists: the whole blob is { config, savedAt }. */
const saved = (config: unknown) => JSON.stringify({ config, savedAt: 1 });

describe('normalizeHttpSettings (009-FR-001, 009-FR-002)', () => {
  it('is disabled when nothing has ever been saved (off by default)', () => {
    for (const nothing of [null, undefined, '']) {
      expect(normalizeHttpSettings(nothing as never).config).toEqual({ enabled: false, host: '127.0.0.1', port: 8765, allowedHosts: [], allowedOrigins: [] });
    }
  });

  it('is disabled when the blob is not JSON or has no config', () => {
    expect(normalizeHttpSettings('{nope').config.enabled).toBe(false);
    expect(normalizeHttpSettings('42').config.enabled).toBe(false);
    expect(normalizeHttpSettings(JSON.stringify({ savedAt: 1 })).config.enabled).toBe(false);
  });

  it('reads the settings dialog fields', () => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpHost: '0.0.0.0', httpPort: 9100 }));
    expect(r.error).toBeUndefined();
    expect(r.config).toEqual({ enabled: true, host: '0.0.0.0', port: 9100, allowedHosts: [], allowedOrigins: [] });
  });

  it('applies host/port defaults when only the toggle was set', () => {
    expect(normalizeHttpSettings(saved({ httpEnabled: true })).config).toEqual({ enabled: true, host: '127.0.0.1', port: 8765, allowedHosts: [], allowedOrigins: [] });
  });

  it('only a literal true enables', () => {
    for (const v of ['true', 1, 'on']) {
      expect(normalizeHttpSettings(saved({ httpEnabled: v })).config.enabled).toBe(false);
    }
  });

  it.each([[0], [70000], [1.5], ['80'], [-5]])('rejects port %j: disabled + error', (httpPort) => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpPort }));
    expect(r.config.enabled).toBe(false);
    expect(r.error).toMatch(/port/i);
  });

  it.each([[''], ['has space'], ['http://x'], ['a/b'], [5]])('rejects host %j: disabled + error', (httpHost) => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpHost }));
    expect(r.config.enabled).toBe(false);
    expect(r.error).toMatch(/address|host/i);
  });

  // The server re-validates everything it reads, so the two sides must agree on
  // what a sane config means. Anything the plugin publishes must round-trip.
  it.each([
    [{ httpEnabled: true, httpHost: '127.0.0.1', httpPort: 8765 }],
    [{ httpEnabled: true, httpHost: '0.0.0.0', httpPort: 1 }],
    [{ httpEnabled: true, httpHost: '::1', httpPort: 65535 }],
    [{ httpEnabled: true, httpHost: 'localhost', httpPort: 3000 }],
    [{ httpEnabled: true, httpHost: 'my-box.lan', httpPort: 3000 }],
    [{ httpEnabled: false, httpHost: '127.0.0.1', httpPort: 3000 }],
    [{ httpEnabled: true, httpHost: ' 127.0.0.1 ', httpPort: 3000 }],
    [{ httpEnabled: true, httpHost: 'bad host', httpPort: 3000 }],
    [{ httpEnabled: true, httpHost: '127.0.0.1', httpPort: 0 }],
    [{ httpEnabled: true, httpAllowedHosts: 'Console.Example.org, 10.0.0.5:8765\n[::1]:80  console.example.org' }],
    [{ httpEnabled: true, httpAllowedOrigins: 'http://console.example.org HTTPS://X.org:443/, http://localhost:5173' }],
    [{ httpEnabled: true, httpAllowedHosts: 'a b/c' }],
    [{ httpEnabled: true, httpAllowedOrigins: 'console.example.org' }],
    [{ httpEnabled: true, httpAllowedHosts: '*.example.org' }],
    [{ httpEnabled: true, httpAllowedHosts: 'fd00::1' }],
    [{ httpEnabled: true, httpAllowedOrigins: 'http://x.org/path' }],
    [{ httpEnabled: false, httpAllowedHosts: 'junk junk/' }],
  ])('publishes what the server parses identically: %j', (cfg) => {
    const { config } = normalizeHttpSettings(saved(cfg));
    expect(parseHttpConfig(config)).toEqual({ config });
  });
});

describe('normalizeHttpSettings: access-control fields (009-FR-006, 009-FR-007)', () => {
  it('splits allowed hosts on commas and whitespace and normalizes them', () => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpAllowedHosts: 'A.example.org,\n b.example.org:9 ' }));
    expect(r.config.allowedHosts).toEqual(['a.example.org', 'b.example.org:9']);
  });

  it('normalizes allowed origins to full origins', () => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpAllowedOrigins: 'HTTPS://Console.Example.org:443/ http://localhost:5173' }));
    expect(r.config.allowedOrigins).toEqual(['https://console.example.org', 'http://localhost:5173']);
  });

  it('an invalid allowed host keeps the server off and says which one', () => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpAllowedHosts: 'ok.example.org, bad_host/x' }));
    expect(r.config.enabled).toBe(false);
    expect(r.error).toMatch(/allowed host/i);
    expect(r.error).toContain('bad');
  });

  it('an invalid allowed origin keeps the server off, and tells the user what a valid one looks like', () => {
    const r = normalizeHttpSettings(saved({ httpEnabled: true, httpAllowedOrigins: 'console.example.org' }));
    expect(r.config.enabled).toBe(false);
    expect(r.error).toMatch(/allowed origin/i);
    expect(r.error).toContain('http://');
  });

  it('does not require a token unless switched on (a token is best practice, not the default)', () => {
    expect(normalizeHttpSettings(saved({ httpEnabled: true })).requireToken).toBe(false);
    expect(normalizeHttpSettings(saved({ httpEnabled: true, httpRequireToken: true })).requireToken).toBe(true);
    expect(normalizeHttpSettings(saved({ httpEnabled: true, httpRequireToken: 'yes' })).requireToken).toBe(false);
    expect(normalizeHttpSettings(null as never).requireToken).toBe(false);
  });

  it('manages the server process unless switched off', () => {
    expect(normalizeHttpSettings(saved({ httpEnabled: true })).manage).toBe(true);
    expect(normalizeHttpSettings(saved({ httpEnabled: true, httpManageProcess: false })).manage).toBe(false);
    expect(normalizeHttpSettings(saved({ httpEnabled: true, httpManageProcess: 'no' })).manage).toBe(true);
  });
});

describe('syncHttpConfig', () => {
  let base: string;
  let api: Stub;
  let secrets: Map<string, string>;

  const published = () => {
    const p = join(base, 'http_config.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : undefined;
  };

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sp-mcp-plugin-http-'));
    mkdirSync(join(base, 'plugin_commands'));
    secrets = new Map();
    api = {
      loadSyncedData: vi.fn().mockResolvedValue(null),
      showSnack: vi.fn(),
      getSecret: vi.fn(async (k: string) => secrets.get(k) ?? null),
      setSecret: vi.fn(async (k: string, v: string) => { secrets.set(k, v); }),
      deleteSecret: vi.fn(async (k: string) => { secrets.delete(k); }),
      openDialog: vi.fn().mockResolvedValue(undefined),
      registerMenuEntry: vi.fn(),
      // Run the real node script against the real fs, like SP's main process would.
      executeNodeScript: vi.fn(async ({ script, args }: { script: string; args: unknown[] }) => {
        const fn = new Function('require', 'args', script);
        return { success: true, result: fn(nodeRequire, args) };
      }),
    };
    (globalThis as { PluginAPI?: unknown }).PluginAPI = api;
    __setCommandDirForTest(join(base, 'plugin_commands'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    delete (globalThis as { PluginAPI?: unknown }).PluginAPI;
  });

  it('publishes a disabled config on first run so the server never sees stale state', async () => {
    await syncHttpConfig();
    expect(published()).toEqual({ enabled: false, host: '127.0.0.1', port: 8765, allowedHosts: [], allowedOrigins: [] });
  });

  it('publishes the saved settings next to the IPC dirs, not inside them', async () => {
    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpHost: '127.0.0.1', httpPort: 9001, httpRequireToken: false }));
    await syncHttpConfig();
    expect(published()).toEqual({ enabled: true, host: '127.0.0.1', port: 9001, allowedHosts: [], allowedOrigins: [] });
    expect(readdirSync(join(base, 'plugin_commands'))).toEqual([]);
  });

  it('writes the file owner-only and leaves no temp file behind', async () => {
    await syncHttpConfig();
    expect(statSync(join(base, 'http_config.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(base).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('rewrites only when the settings change', async () => {
    const publishes = () => api.executeNodeScript.mock.calls.filter((c) => (c[0].args as unknown[]).includes('http_config.json')).length;
    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001, httpRequireToken: false }));
    await syncHttpConfig();
    await syncHttpConfig();
    await syncHttpConfig();
    expect(publishes()).toBe(1);

    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9002, httpRequireToken: false }));
    await syncHttpConfig();
    expect(publishes()).toBe(2);
    expect(published().port).toBe(9002);
  });

  it('publishes disabled and tells the user once when the settings are invalid', async () => {
    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 99999 }));
    await syncHttpConfig();
    await syncHttpConfig();
    expect(published().enabled).toBe(false);
    expect(api.showSnack).toHaveBeenCalledTimes(1);
    expect(api.showSnack.mock.calls[0][0]).toMatchObject({ type: 'ERROR' });
  });

  it('points the user at --http when HTTP is switched on', async () => {
    await syncHttpConfig(); // startup: off
    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpRequireToken: false }));
    await syncHttpConfig();
    expect(api.showSnack).toHaveBeenCalledTimes(1);
    expect(api.showSnack.mock.calls[0][0].msg).toContain('--http');
  });

  it('stays silent at startup even when already enabled', async () => {
    api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpRequireToken: false }));
    await syncHttpConfig();
    expect(api.showSnack).not.toHaveBeenCalled();
  });

  it('retries on the next call if the write failed', async () => {
    const real = api.executeNodeScript.getMockImplementation()!;
    api.executeNodeScript.mockImplementationOnce(async (req: { script: string; args: unknown[] }) =>
      real(req)); // the first call is the control-file check; let it through
    api.executeNodeScript.mockImplementationOnce(async () => ({ success: false, error: 'EACCES' }));
    await syncHttpConfig();
    expect(published()).toBeUndefined();
    await syncHttpConfig();
    expect(published()).toBeDefined();
  });

  it('never throws into the poll loop when SP cannot supply the settings', async () => {
    api.loadSyncedData.mockRejectedValue(new Error('bridge down'));
    await expect(syncHttpConfig()).resolves.toBeUndefined();
  });

  it('does nothing before the data directory is known', async () => {
    __setCommandDirForTest(null);
    await syncHttpConfig();
    expect(api.executeNodeScript).not.toHaveBeenCalled();
  });

  describe('bearer token, kept in SP local-only secret storage and never in synced settings (009-FR-012)', () => {
    const enable = (extra: object = {}) =>
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001, httpRequireToken: true, ...extra }));

    it('does not create a token unless asked to (off by default)', async () => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001 }));
      await syncHttpConfig();
      expect(api.setSecret).not.toHaveBeenCalled();
      expect(published().token).toBeUndefined();
      expect(published().enabled).toBe(true);
    });

    it('generates a strong token on first enable, keeps it in secret storage, and publishes it', async () => {
      enable();
      await syncHttpConfig();
      const token = secrets.get('httpToken');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(published().token).toBe(token);
      expect(published().enabled).toBe(true);
    });

    it('reuses the stored token across restarts instead of minting a new one', async () => {
      secrets.set('httpToken', 'e'.repeat(64));
      enable();
      await syncHttpConfig();
      expect(published().token).toBe('e'.repeat(64));
      expect(api.setSecret).not.toHaveBeenCalled();
    });

    it('shows the new token once, in a dialog, when it is first created', async () => {
      enable();
      await syncHttpConfig();
      await syncHttpConfig();
      expect(api.openDialog).toHaveBeenCalledTimes(1);
      expect(api.openDialog.mock.calls[0][0].htmlContent).toContain(secrets.get('httpToken'));
    });

    it('does not create or publish a token when the option is switched off', async () => {
      enable({ httpRequireToken: false });
      await syncHttpConfig();
      expect(api.setSecret).not.toHaveBeenCalled();
      expect(published().token).toBeUndefined();
      expect(published().enabled).toBe(true);
    });

    it('does not create a token while HTTP itself is off', async () => {
      await syncHttpConfig();
      expect(api.setSecret).not.toHaveBeenCalled();
      expect(published().token).toBeUndefined();
    });

    it('fails closed when secret storage is unavailable: stays off and says why', async () => {
      api.getSecret.mockRejectedValue(new Error('not supported'));
      enable();
      await syncHttpConfig();
      expect(published().enabled).toBe(false);
      expect(published().token).toBeUndefined();
      expect(api.showSnack.mock.calls[0][0]).toMatchObject({ type: 'ERROR' });
      expect(api.showSnack.mock.calls[0][0].msg).toMatch(/token/i);
    });

    it('fails closed when SP is too old to have secret storage at all', async () => {
      delete (api as Partial<Stub>).getSecret;
      enable();
      await syncHttpConfig();
      expect(published().enabled).toBe(false);
    });

    it('keeps the token out of toasts and console output', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      enable({ httpAllowedHosts: 'bad host/' });
      await syncHttpConfig();
      enable();
      await syncHttpConfig();
      const token = secrets.get('httpToken')!;
      const everything = JSON.stringify([api.showSnack.mock.calls, spy.mock.calls, spyErr.mock.calls]);
      expect(everything).not.toContain(token);
      spy.mockRestore();
      spyErr.mockRestore();
    });

    it('the published file with a token is still owner-only', async () => {
      enable();
      await syncHttpConfig();
      expect(statSync(join(base, 'http_config.json')).mode & 0o777).toBe(0o600);
    });

    it('never writes to SP synced storage, where a token would reach backups and other devices', () => {
      const source = readFileSync(fileURLToPath(new URL('../../../plugin/plugin.js', import.meta.url)), 'utf-8');
      expect(source).not.toMatch(/persistDataSynced\s*\(/);
    });
  });

  describe('best-practice nudge for unprotected network binds (009-FR-013)', () => {
    const warnings = () => api.showSnack.mock.calls.filter((c) => c[0].type === 'WARNING');

    it('warns once when binding beyond loopback without a token', async () => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpHost: '0.0.0.0' }));
      await syncHttpConfig();
      await syncHttpConfig();
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0][0].msg).toMatch(/token/i);
      expect(warnings()[0][0].msg).toMatch(/best practice|recommended/i);
    });

    it.each([['127.0.0.1'], ['localhost'], ['::1']])('stays quiet on loopback (%s) — token or not', async (httpHost) => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpHost }));
      await syncHttpConfig();
      expect(warnings()).toHaveLength(0);
    });

    it('stays quiet when a token is required', async () => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpHost: '0.0.0.0', httpRequireToken: true }));
      await syncHttpConfig();
      expect(warnings()).toHaveLength(0);
    });

    it('stays quiet while HTTP is off', async () => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: false, httpHost: '0.0.0.0' }));
      await syncHttpConfig();
      expect(warnings()).toHaveLength(0);
    });
  });

  describe('token dialog and rotation (009-FR-012)', () => {
    it('with no token yet, explains when one gets created', async () => {
      await showTokenDialog();
      const cfg = api.openDialog.mock.calls[0][0];
      expect(cfg.htmlContent).toMatch(/no token/i);
      expect(cfg.htmlContent).toMatch(/Require bearer token/);
      expect(cfg.buttons.map((b: { label: string }) => b.label)).toEqual(['Close']);
    });

    it('shows the token with the header usage and offers to rotate it', async () => {
      secrets.set('httpToken', 'c'.repeat(64));
      await showTokenDialog();
      const cfg = api.openDialog.mock.calls[0][0];
      expect(cfg.htmlContent).toContain('c'.repeat(64));
      expect(cfg.htmlContent).toContain('Authorization: Bearer');
      expect(cfg.buttons.map((b: { label: string }) => b.label)).toEqual(['Close', 'Generate new token']);
    });

    it('rotating replaces the secret, republishes it, and shows the new value', async () => {
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001, httpRequireToken: true }));
      await syncHttpConfig();
      const old = secrets.get('httpToken')!;
      api.openDialog.mockClear();
      api.openDialog.mockResolvedValueOnce('Generate new token').mockResolvedValueOnce('Close');

      await showTokenDialog();

      const fresh = secrets.get('httpToken')!;
      expect(fresh).toMatch(/^[0-9a-f]{64}$/);
      expect(fresh).not.toBe(old);
      expect(published().token).toBe(fresh);
      expect(api.openDialog).toHaveBeenCalledTimes(2);
      expect(api.openDialog.mock.calls[1][0].htmlContent).toContain(fresh);
      expect(api.openDialog.mock.calls[1][0].htmlContent).not.toContain(old);
    });

    it('closing the dialog changes nothing', async () => {
      secrets.set('httpToken', 'd'.repeat(64));
      api.openDialog.mockResolvedValueOnce('Close');
      await showTokenDialog();
      expect(api.setSecret).not.toHaveBeenCalled();
      expect(api.deleteSecret).not.toHaveBeenCalled();
    });
  });

  describe('server status to toasts, e.g. a busy port (009-FR-020)', () => {
    const writeStatus = (status: object) =>
      writeFileSync(join(base, 'http_status.json'), JSON.stringify({ pid: 1, updatedAt: Date.now(), ...status }));
    const enable = (extra: object = {}) =>
      api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001, httpRequireToken: false, ...extra }));
    const errorToasts = () => api.showSnack.mock.calls.filter((c) => c[0].type === 'ERROR');

    it('tells the user when the server gave up binding, with the OS reason and how to try again', async () => {
      enable();
      await syncHttpConfig();
      writeStatus({ state: 'bind-failed', host: '127.0.0.1', port: 9001, error: 'EADDRINUSE: address already in use', attempt: 3, maxAttempts: 3 });
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(1);
      const msg = errorToasts()[0][0].msg;
      expect(msg).toMatch(/9001/);
      expect(msg).toMatch(/EADDRINUSE/);
      expect(msg).toMatch(/3 attempts/);
      expect(msg).toMatch(/restart/i);
      expect(msg).toMatch(/stopped trying/i);
    });

    it('says nothing while attempts remain', async () => {
      enable();
      await syncHttpConfig();
      writeStatus({ state: 'retrying', host: '127.0.0.1', port: 9001, error: 'EADDRINUSE: in use', attempt: 1, maxAttempts: 3 });
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(0);
    });

    it('says it once, not every poll', async () => {
      enable();
      await syncHttpConfig();
      writeStatus({ state: 'bind-failed', host: '127.0.0.1', port: 9001, error: 'EADDRINUSE: in use' });
      for (let i = 0; i < 4; i++) await syncHttpConfig();
      expect(errorToasts()).toHaveLength(1);
    });

    it('says it again if the user changes settings and the port is still unavailable', async () => {
      enable();
      await syncHttpConfig();
      writeStatus({ state: 'bind-failed', host: '127.0.0.1', port: 9001, error: 'EADDRINUSE: in use' });
      await syncHttpConfig();
      enable({ httpAllowedHosts: 'x.example.org' });
      await syncHttpConfig();
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(2);
    });

    it('ignores a failure for a port the settings no longer ask for', async () => {
      enable({ httpPort: 9002 });
      await syncHttpConfig();
      writeStatus({ state: 'bind-failed', host: '127.0.0.1', port: 9001, error: 'EADDRINUSE: in use' });
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(0);
    });

    it.each([['listening'], ['off'], ['stopped'], ['invalid-config'], ['retrying']])('stays quiet for state %s', async (state) => {
      enable();
      await syncHttpConfig();
      writeStatus({ state, host: '127.0.0.1', port: 9001, error: state === 'invalid-config' ? 'x' : undefined });
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(0);
    });

    it('ignores a corrupt status file', async () => {
      enable();
      await syncHttpConfig();
      writeFileSync(join(base, 'http_status.json'), '{nope');
      await expect(syncHttpConfig()).resolves.toBeUndefined();
      expect(errorToasts()).toHaveLength(0);
    });

    it('does not read the status file while HTTP is switched off', async () => {
      writeStatus({ state: 'bind-failed', host: '127.0.0.1', port: 8765, error: 'EADDRINUSE: in use' });
      await syncHttpConfig();
      expect(errorToasts()).toHaveLength(0);
      expect(api.executeNodeScript.mock.calls.some((c) => (c[0].args as unknown[]).includes('http_status.json'))).toBe(false);
    });
  });
});

describe('plugin packaging (009-FR-001)', () => {
  const root = fileURLToPath(new URL('../../../plugin/', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));

  it('declares a settings schema so SP shows the gear button', () => {
    expect(manifest.jsonSchemaCfg).toBe('config-schema.json');
    expect(existsSync(join(root, manifest.jsonSchemaCfg))).toBe(true);
  });

  it('ships the HTTP server switched off by default, bound to loopback', () => {
    const schema = JSON.parse(readFileSync(join(root, 'config-schema.json'), 'utf-8'));
    expect(schema.type).toBe('object');
    expect(schema.properties.httpEnabled).toMatchObject({ type: 'boolean', default: false });
    expect(schema.properties.httpHost).toMatchObject({ type: 'string', default: '127.0.0.1' });
    expect(schema.properties.httpPort).toMatchObject({ type: 'integer', default: 8765, minimum: 1, maximum: 65535 });
  });

  it('offers allowed hosts, allowed origins and the token switch', () => {
    const schema = JSON.parse(readFileSync(join(root, 'config-schema.json'), 'utf-8'));
    expect(schema.properties.httpAllowedHosts).toMatchObject({ type: 'string' });
    expect(schema.properties.httpAllowedOrigins).toMatchObject({ type: 'string' });
    expect(schema.properties.httpRequireToken).toMatchObject({ type: 'boolean', default: false });
    expect(schema.properties.httpManageProcess).toMatchObject({ type: 'boolean', default: true });
  });

  it('nudges towards a token without forcing one', () => {
    const schema = JSON.parse(readFileSync(join(root, 'config-schema.json'), 'utf-8'));
    expect(schema.properties.httpRequireToken.description).toMatch(/best practice|recommended/i);
  });

  it('does not ask for a secret in the (synced) settings form', () => {
    const schema = JSON.parse(readFileSync(join(root, 'config-schema.json'), 'utf-8'));
    expect(Object.keys(schema.properties).filter((k) => /token|secret|password/i.test(k))).toEqual(['httpRequireToken']);
  });
});
