import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  syncHttpConfig,
  restartServer,
  stopServerByUser,
  startServerByUser,
  stopManagedServer,
  __setCommandDirForTest,
  __setEmbeddedServerForTest,
} from '../../../plugin/plugin.js';
import { makeEmbedded, makeHarness, saved, SP_PID, type Harness } from './helpers/harness.js';
import { modeFor } from './helpers/spExecutor.js';

let h: Harness;
let EMB = makeEmbedded();
const bundleFile = (e = EMB) => join(h.base, 'server', `sp-mcp-http-${e.sha256.slice(0, 12)}.mjs`);
const enable = (extra: object = {}) => h.api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: true, httpPort: 9001, ...extra }));
const disable = () => h.api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: false }));
const toasts = (type?: string) => h.api.showSnack.mock.calls.map((c) => c[0]).filter((t) => !type || t.type === type);
const labels = (call: number) => (h.api.openDialog.mock.calls[call][0].buttons as Array<{ label: string }>).map((b) => b.label);
const html = (call: number) => h.api.openDialog.mock.calls[call][0].htmlContent as string;
/** A live, plugin-managed server as the status file would show it. */
const running = (extra: object = {}) =>
  h.writeStatus({ state: 'listening', host: '127.0.0.1', port: 9001, managed: true, parentPid: SP_PID, pid: 4000, ...extra });

beforeEach(() => {
  h = makeHarness();
  EMB = makeEmbedded();
  __setCommandDirForTest(h.commandDir);
  __setEmbeddedServerForTest(EMB);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  h.cleanup();
});

describe('how scripts run inside Super Productivity (009-SC-006)', () => {
  it('every script the plugin sends works in the executor mode SP will pick for it', async () => {
    // The harness already executes each script in SP's real mode (vm sandbox vs full Node), so a
    // script that needs `process` but lacks a trigger word fails right here. This drives all of them.
    enable();
    await syncHttpConfig();
    running();
    await syncHttpConfig();
    disable();
    await syncHttpConfig();
    expect(toasts('ERROR')).toEqual([]);
    expect(h.modes.length).toBeGreaterThan(3);
  });

  it('keeps the steady-state poll in the cheap sandbox, not a new process every 2 seconds', async () => {
    enable();
    await syncHttpConfig();
    running();
    h.api.executeNodeScript.mockClear();
    h.modes.length = 0;
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.modes.every((m) => m.mode === 'vm')).toBe(true);
  });

  it('uses a real process for the scripts that must signal or launch one', async () => {
    enable();
    await syncHttpConfig();
    expect(modeFor(h.spawns[0].script)).toBe('spawn');
    running();
    disable();
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
    const killScript = h.modes.find((m) => m.script.includes('process.kill('))!;
    expect(killScript.mode).toBe('spawn');
  });
});

describe('the embedded server is installed on first use (009-FR-015)', () => {
  it('writes it to the data dir, named by its hash, owner-only', async () => {
    enable();
    await syncHttpConfig();
    expect(readFileSync(bundleFile(), 'utf-8')).toBe(EMB.source);
    expect(statSync(bundleFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.base, 'server')).mode & 0o777).toBe(0o700);
  });

  it('does not rewrite it once installed', async () => {
    mkdirSync(join(h.base, 'server'));
    writeFileSync(bundleFile(), 'ALREADY-INSTALLED');
    enable();
    await syncHttpConfig();
    expect(readFileSync(bundleFile(), 'utf-8')).toBe('ALREADY-INSTALLED');
    expect(h.spawns).toHaveLength(1);
  });

  it('removes servers left by older plugin versions, and nothing else', async () => {
    mkdirSync(join(h.base, 'server'));
    writeFileSync(join(h.base, 'server', 'sp-mcp-http-000000000000.mjs'), 'old');
    writeFileSync(join(h.base, 'server', 'notes.txt'), 'mine');
    enable();
    await syncHttpConfig();
    expect(readdirSync(join(h.base, 'server')).sort()).toEqual(['notes.txt', bundleFile().split('/').pop()!].sort());
  });

  it('refuses a bundle whose hash does not match, leaving nothing runnable behind', async () => {
    const bad = { ...EMB, sha256: 'a'.repeat(64) };
    __setEmbeddedServerForTest(bad);
    enable();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
    expect(existsSync(bundleFile(bad))).toBe(false);
    expect(readdirSync(join(h.base, 'server')).filter((f) => f.endsWith('.mjs'))).toEqual([]);
    expect(toasts('ERROR').some((t) => /server/i.test(t.msg))).toBe(true);
  });

  it('streams a large bundle in pieces small enough for SP (100KB script cap)', async () => {
    const big = makeEmbedded(randomBytes(200_000).toString('base64'));
    __setEmbeddedServerForTest(big);
    enable();
    await syncHttpConfig();
    expect(readFileSync(bundleFile(big), 'utf-8')).toBe(big.source);
    for (const [req] of h.api.executeNodeScript.mock.calls) {
      expect(req.script.length + JSON.stringify(req.args).length).toBeLessThan(60_000);
    }
  });
});

