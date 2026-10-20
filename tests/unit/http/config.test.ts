import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizeAllowedHost,
  normalizeAllowedOrigin,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  HTTP_CONFIG_FILENAME,
  isLoopbackHost,
  parseHttpConfig,
  readHttpConfig,
} from '../../../src/http/config.js';

describe('parseHttpConfig (009-FR-002)', () => {
  it('is disabled by default when given nothing', () => {
    expect(parseHttpConfig(undefined).config).toEqual({
      enabled: false,
      host: DEFAULT_HTTP_HOST,
      port: DEFAULT_HTTP_PORT,
      allowedHosts: [],
      allowedOrigins: [],
    });
    expect(parseHttpConfig(null).error).toBeUndefined();
  });

  it('defaults to loopback so enabling the option alone is not network-exposed', () => {
    expect(DEFAULT_HTTP_HOST).toBe('127.0.0.1');
    expect(isLoopbackHost(DEFAULT_HTTP_HOST)).toBe(true);
  });

  it('accepts a fully specified valid config', () => {
    const { config, error } = parseHttpConfig({ enabled: true, host: '0.0.0.0', port: 9000 });
    expect(error).toBeUndefined();
    expect(config).toEqual({ enabled: true, host: '0.0.0.0', port: 9000, allowedHosts: [], allowedOrigins: [] });
  });

  it('fills in host and port defaults when omitted', () => {
    expect(parseHttpConfig({ enabled: true }).config).toEqual({
      enabled: true,
      host: DEFAULT_HTTP_HOST,
      port: DEFAULT_HTTP_PORT,
      allowedHosts: [],
      allowedOrigins: [],
    });
  });

  it.each([['true'], [1], ['yes'], [{}]])('treats enabled=%j as disabled (only boolean true enables)', (enabled) => {
    expect(parseHttpConfig({ enabled }).config.enabled).toBe(false);
  });

  it.each([
    [0], [-1], [65536], [80.5], ['8080'], [NaN], [null],
  ])('rejects port %j and fails closed', (port) => {
    const { config, error } = parseHttpConfig({ enabled: true, port });
    expect(error).toMatch(/port/i);
    expect(config.enabled).toBe(false);
  });

  it.each([
    [''], ['   '], ['bad host'], ['http://localhost'], ['a/b'], [42], [';rm -rf'],
  ])('rejects host %j and fails closed', (host) => {
    const { config, error } = parseHttpConfig({ enabled: true, host });
    expect(error).toMatch(/host/i);
    expect(config.enabled).toBe(false);
  });

  it.each([['127.0.0.1'], ['0.0.0.0'], ['::1'], ['::'], ['localhost'], ['my-box.local'], ['192.168.1.10']])(
    'accepts host %s',
    (host) => {
      expect(parseHttpConfig({ enabled: true, host }).error).toBeUndefined();
    },
  );

  it('trims whitespace around a host', () => {
    expect(parseHttpConfig({ enabled: true, host: ' 127.0.0.1 ' }).config.host).toBe('127.0.0.1');
  });

  it('fails closed on non-object input', () => {
    for (const bad of ['str', 5, [], true]) {
      const { config, error } = parseHttpConfig(bad);
      expect(config.enabled).toBe(false);
      expect(error).toBeDefined();
    }
  });

  it('does not report validation errors for a disabled config with junk host/port', () => {
    // Disabled means nothing will bind, so a half-typed host shouldn't spam logs.
    expect(parseHttpConfig({ enabled: false, host: '??', port: 'x' }).error).toBeUndefined();
  });
});

