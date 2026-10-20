import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type Server } from 'node:net';
import { platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlinePaneScript } from '../../scripts/build-plugin.mjs';
import { createServer } from '../../src/server.js';
import {
  syncHttpConfig,
  stopManagedServer,
  __setCommandDirForTest,
  __setEmbeddedServerForTest,
} from '../../plugin/plugin.js';
import { executeNodeScriptLikeSp } from '../unit/plugin/helpers/spExecutor.js';
import { makeEmbedded, saved } from '../unit/plugin/helpers/harness.js';

// The whole feature at once, with nothing mocked that SP itself would not provide (009-SC-002 … 009-SC-005):
//
//   the real pane (plugin/index.html + dashboard.js, in jsdom)
//     ⇄ files in the data directory ⇄
//   the real plugin.js, running its node scripts the way SP does (sandbox vs real child process)
//     → launches →
//   the real, bundled server (dist/server-http.mjs) as a detached process, talking real HTTP.
//
// It needs the bundled server, which `npm run build` produces (CI builds before it tests); without it the
// suite is skipped rather than failed. It is also skipped on Windows, where the data directory layout and
// process signalling differ. Intervals are shortened (the pane's 2s refresh, the plugin's 2s poll), but the
// server's own timings are real, so a full run takes about a minute.

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundlePath = join(root, 'dist', 'server-http.mjs');
const runnable = existsSync(bundlePath) && platform() !== 'win32';
const SLOW = 90_000;

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

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe.skipIf(!runnable)('Streamable HTTP end to end: pane, plugin and server (009-SC-002 … 009-SC-005)', () => {
  const realHome = process.env.HOME;
  let home: string;
  let dataDir: string;
  let dom: JSDOM;
  let poll: ReturnType<typeof setInterval>;
  let settings: string | null = null;
  const secrets = new Map<string, string>();
  const toasts: Array<{ msg: string; type: string }> = [];
  const extraProcesses: ChildProcess[] = [];
  const blockers: Server[] = [];

  const save = (cfg: Record<string, unknown>) => { settings = saved(cfg); };
  const status = () => {
    try { return JSON.parse(readFileSync(join(dataDir, 'http_status.json'), 'utf-8')); } catch { return null; }
  };
  const doc = () => dom.window.document;
  const panel = () => doc().getElementById('server')!;
  const panelText = () => (panel().hidden ? '' : panel().textContent ?? '');
  const buttons = () => [...panel().querySelectorAll('button')];
  const button = (label: string) => buttons().find((b) => (b.textContent ?? '').startsWith(label));
  const labels = () => buttons().map((b) => b.textContent).join(',');

  async function until(what: string, pred: () => unknown, ms = 30_000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await pred()) return; } catch { /* keep waiting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out after ${ms}ms waiting for: ${what}\n  panel: ${JSON.stringify(panelText().slice(0, 200))}\n  status: ${JSON.stringify(status())}`);
  }

  const call = (port: number, headers: Record<string, string> = {}, method = 'tools/list') =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) as any })).catch(() => ({ status: 0, body: null }));

  beforeAll(() => {
    // The pane finds the data directory from the user's home; give it one that is ours alone. Not under /tmp,
    // which the scripts (like the plugin) refuse as a data directory, and which many CI runners use for temp files.
    home = mkdtempSync(join(root, 'node_modules', '.sp-http-it-'));
    process.env.HOME = home;
    dataDir = join(home, ...(platform() === 'darwin' ? ['Library', 'Application Support'] : ['.local', 'share']), 'super-productivity-mcp');
    mkdirSync(join(dataDir, 'plugin_commands'), { recursive: true });

    (globalThis as { PluginAPI?: unknown }).PluginAPI = {
      loadSyncedData: async () => settings,
      showSnack: (s: { msg: string; type: string }) => { toasts.push(s); },
      getSecret: async (k: string) => secrets.get(k) ?? null,
      setSecret: async (k: string, v: string) => { secrets.set(k, v); },
      deleteSecret: async (k: string) => { secrets.delete(k); },
      openDialog: async () => undefined,
      executeNodeScript: executeNodeScriptLikeSp,
    };
    __setCommandDirForTest(join(dataDir, 'plugin_commands'));
    __setEmbeddedServerForTest(makeEmbedded(readFileSync(bundlePath)));

    const html = inlinePaneScript(
      readFileSync(join(root, 'plugin', 'index.html'), 'utf-8'),
      readFileSync(join(root, 'plugin', 'dashboard.js'), 'utf-8'),
    );
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost/',
      pretendToBeVisual: true,
      beforeParse(window) {
        (window as any).PluginAPI = { executeNodeScript: executeNodeScriptLikeSp };
        // The pane refreshes every 2s; shorten it so the test isn't mostly waiting.
        const real = window.setInterval.bind(window);
        (window as any).setInterval = (fn: () => void, ms: number, ...rest: unknown[]) => real(fn, ms >= 1000 ? 250 : ms, ...rest);
      },
    });

    // The plugin's own poll, faster than its real 2 seconds.
    poll = setInterval(() => { void syncHttpConfig(); }, 300);
  });

  afterAll(async () => {
    clearInterval(poll);
    try { await stopManagedServer(); } catch { /* best effort */ }
    const s = status();
    if (s?.managed && typeof s.pid === 'number' && alive(s.pid)) process.kill(s.pid, 'SIGKILL');
    for (const p of extraProcesses) { try { p.kill('SIGKILL'); } catch { /* already gone */ } }
    for (const b of blockers) b.close();
    dom?.window.close();
    delete (globalThis as { PluginAPI?: unknown }).PluginAPI;
    process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  let port: number;
  let pid: number;

  it('is off by default: the panel says so, and nothing is installed or running', async () => {
    save({ httpEnabled: false });
    await until('panel says Off', () => /Off/.test(panelText()));
    expect(buttons()).toHaveLength(0);
    expect(existsSync(join(dataDir, 'server'))).toBe(false);
    expect(status()).toBeNull();
  }, SLOW);

  it('enabling it starts the server; the panel shows it listening and it serves the stdio tool set', async () => {
    port = await freePort();
    save({ httpEnabled: true, httpPort: port });
    await until('panel shows the listening URL', () => panelText().includes(`http://127.0.0.1:${port}/mcp`), 60_000);

    expect(panel().querySelector('.dot')?.className).toContain('ok');
    expect(labels()).toBe('Restart,Stop');
    expect(panel().compareDocumentPosition(doc().querySelector('header')!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the tool calls

    const s = status();
    pid = s.pid;
    expect(s).toMatchObject({ state: 'listening', managed: true, parentPid: process.pid });

    const res = await call(port);
    expect(res.status).toBe(200);
    const stdio = Object.keys((createServer({ base: dataDir, commands: join(dataDir, 'plugin_commands'), responses: join(dataDir, 'plugin_responses') }).server as any)._registeredTools).sort();
    expect(res.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(stdio);
  }, SLOW);

  it('Restart replaces the process, and the buttons come back once the plugin has acknowledged', async () => {
    button('Restart')!.click();
    expect(button('Restarting')?.disabled).toBe(true);
    await until('a new server process is listening', () => status()?.state === 'listening' && status().pid !== pid && alive(status().pid), 60_000);
    await until('the old process is gone', () => !alive(pid), 10_000);
    await until('the buttons are enabled again', () => button('Restart') && !button('Restart')!.disabled && !button('Restarting'), 15_000);
    expect(existsSync(join(dataDir, 'http_control.json'))).toBe(false); // consumed
    pid = status().pid;
  }, SLOW);

  it('Stop stops it and keeps it stopped; Start brings it back', async () => {
    button('Stop')!.click();
    await until('the panel says Stopped, with a Start button', () => /Stopped/.test(panelText()) && button('Start'), 30_000);
    await until('the process has exited', () => !alive(pid), 15_000);
    await new Promise((r) => setTimeout(r, 2000)); // not relaunched behind the user's back
    expect(alive(pid)).toBe(false);
    expect(/Stopped/.test(panelText())).toBe(true);

    button('Start')!.click();
    await until('listening again under a new process', () => status()?.state === 'listening' && status().pid !== pid, 60_000);
    pid = status().pid;
  }, SLOW);

  it('a required token: created locally, masked, revealable, replaceable, and enforced by the server', async () => {
    expect(panelText()).not.toContain('Bearer token');
    save({ httpEnabled: true, httpPort: port, httpRequireToken: true });
    await until('the token row appears, masked', () => /Bearer token/.test(panelText()) && /••••/.test(panelText()), 30_000);
    const first = secrets.get('httpToken')!;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(panelText()).not.toContain(first);
    await until('the server demands it', async () => (await call(port)).status === 401, 20_000);

    button('Show')!.click();
    await until('Show reveals it', () => panelText().includes(first), 10_000);
    expect(button('Hide')).toBeTruthy();
    button('Hide')!.click();
    await until('Hide masks it again', () => !panelText().includes(first), 10_000);

    button('Copy')!.click(); // jsdom has no clipboard, like an iframe that is not allowed one
    await until('Copy falls back to showing the token', () => /Copying is blocked/.test(panelText()) && panelText().includes(first), 10_000);
    button('Hide')!.click();

    button('New token')!.click();
    const confirm = buttons().find((b) => /Really replace/.test(b.textContent ?? ''));
    expect(confirm).toBeTruthy();
    expect(secrets.get('httpToken')).toBe(first); // one click is not enough
    confirm!.click();
    await until('the token is replaced', () => secrets.get('httpToken') !== first, 30_000);
    const second = secrets.get('httpToken')!;
    await until('the old token stops working and the new one works', async () =>
      (await call(port, { authorization: `Bearer ${first}` })).status === 401 &&
      (await call(port, { authorization: `Bearer ${second}` })).status === 200, 30_000);
    button('Show')!.click();
    await until('Show now reveals the new token', () => panelText().includes(second), 10_000);
    button('Hide')!.click();
  }, SLOW);

  it('a busy port: three attempts, then the error is reported once and it stops; Restart recovers', async () => {
    const busy = await freePort();
    const blocker = createNetServer();
    blockers.push(blocker);
    await new Promise<void>((r) => blocker.listen(busy, '127.0.0.1', () => r()));
    const started = Date.now();
    save({ httpEnabled: true, httpPort: busy, httpRequireToken: true });

    await until('the panel reports that it gave up', () => /Could not listen/.test(panelText()) && /Gave up after 3 attempts/.test(panelText()), 60_000);
    const took = (Date.now() - started) / 1000;
    expect(took).toBeGreaterThan(9); // two 5s gaps between three attempts
    expect(status()).toMatchObject({ state: 'bind-failed', attempt: 3, maxAttempts: 3 });
    expect(panel().querySelector('.dot')?.className).toContain('error');
    expect(button('Restart')).toBeTruthy();
    expect(toasts.filter((t) => t.type === 'ERROR' && /after 3 attempts/.test(t.msg))).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 6000)); // well past another retry interval: it really has stopped trying
    expect(status().state).toBe('bind-failed');
    expect(toasts.filter((t) => /after 3 attempts/.test(t.msg))).toHaveLength(1);

    await new Promise<void>((r) => blocker.close(() => r()));
    button('Restart')!.click();
    await until('Restart recovers once the port is free', () => panelText().includes(`:${busy}/mcp`), 60_000);
    port = busy;
    pid = status().pid;
  }, SLOW);

  it('the tool-call list is still there, below the panel', async () => {
    writeFileSync(join(dataDir, 'tool-calls.jsonl'), JSON.stringify({ ts: Date.now(), tool: 'get_tasks', args: {}, ms: 12, ok: true, result: [] }) + '\n');
    await until('a row appears', () => doc().querySelector('#entries .entry .tool')?.textContent === 'get_tasks', 15_000);
  }, SLOW);

  it('switching the option off stops the process', async () => {
    save({ httpEnabled: false });
    await until('the process has exited', () => !alive(pid), 30_000);
    await until('the panel says Off', () => /Off/.test(panelText()), 15_000);
    expect(status().state).toBe('stopped');
  }, SLOW);

  it('a server launched by the plugin exits by itself when Super Productivity goes away (009-SC-005)', async () => {
    const dir = mkdtempSync(join(root, 'node_modules', '.sp-http-it-'));
    try {
      const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      extraProcesses.push(parent);
      const server = spawn(process.execPath, [bundlePath, '--http', '--parent-pid', String(parent.pid)], {
        env: { SP_MCP_DATA_DIR: dir, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production' },
        stdio: 'ignore',
      });
      extraProcesses.push(server);
      await until('the server is up', () => existsSync(join(dir, 'http_status.json')), 15_000);
      expect(alive(server.pid!)).toBe(true);

      parent.kill('SIGKILL');
      await until('the server has exited too', () => !alive(server.pid!), 20_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SLOW);
});