describe('launching the server (009-FR-014)', () => {
  it('starts it once HTTP is enabled', async () => {
    enable();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0].args).toEqual([bundleFile(), h.base, 'http_server.log']);
  });

  it('launches with SP’s own Node, detached, following SP, logging to a file', async () => {
    enable();
    await syncHttpConfig();
    const { script } = h.spawns[0];
    expect(script).toContain('process.execPath');
    expect(script).toContain('ELECTRON_RUN_AS_NODE');
    expect(script).toContain('detached: true');
    expect(script).toContain('--http');
    expect(script).toContain('--parent-pid');
    expect(script).toContain('.unref()');
  });

  it('publishes the settings before launching, so the server starts with them', async () => {
    const real = h.api.executeNodeScript.getMockImplementation()!;
    let seen: unknown;
    h.api.executeNodeScript.mockImplementation(async (req: { script: string; args: unknown[] }) => {
      if (req.script.includes('detached: true')) seen = h.published();
      return real(req);
    });
    enable({ httpAllowedHosts: 'a.example.org' });
    await syncHttpConfig();
    expect(seen).toMatchObject({ enabled: true, port: 9001, allowedHosts: ['a.example.org'] });
  });

  it('never puts the token on the command line or in the launch script', async () => {
    enable({ httpRequireToken: true });
    await syncHttpConfig();
    const token = h.secrets.get('httpToken')!;
    expect(token).toBeTruthy();
    expect(JSON.stringify(h.spawns)).not.toContain(token);
  });

  it('does not launch while HTTP is off', async () => {
    await syncHttpConfig();
    disable();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
  });

  it('does not launch when process management is switched off (you run --http yourself)', async () => {
    enable({ httpManageProcess: false });
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
    expect(h.published().enabled).toBe(true);
  });

  it('does not launch from a build that has no embedded server, and still publishes the settings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setEmbeddedServerForTest({ sha256: '', gzB64: '' });
    enable();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
    expect(h.published().enabled).toBe(true);
  });

  it('does not launch a second one while the first is still starting up', async () => {
    enable();
    await syncHttpConfig();
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(1);
  });

  it('does not launch when its own server is already up', async () => {
    enable();
    running();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
  });

  it('leaves a server someone else is running alone, and says so once', async () => {
    enable();
    running({ managed: false, parentPid: undefined });
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
    expect(toasts().filter((t) => /already running|outside/i.test(t.msg))).toHaveLength(1);
  });

  it('replaces a leftover from a previous SP session (its owner is gone) instead of adopting it', async () => {
    enable();
    running({ parentPid: 999_999, pid: 7777 });
    await syncHttpConfig();
    expect(h.kills).toEqual([7777]);
    expect(h.spawns).toHaveLength(1);
  });

  describe('when the server dies (009-FR-018)', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

    it('relaunches it once its heartbeat has gone quiet', async () => {
      enable();
      await syncHttpConfig();
      vi.setSystemTime(Date.now() + 30_000);
      h.writeStatus({ state: 'listening', managed: true, parentPid: SP_PID, updatedAt: Date.now() - 25_000 });
      await syncHttpConfig();
      expect(h.spawns).toHaveLength(2);
    });

    it('does not relaunch while the heartbeat is fresh', async () => {
      enable();
      await syncHttpConfig();
      vi.setSystemTime(Date.now() + 30_000);
      running();
      await syncHttpConfig();
      expect(h.spawns).toHaveLength(1);
    });

    it('stops after 3 launches in 2 minutes, and says where the log is', async () => {
      enable();
      for (let i = 0; i < 6; i++) {
        await syncHttpConfig();
        vi.setSystemTime(Date.now() + 20_000);
      }
      expect(h.spawns).toHaveLength(3);
      const err = toasts('ERROR').find((t) => /http_server\.log/.test(t.msg));
      expect(err).toBeTruthy();
      expect(toasts('ERROR').filter((t) => /http_server\.log/.test(t.msg))).toHaveLength(1);
    });

    it('a manual start gets it going again after it gave up', async () => {
      enable();
      for (let i = 0; i < 6; i++) {
        await syncHttpConfig();
        vi.setSystemTime(Date.now() + 20_000);
      }
      await startServerByUser();
      expect(h.spawns).toHaveLength(4);
    });
  });
});

