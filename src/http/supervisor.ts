import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { readHttpConfig, type HttpConfig } from './config.js';
import { writeHttpStatus, type HttpStatus } from './status.js';
import { startHttpListener, type HttpListener } from './listener.js';

export interface HttpSupervisorOptions {
  dirs: ResolvedDirs;
  createMcpServer: () => McpServer;
  /** Bearer token from the environment (SP_MCP_HTTP_TOKEN). Takes precedence over the plugin-generated one in the config file. */
  token?: string;
  /** How often to re-read http_config.json. Polled, not fs.watch'd: watching is unreliable on network/WSL mounts. */
  pollMs?: number;
  /** Wait between bind attempts after a failure (e.g. EADDRINUSE). Default 5000. */
  retryMs?: number;
  /** Bind attempts before giving up and reporting the error. Default 3. */
  maxAttempts?: number;
  /** Rewrite the status file at least this often so the plugin can tell a live server from a dead one. Default 5000. */
  heartbeatMs?: number;
  /** Set when launched by the SP plugin: marks the status file `managed` and names the process we exit with. */
  parentPid?: number;
  log?: (message: string) => void;
}

export interface HttpSupervisorStatus {
  listening: { host: string; port: number } | null;
}

export interface HttpSupervisor {
  status(): HttpSupervisorStatus;
  /** Re-read the config and reconcile now. Exposed for tests; the poll timer calls the same path. */
  tick(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Keeps one HTTP listener in step with the plugin-published config (009-FR-003): opens it
 * when enabled, closes it when disabled/removed/invalid, rebinds when host or
 * port change. The plugin settings are the single source of truth, so toggling
 * them in Super Productivity takes effect without restarting this process.
 */
export async function startHttpSupervisor(opts: HttpSupervisorOptions): Promise<HttpSupervisor> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const pollMs = opts.pollMs ?? 2000;
  const retryMs = opts.retryMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const heartbeatMs = opts.heartbeatMs ?? 5000;

  type Bind = { host: string; port: number };
  let current: { key: string; bind: Bind; listener: HttpListener } | null = null;
  let status: HttpSupervisorStatus['listening'] = null;
  let lastReportedError: string | undefined;
  // Bind attempts for the current settings (009-FR-009). Reset whenever the settings change or the
  // server is switched off, which is also how the user "restarts" after we give up.
  let attempts: { key: string; count: number; nextAt: number; gaveUp: boolean } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPublished = '';
  let lastStatus: HttpStatus = { state: 'off' };
  let lastWriteAt = 0;
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const write = (next: HttpStatus) => {
    lastStatus = next;
    lastWriteAt = Date.now();
    writeHttpStatus(opts.dirs, {
      ...next,
      ...(opts.parentPid !== undefined ? { managed: true, parentPid: opts.parentPid } : {}),
    });
  };

  /** Write the status file, but only when something the plugin would care about changed. */
  function publish(next: HttpStatus): void {
    const fingerprint = JSON.stringify([next.state, next.host, next.port, next.error, next.attempt]);
    if (fingerprint === lastPublished) return;
    lastPublished = fingerprint;
    write(next);
  }

  /** Same content, fresh timestamp: the proof of life the plugin watches for. */
  function heartbeat(): void {
    if (Date.now() - lastWriteAt >= heartbeatMs) write(lastStatus);
  }

  // Everything that shapes the listener. A change in any of it means "rebuild".
  // The token is part of the key (rotation must take effect) but is never logged.
  const keyOf = (c: HttpConfig, token: string | undefined) =>
    JSON.stringify([c.host, c.port, c.allowedHosts, c.allowedOrigins, token ?? null]);

  async function closeCurrent(why: string): Promise<void> {
    if (!current) return;
    const { bind, listener } = current;
    current = null;
    status = null;
    await listener.close();
    log(`HTTP MCP server on ${bind.host}:${bind.port} closed (${why}).`);
  }

  async function reconcile(): Promise<void> {
    if (stopped) return;
    const { config, error } = readHttpConfig(opts.dirs);

    // Report a bad config when it appears, not on every poll.
    if (error !== lastReportedError) {
      if (error) log(`HTTP MCP server disabled: ${error}`);
      lastReportedError = error;
    }

    const token = opts.token ?? config.token;
    const want = config.enabled ? { cfg: config, key: keyOf(config, token) } : null;

    if (current && (!want || want.key !== current.key)) {
      await closeCurrent(want ? 'settings changed' : 'disabled in plugin settings');
    }
    if (!want) {
      attempts = null;
      publish(error ? { state: 'invalid-config', error } : { state: 'off' });
      return;
    }
    if (current) return;

    if (attempts && attempts.key !== want.key) attempts = null; // new settings: a fresh round of attempts
    if (attempts?.gaveUp) return; // reported already; the user restarts by changing or toggling the setting
    if (attempts && Date.now() < attempts.nextAt) return;

    const { host, port } = want.cfg;
    const count = (attempts?.count ?? 0) + 1;
    try {
      const listener = await startHttpListener({
        host,
        port,
        createMcpServer: opts.createMcpServer,
        token,
        allowedHosts: want.cfg.allowedHosts,
        allowedOrigins: want.cfg.allowedOrigins,
        log,
      });
      current = { key: want.key, bind: { host, port }, listener };
      status = { host, port };
      attempts = null;
      publish({ state: 'listening', host, port });
      log(`HTTP MCP server listening on http://${host.includes(':') ? `[${host}]` : host}:${port}/mcp`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // Node's message already leads with the code ("listen EADDRINUSE: …"); don't state it twice.
      const message = e.code && !e.message.includes(e.code) ? `${e.code}: ${e.message}` : e.message;
      const gaveUp = count >= maxAttempts;
      attempts = { key: want.key, count, nextAt: Date.now() + retryMs, gaveUp };
      log(`HTTP MCP server cannot listen on ${host}:${port} (attempt ${count} of ${maxAttempts}): ${message}`);
      // Only the last miss is a failure worth reporting; earlier ones are 'retrying'.
      publish({ state: gaveUp ? 'bind-failed' : 'retrying', host, port, error: message, attempt: count, maxAttempts });
      if (gaveUp) {
        log(`HTTP MCP server gave up on ${host}:${port}. Free the port or change it in the plugin settings, or restart the server.`);
      } else if (!stopped) {
        retryTimer = setTimeout(() => { void tick(); }, retryMs);
        retryTimer.unref();
      }
    }
  }

  // Serialise ticks so a slow close/bind can never overlap the next poll.
  const tick = (): Promise<void> => {
    chain = chain
      .then(reconcile)
      .then(heartbeat)
      .catch((err) => log(`HTTP supervisor error: ${(err as Error).message}`));
    return chain;
  };

  await tick();
  const timer = setInterval(() => { void tick(); }, pollMs);

  return {
    status: () => ({ listening: status }),
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(retryTimer);
      await chain;
      await closeCurrent('shutting down');
      publish({ state: 'stopped' });
    },
  };
}
