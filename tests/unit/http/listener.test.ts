import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../../../src/server.js';
import { startHttpListener, type HttpListener } from '../../../src/http/listener.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';

function makeDirs(): ResolvedDirs {
  const base = mkdtempSync(join(tmpdir(), 'sp-mcp-http-'));
  const commands = join(base, 'plugin_commands');
  const responses = join(base, 'plugin_responses');
  mkdirSync(commands);
  mkdirSync(responses);
  return { base, commands, responses };
}

interface RawResponse { status: number; body: string; headers: Record<string, unknown> }

function raw(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
});
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('startHttpListener (009-FR-004)', () => {
  let dirs: ResolvedDirs;
  let listener: HttpListener | undefined;
  const logs: string[] = [];

  beforeEach(() => { dirs = makeDirs(); logs.length = 0; });
  afterEach(async () => {
    await listener?.close();
    listener = undefined;
    rmSync(dirs.base, { recursive: true, force: true });
  });

  const start = (extra: { token?: string; host?: string; allowedHosts?: string[]; allowedOrigins?: string[] } = {}) =>
    startHttpListener({
      host: extra.host ?? '127.0.0.1',
      port: 0,
      token: extra.token,
      allowedHosts: extra.allowedHosts,
      allowedOrigins: extra.allowedOrigins,
      createMcpServer: () => createServer(dirs).server,
      log: (m) => logs.push(m),
    });

  it('serves the real tool set to an MCP SDK client over Streamable HTTP', async () => {
    listener = await start();
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listener.port}/mcp`)));

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('check_connection');
    expect(names).toContain('create_task');

    // A tool that needs no SP round-trip, proving a call executes end to end.
    const res = await client.callTool({ name: 'debug_directories', arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text).base).toBe(dirs.base);
    await client.close();
  });

  it('serves the same tools as the stdio server (parity)', async () => {
    listener = await start();
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listener.port}/mcp`)));
    const over = (await client.listTools()).tools.map((t) => t.name).sort();
    await client.close();
    // Registered tool names, read off a fresh instance.
    const { server } = createServer(dirs);
    const local = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
    expect(over).toEqual(local);
  });

  it('answers 405 to GET and DELETE (stateless: no server push, no sessions)', async () => {
    listener = await start();
    for (const method of ['GET', 'DELETE']) {
      const res = await raw(listener.port, { method, headers: MCP_HEADERS });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });

  it('answers 404 on any path other than /mcp', async () => {
    listener = await start();
    const res = await raw(listener.port, { path: '/', headers: MCP_HEADERS, body: INIT });
    expect(res.status).toBe(404);
  });

  it('returns a JSON-RPC parse error for malformed JSON', async () => {
    listener = await start();
    const res = await raw(listener.port, { headers: MCP_HEADERS, body: '{nope' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it('rejects request bodies over 1 MiB with 413', async () => {
    listener = await start();
    const res = await raw(listener.port, { headers: MCP_HEADERS, body: Buffer.alloc(1024 * 1024 + 1, 'a') });
    expect(res.status).toBe(413);
  });

  describe('protocol headers (MCP 2026-07-28 Streamable HTTP)', () => {
    it('accepts a modern-era protocol version and serves it as 2025-11-25', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2026-07-28' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).result.protocolVersion).toBe('2025-11-25');
      expect(logs.some((l) => /not supported/.test(l))).toBe(true);
    });

    it('rejects an unknown legacy protocol version with 400', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: { ...MCP_HEADERS, 'mcp-protocol-version': '1900-01-01' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(400);
      const err = JSON.parse(res.body).error;
      expect(err.code).toBe(-32000);
      expect(err.message).toMatch(/Unsupported protocol version/);
    });

    it('rejects a header/body method mismatch with HeaderMismatch (-32020)', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: { ...MCP_HEADERS, 'mcp-method': 'resources/read' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(400);
      const err = JSON.parse(res.body).error;
      expect(err.code).toBe(-32020);
      expect(err.message).toMatch(/Mcp-Method/);
    });

    it('rejects a header/body name mismatch with HeaderMismatch (-32020)', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: { ...MCP_HEADERS, 'mcp-name': 'other' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_connection', arguments: {} } }),
      });
      expect(res.status).toBe(400);
      const err = JSON.parse(res.body).error;
      expect(err.code).toBe(-32020);
      expect(err.message).toMatch(/Mcp-Name/);
    });

    it('rejects a protocol-version header/_meta mismatch with HeaderMismatch (-32020)', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } },
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' },
        }),
      });
      expect(res.status).toBe(400);
      const err = JSON.parse(res.body).error;
      expect(err.code).toBe(-32020);
      expect(err.message).toMatch(/MCP-Protocol-Version/);
    });

    it('is lenient when clients send no protocol headers', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).result.tools.length).toBeGreaterThan(0);
    });

    it('answers 202 to a notification with no body', async () => {
      listener = await start();
      const res = await raw(listener.port, {
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }),
      });
      expect(res.status).toBe(202);
      expect(res.body).toBe('');
    });
  });

  describe('bearer token (009-FR-012)', () => {
    it('401s a request with no Authorization header', async () => {
      listener = await start({ token: 's3cret' });
      const res = await raw(listener.port, { headers: MCP_HEADERS, body: INIT });
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer/);
    });

    it('401s a wrong token, including one of the same length', async () => {
      listener = await start({ token: 's3cret' });
      for (const bad of ['Bearer nope', 'Bearer s3creT', 'Basic s3cret', 's3cret']) {
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, authorization: bad }, body: INIT });
        expect(res.status).toBe(401);
      }
    });

    it('accepts the right token', async () => {
      listener = await start({ token: 's3cret' });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, authorization: 'Bearer s3cret' }, body: INIT });
      expect(res.status).toBe(200);
    });

    it('does not require a token when none is configured', async () => {
      listener = await start();
      expect((await raw(listener.port, { headers: MCP_HEADERS, body: INIT })).status).toBe(200);
    });

    it('checks the token before the path, so unauthenticated callers learn nothing about routes', async () => {
      listener = await start({ token: 's3cret' });
      const res = await raw(listener.port, { path: '/anything', headers: MCP_HEADERS, body: INIT });
      expect(res.status).toBe(401);
    });
  });

  describe('DNS-rebinding protection, loopback bind (009-FR-006)', () => {
    it('rejects a foreign Host header with 403', async () => {
      listener = await start();
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, host: 'evil.example.com' }, body: INIT });
      expect(res.status).toBe(403);
    });

    it.each([['localhost'], ['127.0.0.1'], ['[::1]']])('accepts Host %s:<port>', async (h) => {
      listener = await start();
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, host: `${h}:${listener.port}` }, body: INIT });
      expect(res.status).toBe(200);
    });

    it('does not validate Host on a wildcard bind (names are unknowable), and warns once without a token', async () => {
      listener = await start({ host: '0.0.0.0' });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, host: 'anything.lan' }, body: INIT });
      expect(res.status).toBe(200);
      expect(logs.filter((l) => /WARNING/.test(l))).toHaveLength(1);
    });

    it('does not warn on a wildcard bind when a token is set', async () => {
      listener = await start({ host: '0.0.0.0', token: 'x' });
      expect(logs.some((l) => /WARNING/.test(l))).toBe(false);
    });
  });

  describe('allowedHosts (009-FR-006)', () => {
    it('on a wildcard bind with a list, accepts only listed Host values', async () => {
      listener = await start({ host: '0.0.0.0', allowedHosts: ['console.example.org'] });
      const ok = await raw(listener.port, { headers: { ...MCP_HEADERS, host: 'console.example.org' }, body: INIT });
      expect(ok.status).toBe(200);
      const bad = await raw(listener.port, { headers: { ...MCP_HEADERS, host: 'evil.example.com' }, body: INIT });
      expect(bad.status).toBe(403);
    });

    it('an entry without a port matches any port; with a port, only that one', async () => {
      listener = await start({ host: '0.0.0.0', allowedHosts: ['a.example.org', 'b.example.org:9999'] });
      const send = (host: string) => raw(listener!.port, { headers: { ...MCP_HEADERS, host }, body: INIT }).then((r) => r.status);
      expect(await send('a.example.org')).toBe(200);
      expect(await send('a.example.org:1234')).toBe(200);
      expect(await send('b.example.org:9999')).toBe(200);
      expect(await send('b.example.org:1')).toBe(403);
      expect(await send('b.example.org')).toBe(403);
    });

    it('is case-insensitive', async () => {
      listener = await start({ host: '0.0.0.0', allowedHosts: ['console.example.org'] });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, host: 'CONSOLE.Example.ORG' }, body: INIT });
      expect(res.status).toBe(200);
    });

    it('on a loopback bind, adds to the built-in loopback names instead of replacing them', async () => {
      listener = await start({ allowedHosts: ['proxy.example.org'] });
      const send = (host: string) => raw(listener!.port, { headers: { ...MCP_HEADERS, host }, body: INIT }).then((r) => r.status);
      expect(await send('proxy.example.org')).toBe(200);
      expect(await send(`localhost:${listener.port}`)).toBe(200);
      expect(await send('evil.example.com')).toBe(403);
    });

    it('a wildcard bind with a list does not warn about unvalidated Host headers', async () => {
      listener = await start({ host: '0.0.0.0', token: 'x', allowedHosts: ['a.example.org'] });
      expect(logs.some((l) => /Host header/i.test(l))).toBe(false);
    });

    it('a wildcard bind without a list says Host is not being validated', async () => {
      listener = await start({ host: '0.0.0.0', token: 'x' });
      expect(logs.some((l) => /Host header.*not.*validated/i.test(l))).toBe(true);
    });
  });

  describe('allowedOrigins (009-FR-007)', () => {
    const ORIGIN = 'http://console.example.org';

    it('lets requests without an Origin header through (non-browser clients send none)', async () => {
      listener = await start({ allowedOrigins: [ORIGIN] });
      expect((await raw(listener.port, { headers: MCP_HEADERS, body: INIT })).status).toBe(200);
    });

    it('accepts a listed Origin', async () => {
      listener = await start({ allowedOrigins: [ORIGIN] });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: ORIGIN }, body: INIT });
      expect(res.status).toBe(200);
    });

    it('refuses an unlisted Origin with 403', async () => {
      listener = await start({ allowedOrigins: [ORIGIN] });
      for (const origin of ['http://evil.example.com', 'https://console.example.org', 'http://console.example.org:8080', 'null']) {
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin }, body: INIT });
        expect(res.status, origin).toBe(403);
      }
    });

    it('does not enforce Origin on a loopback bind when the list is empty (the default)', async () => {
      listener = await start();
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: 'http://anything.example.com' }, body: INIT });
      expect(res.status).toBe(200);
      // Not enforced is not the same as trusted: the page still gets no CORS grant, so it can't read the reply.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does enforce Origin on a non-loopback bind even when the list is empty', async () => {
      listener = await start({ host: '0.0.0.0', token: 'x' });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, authorization: 'Bearer x', origin: ORIGIN }, body: INIT });
      expect(res.status).toBe(403);
    });

    describe('typical loopback origins are safe on a loopback bind (009-FR-007)', () => {
      const LOOPBACK = ['http://localhost:5173', 'https://localhost', 'http://127.0.0.1:3000', 'http://127.1.2.3:80', 'http://[::1]:8080'];

      it.each(LOOPBACK)('accepts %s with CORS, even when a list is configured', async (origin) => {
        listener = await start({ allowedOrigins: [ORIGIN] });
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin }, body: INIT });
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(new URL(origin).origin);
      });

      it('answers their preflights', async () => {
        listener = await start({ allowedOrigins: [ORIGIN] });
        const res = await raw(listener.port, {
          method: 'OPTIONS',
          headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
        });
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      });

      it('still refuses look-alikes once a list is configured', async () => {
        listener = await start({ allowedOrigins: [ORIGIN] });
        for (const origin of ['http://localhost.evil.com', 'http://127.0.0.1.evil.com', 'http://evil.com/localhost', 'http://localhost@evil.com']) {
          const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin }, body: INIT });
          expect(res.status, origin).toBe(403);
        }
      });

      it('are NOT assumed safe on a non-loopback bind: they must be listed', async () => {
        listener = await start({ host: '0.0.0.0', token: 'x' });
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, authorization: 'Bearer x', origin: 'http://localhost:5173' }, body: INIT });
        expect(res.status).toBe(403);
      });
    });

    it('matches the Origin exactly: no scheme, port or subdomain confusion', async () => {
      listener = await start({ allowedOrigins: [ORIGIN] });
      for (const origin of ['http://console.example.org.evil.com', 'http://evilconsole.example.org', 'http://console.example.org@evil.com']) {
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin }, body: INIT });
        expect(res.status, origin).toBe(403);
      }
    });

    it('normalizes the request Origin the same way as the list (default port, case)', async () => {
      listener = await start({ allowedOrigins: [ORIGIN] });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: 'HTTP://Console.Example.org:80' }, body: INIT });
      expect(res.status).toBe(200);
    });

    it('is enforced before the token, so a wrong Origin never reaches auth', async () => {
      listener = await start({ token: 's3cret', allowedOrigins: [ORIGIN] });
      const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: 'http://evil.example.com' }, body: INIT });
      expect(res.status).toBe(403);
    });

    describe('CORS for allowed browser origins (009-FR-008)', () => {
      const preflight = (port: number, origin: string) =>
        raw(port, {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type, authorization',
          },
        });

      it('answers a preflight from an allowed Origin with 204 and no token needed', async () => {
        listener = await start({ token: 's3cret', allowedOrigins: [ORIGIN] });
        const res = await preflight(listener.port, ORIGIN);
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
        expect(String(res.headers['access-control-allow-methods'])).toMatch(/POST/);
        expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toMatch(/authorization/);
        expect(String(res.headers.vary)).toMatch(/Origin/);
      });

      it('refuses a preflight from an unlisted Origin', async () => {
        listener = await start({ allowedOrigins: [ORIGIN] });
        const res = await preflight(listener.port, 'http://evil.example.com');
        expect(res.status).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });

      it('echoes the allowed Origin on real responses, and only that one', async () => {
        listener = await start({ allowedOrigins: [ORIGIN, 'http://other.example.org'] });
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: ORIGIN }, body: INIT });
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      });

      it('sends no CORS headers to clients without an Origin', async () => {
        listener = await start({ allowedOrigins: [ORIGIN] });
        const res = await raw(listener.port, { headers: MCP_HEADERS, body: INIT });
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });

      it('still requires the token on the real request after a successful preflight', async () => {
        listener = await start({ token: 's3cret', allowedOrigins: [ORIGIN] });
        const res = await raw(listener.port, { headers: { ...MCP_HEADERS, origin: ORIGIN }, body: INIT });
        expect(res.status).toBe(401);
      });
    });
  });

  it('stops accepting connections after close()', async () => {
    listener = await start();
    const port = listener.port;
    await listener.close();
    listener = undefined;
    await expect(raw(port, { headers: MCP_HEADERS, body: INIT })).rejects.toThrow();
  });

  it('rejects start() when the port is taken, rather than throwing asynchronously', async () => {
    listener = await start();
    await expect(startHttpListener({
      host: '127.0.0.1', port: listener.port, createMcpServer: () => createServer(dirs).server, log: () => {},
    })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