describe('stopping the server (009-FR-014, 009-FR-016)', () => {
  it('stops our server when HTTP is switched off', async () => {
    enable();
    await syncHttpConfig();
    running();
    disable();
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
    expect(h.published().enabled).toBe(false);
  });

  it('never signals a server it did not start', async () => {
    enable();
    running({ managed: false });
    await syncHttpConfig();
    disable();
    await syncHttpConfig();
    expect(h.kills).toEqual([]);
  });

  it('never signals an outside server, even one that appeared after ours went away', async () => {
    enable();
    await syncHttpConfig();                          // we launched one, so we keep an eye on the status file
    running({ managed: false, parentPid: undefined }); // ...and now someone else's server is what's there
    disable();
    await syncHttpConfig();
    expect(h.kills).toEqual([]);
  });

  it('never signals a process whose heartbeat is stale (the pid may belong to something else now)', async () => {
    enable();
    await syncHttpConfig();
    h.writeStatus({ state: 'listening', managed: true, parentPid: SP_PID, pid: 4000, updatedAt: Date.now() - 120_000 });
    disable();
    await syncHttpConfig();
    expect(h.kills).toEqual([]);
  });

  it('does nothing when it is off and nothing is running', async () => {
    disable();
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.kills).toEqual([]);
  });

  it('does not poll the status file on every tick while HTTP has never been on', async () => {
    disable();
    await syncHttpConfig();
    h.api.executeNodeScript.mockClear();
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.api.executeNodeScript.mock.calls.some((c) => (c[0].args as unknown[]).includes('http_status.json'))).toBe(false);
  });

  it('stopManagedServer (plugin unload) stops it too', async () => {
    enable();
    await syncHttpConfig();
    running();
    await stopManagedServer();
    expect(h.kills).toEqual([4000]);
  });

  it('a manual stop sticks: the poll does not relaunch it', async () => {
    enable();
    await syncHttpConfig();
    running();
    await stopServerByUser();
    expect(h.kills).toEqual([4000]);
    running({ state: 'stopped' }); // what the server writes on its way out
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(1);
  });

  it('switching HTTP off and on again clears a manual stop', async () => {
    enable();
    await syncHttpConfig();
    running();
    await stopServerByUser();
    running({ state: 'stopped' }); // what the server writes on its way out
    disable();
    await syncHttpConfig();
    enable();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(2);
  });
});

