import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { embedServer, SERVER_PLACEHOLDER } from '../../../scripts/build-plugin.mjs';

// The plugin has to ship the server it launches: plugin.zip contains only plugin files, and the
// plugin's scripts run with no PATH, so it can't rely on npx or a separate install. The built
// server is therefore embedded into plugin.js and written to disk by the plugin on first use.
describe('embedServer (009-FR-014)', () => {
  const plugin = `// header\n${SERVER_PLACEHOLDER}\nconst after = 1;\n`;
  const bundle = Buffer.from('console.log("hello from the server bundle");\n'.repeat(50));

  it('replaces the placeholder with the compressed bundle and its hash', () => {
    const { code } = embedServer(plugin, bundle);
    expect(code).not.toContain(SERVER_PLACEHOLDER);
    expect(code).toMatch(/const EMBEDDED_SERVER = \{ sha256: '[0-9a-f]{64}', gzB64: '[A-Za-z0-9+/=]+' \};/);
  });

  it('round-trips: the embedded bytes decompress to exactly the bundle', () => {
    const { code } = embedServer(plugin, bundle);
    const b64 = /gzB64: '([^']+)'/.exec(code)![1];
    expect(gunzipSync(Buffer.from(b64, 'base64')).equals(bundle)).toBe(true);
  });

  it('hashes the uncompressed bundle (what the plugin verifies after decompressing)', () => {
    const { code, sha256 } = embedServer(plugin, bundle);
    expect(sha256).toBe(createHash('sha256').update(bundle).digest('hex'));
    expect(code).toContain(`sha256: '${sha256}'`);
  });

  it('is deterministic, so rebuilding an unchanged tree yields an identical plugin', () => {
    expect(embedServer(plugin, bundle).code).toBe(embedServer(plugin, bundle).code);
  });

  it('leaves the rest of the plugin untouched', () => {
    const { code } = embedServer(plugin, bundle);
    expect(code.startsWith('// header\n')).toBe(true);
    expect(code.endsWith('\nconst after = 1;\n')).toBe(true);
  });

  it('refuses to build a plugin that would silently ship without its server', () => {
    expect(() => embedServer('const nothing = 1;', bundle)).toThrow(/placeholder/i);
  });

  it('refuses an empty bundle', () => {
    expect(() => embedServer(plugin, Buffer.alloc(0))).toThrow(/empty/i);
  });
});