describe('isLoopbackHost', () => {
  it.each([['127.0.0.1'], ['127.5.5.5'], ['::1'], ['localhost'], ['LOCALHOST'], ['[::1]']])('%s is loopback', (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each([['0.0.0.0'], ['::'], ['192.168.1.1'], ['example.com']])('%s is not loopback', (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('readHttpConfig', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sp-mcp-httpcfg-')); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); });
  const dirs = () => ({ base, commands: join(base, 'plugin_commands'), responses: join(base, 'plugin_responses') });

  it('is disabled with no error when the file does not exist (the fresh-install state)', () => {
    const res = readHttpConfig(dirs());
    expect(res.config.enabled).toBe(false);
    expect(res.error).toBeUndefined();
  });

  it('reads an enabled config the plugin published', () => {
    writeFileSync(join(base, HTTP_CONFIG_FILENAME), JSON.stringify({ enabled: true, host: '127.0.0.1', port: 1234 }));
    expect(readHttpConfig(dirs()).config).toEqual({ enabled: true, host: '127.0.0.1', port: 1234, allowedHosts: [], allowedOrigins: [] });
  });

  it('fails closed with an error on corrupt JSON', () => {
    writeFileSync(join(base, HTTP_CONFIG_FILENAME), '{not json');
    const res = readHttpConfig(dirs());
    expect(res.config.enabled).toBe(false);
    expect(res.error).toMatch(/http_config\.json/);
  });
});

describe('allowedHosts (009-FR-006)', () => {
  const parse = (allowedHosts: unknown) => parseHttpConfig({ enabled: true, allowedHosts });

  it('accepts hostnames, IPs, bracketed IPv6 and host:port, lowercased and de-duplicated', () => {
    const { config, error } = parse(['Console.Example.org', 'console.example.org', '10.0.0.5:8765', '[::1]:8765', '[fd00::1]']);
    expect(error).toBeUndefined();
    expect(config.allowedHosts).toEqual(['console.example.org', '10.0.0.5:8765', '[::1]:8765', '[fd00::1]']);
  });

  it('defaults to an empty list', () => {
    expect(parseHttpConfig({ enabled: true }).config.allowedHosts).toEqual([]);
  });

  it.each([
    ['not an array', 'a.example.org'],
    ['an empty entry', ['']],
    ['a URL', ['http://a.example.org']],
    ['a path', ['a.example.org/x']],
    ['a wildcard', ['*.example.org']],
    ['a bad port', ['a.example.org:99999']],
    ['port 0', ['a.example.org:0']],
    ['an unbracketed IPv6 literal (Host headers always bracket them)', ['fd00::1']],
    ['a non-string', [42]],
    ['whitespace inside', ['a b']],
  ])('rejects %s and fails closed', (_name, value) => {
    const { config, error } = parse(value);
    expect(error).toMatch(/allowed host/i);
    expect(config.enabled).toBe(false);
  });

  it('normalizeAllowedHost returns null for junk', () => {
    expect(normalizeAllowedHost(' LOCALHOST:80 ')).toBe('localhost:80');
    expect(normalizeAllowedHost('a_b.example')).toBeNull();
  });
});

describe('allowedOrigins (009-FR-007)', () => {
  const parse = (allowedOrigins: unknown) => parseHttpConfig({ enabled: true, allowedOrigins });

  it('accepts full origins and normalizes them (case, default ports, trailing slash)', () => {
    const { config, error } = parse([
      'http://console.example.org',
      'HTTPS://Console.Example.org:443/',
      'http://localhost:5173',
      'http://[::1]:3000',
      'http://console.example.org:80',
    ]);
    expect(error).toBeUndefined();
    expect(config.allowedOrigins).toEqual([
      'http://console.example.org',
      'https://console.example.org',
      'http://localhost:5173',
      'http://[::1]:3000',
    ]);
  });

  it('defaults to an empty list', () => {
    expect(parseHttpConfig({ enabled: true }).config.allowedOrigins).toEqual([]);
  });

  it.each([
    ['a bare host', ['console.example.org']],
    ['a path', ['http://console.example.org/app']],
    ['a query', ['http://console.example.org?x=1']],
    ['credentials', ['http://user:pw@console.example.org']],
    ['a non-http scheme', ['file:///etc/passwd']],
    ['the opaque "null" origin', ['null']],
    ['a wildcard', ['*']],
    ['not an array', 'http://a.example.org'],
    ['a non-string', [1]],
  ])('rejects %s and fails closed', (_name, value) => {
    const { config, error } = parse(value);
    expect(error).toMatch(/allowed origin/i);
    expect(config.enabled).toBe(false);
  });

  it('normalizeAllowedOrigin returns null for junk', () => {
    expect(normalizeAllowedOrigin('http://x.org:80/')).toBe('http://x.org');
    expect(normalizeAllowedOrigin('x.org')).toBeNull();
  });
});

describe('token (009-FR-012)', () => {
  const good = 'a'.repeat(32);

  it('is carried through when present', () => {
    expect(parseHttpConfig({ enabled: true, token: good }).config.token).toBe(good);
  });

  it('is absent when not given', () => {
    expect(parseHttpConfig({ enabled: true }).config.token).toBeUndefined();
  });

  it.each([['short'], [''], ['has space in it but is long enough'], [42], ['x'.repeat(257)]])(
    'rejects token %j and fails closed',
    (token) => {
      const { config, error } = parseHttpConfig({ enabled: true, token });
      expect(error).toMatch(/token/i);
      expect(config.enabled).toBe(false);
      expect(config.token).toBeUndefined();
    },
  );

  it('never echoes the token in an error message', () => {
    const { error } = parseHttpConfig({ enabled: true, token: 'bad token with spaces!!' });
    expect(error).not.toContain('bad token');
  });

  it('is dropped from a disabled config', () => {
    expect(parseHttpConfig({ enabled: false, token: good }).config.token).toBeUndefined();
  });
});