describe('restart (009-FR-019)', () => {
  it('stops the running server and launches a fresh one', async () => {
    enable();
    await syncHttpConfig();
    running();
    await restartServer();
    expect(h.kills).toEqual([4000]);
    expect(h.spawns).toHaveLength(2);
  });

  it('just launches one when none is running (the retry after a busy port gave up)', async () => {
    enable();
    await syncHttpConfig();
    h.api.showSnack.mockClear();
    await restartServer();
    expect(h.kills).toEqual([]);
    expect(h.spawns.length).toBeGreaterThanOrEqual(1);
  });

  it('is not held back by the "just launched" grace period', async () => {
    enable();
    await syncHttpConfig();
    await restartServer();
    await restartServer();
    expect(h.spawns).toHaveLength(3);
  });

  it('declines, saying why, when HTTP is switched off', async () => {
    disable();
    await syncHttpConfig();
    await restartServer();
    expect(h.spawns).toHaveLength(0);
    expect(toasts().some((t) => /enable/i.test(t.msg))).toBe(true);
  });

  it('declines when you run the server yourself, and points at the other way to retry', async () => {
    enable({ httpManageProcess: false });
    await syncHttpConfig();
    await restartServer();
    expect(h.spawns).toHaveLength(0);
    expect(toasts().some((t) => /off and on|yourself|outside/i.test(t.msg))).toBe(true);
  });
});

describe('a busy port, with the plugin in charge of the process (009-FR-020)', () => {
  it('tells the user it gave up, and that Restart in the panel is how to try again', async () => {
    enable();
    await syncHttpConfig();
    running({ state: 'bind-failed', port: 9001, attempt: 3, maxAttempts: 3, error: 'listen EADDRINUSE: address already in use' });
    await syncHttpConfig();
    const t = toasts('ERROR').filter((e) => /EADDRINUSE/.test(e.msg));
    expect(t).toHaveLength(1);
    expect(t[0].msg).toMatch(/3 attempts/);
    expect(t[0].msg).toMatch(/press "Restart" in the SP MCP Server panel/);
  });

  describe('across a restart', () => {
    const T0 = Date.UTC(2026, 9, 17, 12, 0, 0);
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); });
    const verdict = (at: number) =>
      running({ state: 'bind-failed', port: 9001, attempt: 3, maxAttempts: 3, error: 'EADDRINUSE', updatedAt: at });

    it('does not report a failure left over from before the restart the user just asked for', async () => {
      enable();
      await syncHttpConfig();                    // launch at T0
      vi.setSystemTime(T0 + 2000);
      verdict(T0 + 2000);
      await syncHttpConfig();
      expect(toasts('ERROR')).toHaveLength(1);

      vi.setSystemTime(T0 + 3000);
      await restartServer();                     // new launch at T0+3000; the file still holds the old verdict
      await syncHttpConfig();
      expect(toasts('ERROR')).toHaveLength(1);
    });

    it('reports the new verdict once the new server has given up too', async () => {
      enable();
      await syncHttpConfig();
      vi.setSystemTime(T0 + 2000);
      verdict(T0 + 2000);
      await syncHttpConfig();
      vi.setSystemTime(T0 + 3000);
      await restartServer();
      vi.setSystemTime(T0 + 5000);
      verdict(T0 + 5000);
      await syncHttpConfig();
      expect(toasts('ERROR')).toHaveLength(2);
    });
  });
});

