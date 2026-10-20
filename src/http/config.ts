import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';
import type { ResolvedDirs } from '../ipc/directories.js';

/** Written by the SP plugin from its settings dialog; watched by `--http` mode. */
export const HTTP_CONFIG_FILENAME = 'http_config.json';

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 8765;

export interface HttpConfig {
  enabled: boolean;
  host: string;
  port: number;
  /**
   * Extra accepted `Host` header values. An entry without a port matches that
   * hostname on any port; with a port it must match exactly. Lowercase,
   * IPv6 bracketed. Empty = no extra hosts.
   */
  allowedHosts: string[];
  /**
   * Accepted `Origin` header values, as normalized full origins
   * (`scheme://host[:port]`). A request carrying any other Origin is refused.
   */
  allowedOrigins: string[];
  /** Bearer token the plugin generated and keeps in SP's local-only secret store. */
  token?: string;
}

export interface HttpConfigResult {
  config: HttpConfig;
  /** Set when the input was present but unusable. `config.enabled` is then false. */
  error?: string;
}

const disabled = (): HttpConfig => ({
  enabled: false,
  host: DEFAULT_HTTP_HOST,
  port: DEFAULT_HTTP_PORT,
  allowedHosts: [],
  allowedOrigins: [],
});

// RFC 1123 hostname: dot-separated labels of letters/digits/hyphens, no leading
// or trailing hyphen. Deliberately strict — the value goes straight to listen().
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function isValidHost(host: string): boolean {
  return isIP(host) !== 0 || HOSTNAME_RE.test(host);
}

/**
 * Canonical form of one allowed-Host entry, or null if it isn't one.
 * Mirrors normalizeAllowedHost in plugin/plugin.js — keep the two in step.
 */
export function normalizeAllowedHost(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const m = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return null;
  const [, name, port] = m;
  const nameOk = name.startsWith('[') ? isIP(name.slice(1, -1)) === 6 : HOSTNAME_RE.test(name);
  if (!nameOk) return null;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return v;
}

/**
 * Canonical form of one allowed-Origin entry (`scheme://host[:port]`, nothing
 * else), or null. Mirrors normalizeAllowedOrigin in plugin/plugin.js.
 */
export function normalizeAllowedOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  return u.origin;
}

function normalizeList(
  raw: unknown,
  label: string,
  one: (s: string) => string | null,
): { list: string[]; error?: string } {
  if (raw === undefined) return { list: [] };
  if (!Array.isArray(raw)) return { list: [], error: `Invalid ${label} list: expected an array of strings` };
  const out: string[] = [];
  for (const entry of raw) {
    const norm = typeof entry === 'string' ? one(entry) : null;
    if (norm === null) return { list: [], error: `Invalid ${label} ${JSON.stringify(entry)}` };
    if (!out.includes(norm)) out.push(norm);
  }
  return { list: out };
}

const TOKEN_RE = /^[\x21-\x7e]{16,256}$/;

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Validate a config blob (009-FR-002). The file lives in a shared, user-writable directory
 * and is an "open local channel" per SP's plugin docs, so nothing in it is
 * trusted: only a literal boolean `true` enables, and any malformed host/port
 * on an enabled config fails *closed* (disabled + error) rather than falling
 * back to a default that would silently bind somewhere the user didn't pick.
 */
export function parseHttpConfig(raw: unknown): HttpConfigResult {
  if (raw === undefined || raw === null) return { config: disabled() };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: disabled(), error: 'HTTP config must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.enabled !== true) {
    // Not enabled: nothing will bind, so don't validate (or complain about) the rest.
    return { config: disabled() };
  }

  const host = obj.host === undefined ? DEFAULT_HTTP_HOST : obj.host;
  if (typeof host !== 'string' || !isValidHost(host.trim())) {
    return { config: disabled(), error: `Invalid host ${JSON.stringify(host)}: expected an IP address or hostname` };
  }

  const port = obj.port === undefined ? DEFAULT_HTTP_PORT : obj.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { config: disabled(), error: `Invalid port ${JSON.stringify(port)}: expected an integer from 1 to 65535` };
  }

  const hosts = normalizeList(obj.allowedHosts, 'allowed host', normalizeAllowedHost);
  if (hosts.error) return { config: disabled(), error: hosts.error };
  const origins = normalizeList(obj.allowedOrigins, 'allowed origin', normalizeAllowedOrigin);
  if (origins.error) return { config: disabled(), error: origins.error };

  // The value is a credential: say it is wrong, never say what it was.
  if (obj.token !== undefined && (typeof obj.token !== 'string' || !TOKEN_RE.test(obj.token))) {
    return { config: disabled(), error: 'Invalid token: expected 16–256 printable characters, no spaces' };
  }

  const config: HttpConfig = {
    enabled: true,
    host: host.trim(),
    port,
    allowedHosts: hosts.list,
    allowedOrigins: origins.list,
  };
  if (obj.token !== undefined) config.token = obj.token;
  return { config };
}

/** Read and validate `<dataDir>/http_config.json`. A missing file means "never configured" = off. */
export function readHttpConfig(dirs: ResolvedDirs): HttpConfigResult {
  let text: string;
  try {
    text = readFileSync(join(dirs.base, HTTP_CONFIG_FILENAME), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { config: disabled() };
    return { config: disabled(), error: `Cannot read ${HTTP_CONFIG_FILENAME}: ${(err as Error).message}` };
  }
  try {
    return parseHttpConfig(JSON.parse(text));
  } catch {
    return { config: disabled(), error: `${HTTP_CONFIG_FILENAME} is not valid JSON` };
  }
}
