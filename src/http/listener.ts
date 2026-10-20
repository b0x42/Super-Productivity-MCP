import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isLoopbackHost, normalizeAllowedOrigin } from './config.js';

export const MCP_PATH = '/mcp';
/** Largest request body accepted. Tool calls are small; this is a DoS ceiling, not a feature limit. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpListenerOptions {
  host: string;
  /** 0 asks the OS for a free port (tests); the real one is on the returned listener. */
  port: number;
  /** Builds a fresh, fully-registered server. Called once per request (stateless mode). */
  createMcpServer: () => McpServer;
  /** When set, every request must present `Authorization: Bearer <token>`. */
  token?: string;
  /**
   * Extra accepted `Host` values (normalized: lowercase, IPv6 bracketed). No port = any port.
   * Non-empty makes Host validation apply on every bind, not just loopback.
   */
  allowedHosts?: string[];
  /** Accepted `Origin` values (normalized full origins). Any other Origin is refused. */
  allowedOrigins?: string[];
  log?: (message: string) => void;
}

export interface HttpListener {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

class PayloadTooLargeError extends Error {}

/** `http(s)://localhost|127.x.x.x|[::1]` on any port — a page served from the same machine. */
function isLoopbackOrigin(normalizedOrigin: string): boolean {
  try {
    return isLoopbackHost(new URL(normalizedOrigin).hostname);
  } catch {
    return false;
  }
}

/** Split a Host header / allowed-host entry into name and optional port. IPv6 stays bracketed. */
function parseHostPort(value: string): { name: string; port?: string } {
  const m = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(value.trim().toLowerCase());
  return m ? { name: m[1], port: m[2] || undefined } : { name: value };
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(code: number, message: string, id: unknown = null): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id };
}

/** Protocol versions this build can speak (the SDK's supported legacy-era revisions). MCP clients
 * speaking a newer revision (e.g. 2026-07-28) are served using the latest legacy-era revision this
 * SDK supports (2025-11-25) — see specs/009-streamable-http/contracts/files.md for the backward-compat
 * posture. Values here mirror @modelcontextprotocol/sdk's SUPPORTED_PROTOCOL_VERSIONS; keep them in step
 * if the SDK is upgraded. */
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];
const LATEST_SUPPORTED_VERSION = '2025-11-25';

/** Thrown to return an HTTP status plus a JSON-RPC error from inside the request pipeline. */
class HttpError extends Error {
  readonly status: number;
  readonly code: number;
  readonly id: unknown;
  constructor(status: number, code: number, message: string, id: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.id = id;
  }
}

/** The _meta key carrying the protocol version in a request body. */
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Reads a single request header value, handling the (rare) case where a header is sent multiple times. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return v === undefined ? undefined : (Array.isArray(v) ? v[0] : v);
}


/** Header-value must match request body value (2026-07-28 standard request headers). Only headers
 * the client actually sent are checked — older clients are served leniently. */
function expectedNameFor(method: string, params: unknown): string | undefined {
  if (method === 'tools/call' && params && typeof params === 'object' && 'name' in params)
    return String(params.name);
  if (method === 'resources/read' && params && typeof params === 'object' && 'uri' in params)
    return String(params.uri);
  if (method === 'prompts/get' && params && typeof params === 'object' && 'name' in params)
    return String(params.name);
  return undefined;
}