describe('the server panel model, what the pane shows (009-FR-019, 009-FR-022)', () => {
  const panel = () => JSON.parse(readFileSync(join(h.base, 'http_panel.json'), 'utf-8'));
  const writesOfPanel = () =>
    h.api.executeNodeScript.mock.calls.filter((c) => (c[0].args as unknown[]).includes('http_panel.json')).length;

  it('says the server is off when HTTP is off', async () => {
    disable();
    await syncHttpConfig();
    expect(panel()).toMatchObject({ tone: 'idle', controls: { restart: false, stop: false, start: false } });
    expect(panel().headline).toMatch(/off/i);
  });

  it('shows where it is listening and offers Restart and Stop', async () => {
    enable();
    await syncHttpConfig();
    running();
    await syncHttpConfig();
    expect(panel()).toMatchObject({ tone: 'ok', url: 'http://127.0.0.1:9001/mcp', pid: 4000 });
    expect(panel().headline).toContain('http://127.0.0.1:9001/mcp');
    expect(panel().detail).toMatch(/managed by Super Productivity/i);
    expect(panel().controls).toEqual({ restart: true, stop: true, start: false });
  });

  it('shows a busy port as retrying while attempts remain', async () => {
    enable();
    await syncHttpConfig();
    running({ state: 'retrying', attempt: 2, maxAttempts: 3, error: 'listen EADDRINUSE: address already in use' });
    await syncHttpConfig();
    expect(panel().tone).toBe('warn');
    expect(panel().headline).toMatch(/retrying/i);
    expect(panel().detail).toContain('2 of 3');
  });

  it('shows the error once it gave up, and offers Restart as the way to try again', async () => {
    enable();
    await syncHttpConfig();
    running({ state: 'bind-failed', attempt: 3, maxAttempts: 3, error: 'listen EADDRINUSE: address already in use 127.0.0.1:9001' });
    await syncHttpConfig();
    expect(panel().tone).toBe('error');
    expect(panel().detail).toContain('EADDRINUSE');
    expect(panel().detail).toMatch(/gave up/i);
    expect(panel().controls.restart).toBe(true);
  });

  it('keeps text as plain text: the pane renders it with textContent, so escaping here would show as junk', async () => {
    enable();
    await syncHttpConfig();
    running({ state: 'bind-failed', error: 'a <b>&amp;</b> b', host: '127.0.0.1', port: 9001 });
    await syncHttpConfig();
    expect(panel().detail).toContain('a <b>&amp;</b> b');
  });

  it('says "starting" for a server launched moments ago, without offering a second launch', async () => {
    enable();
    await syncHttpConfig();
    expect(panel().headline).toMatch(/starting/i);
    expect(panel().controls).toEqual({ restart: false, stop: false, start: false });
  });

  it('offers Start after the user stopped it', async () => {
    enable();
    await syncHttpConfig();
    running();
    await stopServerByUser();
    running({ state: 'stopped' });
    await syncHttpConfig();
    expect(panel().headline).toMatch(/stopped/i);
    expect(panel().controls).toEqual({ restart: false, stop: false, start: true });
  });

  it('for a server you run yourself, offers no controls it cannot honour', async () => {
    enable();
    running({ managed: false, parentPid: undefined });
    await syncHttpConfig();
    expect(panel().headline).toMatch(/outside Super Productivity/i);
    expect(panel().controls).toEqual({ restart: false, stop: false, start: false });
  });

  it('with process management off and nothing running, points at --http', async () => {
    enable({ httpManageProcess: false });
    await syncHttpConfig();
    expect(panel().detail).toContain('--http');
    expect(panel().controls).toEqual({ restart: false, stop: false, start: false });
  });

  it('from a build without an embedded server, says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setEmbeddedServerForTest({ sha256: '', gzB64: '' });
    enable();
    await syncHttpConfig();
    expect(panel().detail).toMatch(/no embedded server/i);
    expect(panel().controls.start).toBe(false);
  });

  it('describes the token without ever containing it', async () => {
    enable({ httpRequireToken: true });
    await syncHttpConfig();
    expect(panel().token).toEqual({ required: true, present: true });
    expect(readFileSync(join(h.base, 'http_panel.json'), 'utf-8')).not.toContain(h.secrets.get('httpToken')!);
  });

  it('reports a required token that does not exist yet', async () => {
    h.api.loadSyncedData.mockResolvedValue(saved({ httpEnabled: false, httpRequireToken: true }));
    await syncHttpConfig();
    expect(panel().token).toEqual({ required: true, present: false });
  });

  it('reports no token when none is required', async () => {
    enable();
    await syncHttpConfig();
    expect(panel().token).toEqual({ required: false, present: false });
  });

  it('is owner-only', async () => {
    enable();
    await syncHttpConfig();
    expect(statSync(join(h.base, 'http_panel.json')).mode & 0o777).toBe(0o600);
  });

  describe('freshness', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

    it('is rewritten only when something changes...', async () => {
      enable();
      await syncHttpConfig();
      running();
      await syncHttpConfig();
      const before = writesOfPanel();
      vi.setSystemTime(Date.now() + 2000);
      running();
      await syncHttpConfig();
      await syncHttpConfig();
      expect(writesOfPanel()).toBe(before);
    });

    it('...and refreshed every few seconds regardless, so the pane can tell the plugin is alive', async () => {
      enable();
      await syncHttpConfig();
      running();
      await syncHttpConfig();                    // settle on 'listening'
      const t0 = panel().updatedAt;
      const before = writesOfPanel();
      vi.setSystemTime(Date.now() + 11_000);
      running();                                 // identical content, only time has passed
      await syncHttpConfig();
      expect(writesOfPanel()).toBe(before + 1);
      expect(panel().updatedAt).toBeGreaterThan(t0);
    });
  });
});

describe('control requests from the pane (009-FR-022)', () => {
  const ctlFile = () => join(h.base, 'http_control.json');
  const request = (action: string, id = `r${Math.random().toString(36).slice(2)}`) => {
    writeFileSync(ctlFile(), JSON.stringify({ id, action, at: Date.now() }));
    return id;
  };
  const panel = () => JSON.parse(readFileSync(join(h.base, 'http_panel.json'), 'utf-8'));

  it('restart: restarts the server, consumes the request, and acknowledges it', async () => {
    enable();
    await syncHttpConfig();
    running();
    const id = request('restart');
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
    expect(h.spawns).toHaveLength(2);
    expect(existsSync(ctlFile())).toBe(false);
    expect(panel().ack).toBe(id);
  });

  it('stop: stops it, and it stays stopped', async () => {
    enable();
    await syncHttpConfig();
    running();
    request('stop');
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
    running({ state: 'stopped' });
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(1);
  });

  it('start: starts it again after a stop', async () => {
    enable();
    await syncHttpConfig();
    running();
    await stopServerByUser();
    running({ state: 'stopped' });
    request('start');
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(2);
  });

  it('rotate-token: replaces the token and republishes it in the same pass', async () => {
    enable({ httpRequireToken: true });
    await syncHttpConfig();
    const old = h.secrets.get('httpToken')!;
    running();
    request('rotate-token');
    await syncHttpConfig();
    const fresh = h.secrets.get('httpToken')!;
    expect(fresh).not.toBe(old);
    expect(h.published().token).toBe(fresh);
  });

  it('rotate-token with no token required changes nothing, and says why', async () => {
    enable();
    await syncHttpConfig();
    request('rotate-token');
    await syncHttpConfig();
    expect(h.api.setSecret).not.toHaveBeenCalled();
    expect(toasts().some((t) => /Require bearer token/i.test(t.msg))).toBe(true);
  });

  it('declines, saying why, when HTTP is off', async () => {
    disable();
    await syncHttpConfig();
    request('restart');
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(0);
    expect(toasts().some((t) => /enable/i.test(t.msg))).toBe(true);
  });

  it('runs each request once, even if the same id is written again', async () => {
    enable();
    await syncHttpConfig();
    running();
    request('restart', 'same');
    await syncHttpConfig();
    running();
    request('restart', 'same');
    await syncHttpConfig();
    expect(h.spawns).toHaveLength(2); // launch + one restart, not two
  });

  it.each([
    ['an unknown action', JSON.stringify({ id: 'x1', action: 'format-disk' })],
    ['malformed JSON', '{nope'],
    ['a missing id', JSON.stringify({ action: 'restart' })],
    ['a non-string id', JSON.stringify({ id: 5, action: 'restart' })],
    ['an oversized id', JSON.stringify({ id: 'x'.repeat(200), action: 'restart' })],
    ['a non-object', '42'],
  ])('ignores %s, and still clears the file', async (_name, body) => {
    enable();
    await syncHttpConfig();
    running();
    writeFileSync(ctlFile(), body);
    await syncHttpConfig();
    expect(h.kills).toEqual([]);
    expect(h.spawns).toHaveLength(1);
    expect(existsSync(ctlFile())).toBe(false);
  });

  it('is read in the cheap sandbox mode, not by starting a process every poll', async () => {
    enable();
    await syncHttpConfig();
    h.api.executeNodeScript.mockClear();
    await syncHttpConfig();
    const reads = h.api.executeNodeScript.mock.calls.filter((c) => (c[0].args as unknown[]).includes('http_control.json'));
    expect(reads).toHaveLength(1);
    expect(modeFor(reads[0][0].script)).toBe('vm');
  });
});