function validateHeaderBody(
  req: IncomingMessage,
  body: unknown,
  log: (message: string) => void,
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const b = body as Record<string, unknown>;
  const method = typeof b.method === 'string' ? b.method : '';
  const params = b.params && typeof b.params === 'object' ? b.params : {};

  const mcpMethod = headerValue(req, 'mcp-method');
  if (mcpMethod !== undefined && mcpMethod !== method) {
    throw new HttpError(
      400,
      -32020,
      `Header mismatch: Mcp-Method header value '${mcpMethod}' does not match body value '${method}'`,
      b.id,
    );
  }

  const expectedName = expectedNameFor(method, params);
  if (expectedName !== undefined) {
    const mcpName = headerValue(req, 'mcp-name');
    if (mcpName !== undefined && mcpName !== expectedName) {
      throw new HttpError(
        400,
        -32020,
        `Header mismatch: Mcp-Name header value '${mcpName}' does not match body value '${expectedName}'`,
        b.id,
      );
    }
  }

  const pv = headerValue(req, 'mcp-protocol-version');
  const meta =
    b._meta && typeof b._meta === 'object' ? (b._meta as Record<string, unknown>) : {};
  let metaVersion =
    typeof meta[PROTOCOL_VERSION_META_KEY] === 'string'
      ? meta[PROTOCOL_VERSION_META_KEY]
      : undefined;

  // Modern-era protocol versions (e.g. 2026-07-28) are served using the latest legacy-era revision
  // this SDK supports, keeping header and _meta consistent. Unknown legacy versions fall through
  // to the SDK, which answers 400 UnsupportedProtocolVersionError.
  if (pv !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv) && pv >= '2026-01-01') {
    log(
      `MCP-Protocol-Version ${pv} is not supported by this build; serving the request as ` +
        `${LATEST_SUPPORTED_VERSION}`,
    );
    req.headers['mcp-protocol-version'] = LATEST_SUPPORTED_VERSION;
    if (metaVersion === pv) {
      meta[PROTOCOL_VERSION_META_KEY] = LATEST_SUPPORTED_VERSION;
      metaVersion = LATEST_SUPPORTED_VERSION;
    }
  }

  const effectivePv = headerValue(req, 'mcp-protocol-version');
  if (effectivePv !== undefined && metaVersion !== undefined && effectivePv !== metaVersion) {
    throw new HttpError(
      400,
      -32020,
      `Header mismatch: MCP-Protocol-Version header value '${effectivePv}' does not match body value '${metaVersion}'`,
      b.id,
    );
  }
}


/** Constant-time compare. Hashing first equalises length so length itself doesn't leak. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return false;
  const a = createHash('sha256').update(m[1]).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new PayloadTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return; // keep draining so the client can read our 413
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

/**
 * Start a stateless Streamable HTTP MCP endpoint at `POST /mcp` (009-FR-004).
 *
 * Stateless on purpose: every tool here is a request/response round trip over
 * file IPC, nothing is pushed to clients, and so there is no session worth
 * keeping. A fresh server+transport per request also means no per-session
 * state to leak or expire.
 *
 * Resolves once listening; rejects (never throws asynchronously) if the bind
 * fails, so callers can report EADDRINUSE and retry.
 */
export function startHttpListener(opts: HttpListenerOptions): Promise<HttpListener> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const loopback = isLoopbackHost(opts.host);

  if (!loopback && !opts.token) {
    log(
      `WARNING: HTTP MCP server is bound to ${opts.host} with no SP_MCP_HTTP_TOKEN set. ` +
      'Anyone who can reach this address can read and modify your Super Productivity data.',
    );
  }

  const allowedHosts = (opts.allowedHosts ?? []).map(parseHostPort);
  const allowedOrigins = new Set(opts.allowedOrigins ?? []);
  if (!loopback && allowedHosts.length === 0) {
    log(
      `NOTE: bound to ${opts.host} with no allowed hosts configured, so the Host header is not validated. ` +
      'Set "Allowed hosts" in the plugin settings to restrict which names this server answers to.',
    );
  }

  const enforceOrigin = !loopback || allowedOrigins.size > 0;

  let boundPort = opts.port;

  /**
   * DNS-rebinding guard (009-FR-006): a browser tricked into resolving evil.com to 127.0.0.1 still sends Host: evil.com.
   * Loopback binds always validate (built-in names + the allowed-hosts list). Other binds validate only
   * when an allowed-hosts list is configured — without one the legitimate names are unknowable.
   */
  const hostAllowed = (hostHeader: string | undefined): boolean => {
    if (!loopback && allowedHosts.length === 0) return true;
    if (!hostHeader) return false;
    const h = parseHostPort(hostHeader.toLowerCase());
    if (loopback) {
      const bare = opts.host.trim().toLowerCase().replace(/^\[|\]$/g, '');
      const builtin = ['localhost', '127.0.0.1', '[::1]', bare.includes(':') ? `[${bare}]` : bare];
      if (h.port === String(boundPort) && builtin.includes(h.name)) return true;
    }
    return allowedHosts.some((e) => e.name === h.name && (e.port === undefined || e.port === h.port));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostAllowed(req.headers.host)) {
      return sendJson(res, 403, rpcError(-32000, 'Forbidden: invalid Host header'));
    }
    // Origin (009-FR-007, 009-FR-008): absent for non-browser clients, so absence is fine; present means a browser is
    // involved. A page may call us if its origin is listed, or — on a loopback bind only — is itself
    // a typical loopback origin (localhost / 127.x / [::1], any port). A loopback bind with no list
    // doesn't enforce Origin at all (Host validation already stops DNS rebinding there); anything
    // else is refused. An origin that isn't allowed never receives a CORS grant, so even when its
    // request is let through the page cannot read the response.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const norm = normalizeAllowedOrigin(origin);
      const allowed = norm !== null && (allowedOrigins.has(norm) || (loopback && isLoopbackOrigin(norm)));
      if (allowed) {
        res.setHeader('access-control-allow-origin', norm);
        res.setHeader('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version');
        res.setHeader('vary', 'Origin');
        // Preflights never carry credentials, so they are answered before the token check.
        if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
          res.writeHead(204, {
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id',
            'access-control-max-age': '600',
          });
          return void res.end();
        }
      } else if (enforceOrigin || req.method === 'OPTIONS') {
        return sendJson(res, 403, rpcError(-32000, 'Forbidden: Origin not allowed'));
      }
    }
    // Auth (009-FR-012) precedes routing so an unauthenticated caller can't probe which paths exist.
    if (opts.token && !tokenMatches(req.headers.authorization, opts.token)) {
      return sendJson(res, 401, rpcError(-32001, 'Unauthorized'), { 'www-authenticate': 'Bearer' });
    }
    const path = (req.url ?? '').split('?')[0];
    if (path !== MCP_PATH) return sendJson(res, 404, rpcError(-32000, 'Not found'));
    if (req.method !== 'POST') {
      return sendJson(res, 405, rpcError(-32000, 'Method not allowed: this server is stateless, use POST'), { allow: 'POST' });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return sendJson(res, 413, rpcError(-32000, 'Request body too large'), { connection: 'close' });
      }
      return sendJson(res, 400, rpcError(-32700, 'Parse error: body is not valid JSON'));
    }

    // Header–body validation (2026-07-28): standard headers the client sent must match the body.
    validateHeaderBody(req, body, log);

    const b = body as Record<string, unknown>;

    // MCP 2026-07-28: servers MUST implement server/discover. Answer it directly — the bundled SDK
    // predates the revision and knows nothing about the method.
    if (typeof b.method === 'string' && b.method === 'server/discover') {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id: b.id,
        result: {
          protocolVersion: '2025-11-25',
          instructions:
            'Super Productivity MCP server — manage tasks, projects, tags, timers and habits over ' +
            'stateless Streamable HTTP (POST /mcp) or stdio.',
          capabilities: {
            tools: { listChanged: true },
            resources: { listChanged: true },
          },
        },
      });
    }

    const mcp = opts.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, rpcError(err.code, err.message, err.id));
      }
      log(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
      sendJson(res, 500, rpcError(-32603, 'Internal server error'));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      // After startup a socket error must not crash the process.
      server.on('error', (err) => log(`HTTP server error: ${err.message}`));
      boundPort = (server.address() as AddressInfo).port;
      resolve({
        server,
        port: boundPort,
        close: () => new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
      });
    });
  });
}