// A server can only write a final "stopped" status if it gets to shut down gracefully. Where SIGTERM is a
// forced termination (Windows), or after a SIGKILL, the status file is left saying "listening" with a fresh
// heartbeat. The plugin knows it just stopped that process, so it must not believe the file for the next 20s.
describe('stopping a server that cannot say goodbye (009-FR-016, 009-FR-019)', () => {
  const ctlFile = () => join(h.base, 'http_control.json');
  const panel = () => JSON.parse(readFileSync(join(h.base, 'http_panel.json'), 'utf-8'));
  const request = (action: string, id = `r${Math.random().toString(36).slice(2)}`) => {
    writeFileSync(ctlFile(), JSON.stringify({ id, action, at: Date.now() }));
    return id;
  };

  it('Stop: the panel says Stopped in the same pass that acknowledges the request', async () => {
    enable();
    await syncHttpConfig();
    running();                       // listening, heartbeat fresh
    const id = request('stop');
    await syncHttpConfig();          // kills it; the status file is NOT rewritten
    expect(h.kills).toEqual([4000]);
    expect(panel().ack).toBe(id);
    expect(panel().headline).toMatch(/stopped/i);
    expect(panel().controls).toEqual({ restart: false, stop: false, start: true });
  });

  it('Stop: and it stays Stopped on the following polls, while the stale file still says listening', async () => {
    enable();
    await syncHttpConfig();
    running();
    request('stop');
    await syncHttpConfig();
    for (let i = 0; i < 3; i++) await syncHttpConfig();
    expect(panel().headline).toMatch(/stopped/i);
    expect(panel().tone).toBe('idle');
  });

  it('Restart: the panel does not keep presenting the old, dead server as listening', async () => {
    enable();
    await syncHttpConfig();
    running();
    request('restart');
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
    expect(h.spawns).toHaveLength(2);
    expect(panel().headline).toMatch(/starting/i);
    expect(panel().controls).toEqual({ restart: false, stop: false, start: false });
  });

  it('switching HTTP off does not signal the same pid again on later polls (pids get reused)', async () => {
    enable();
    await syncHttpConfig();
    running();
    disable();
    await syncHttpConfig();
    await syncHttpConfig();
    await syncHttpConfig();
    expect(h.kills).toEqual([4000]);
  });

  it('a new server that reuses the dead one\'s pid is recognised once it reports in', async () => {
    enable();
    await syncHttpConfig();
    running();
    request('restart');
    await syncHttpConfig();
    running({ pid: 4000, updatedAt: Date.now() + 5000, parentPid: SP_PID }); // a fresh write, after the kill
    await syncHttpConfig();
    expect(panel().tone).toBe('ok');
    expect(panel().controls.restart).toBe(true);
  });
});

describe('there is one sidebar entry (009-FR-019)', () => {
  it('the plugin registers no menu entry of its own (the pane is the interface)', () => {
    const source = readFileSync(new URL('../../../plugin/plugin.js', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/registerMenuEntry\s*\(/);
  });
});
