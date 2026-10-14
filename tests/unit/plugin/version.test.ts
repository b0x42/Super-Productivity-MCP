import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeCommand, PLUGIN_VERSION } from '../../../plugin/plugin.js';

// check_connection reported 1.6.0 while running the 1.7.0 plugin, because the
// version was a literal in the ping handler that the release bump didn't touch.
// These pin it to the manifest so the drift is a red test, not a silent lie.
const manifestVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../plugin/manifest.json', import.meta.url)), 'utf-8'),
).version as string;

describe('plugin version', () => {
  beforeEach(() => {
    globalThis.PluginAPI = { addTask: vi.fn(), updateTask: vi.fn(), getTasks: vi.fn() };
  });

  it('matches the manifest', () => {
    expect(PLUGIN_VERSION).toBe(manifestVersion);
  });

  it('is what ping reports back to check_connection', async () => {
    const res = await executeCommand({ action: 'ping' });
    expect((res.result as { pluginVersion: string }).pluginVersion).toBe(manifestVersion);
  });
});

// T004: deleteProject requires PluginAPI.deleteProject, which SP only shipped starting
// with v19.0.1 — pinning the manifest value here turns an accidental revert into a
// red test rather than a silent runtime failure for users on older SP builds.
describe('plugin manifest minSupVersion', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../plugin/manifest.json', import.meta.url)), 'utf-8'),
  ) as { minSupVersion: string };

  it('requires at least the SP release that introduced deleteProject', () => {
    expect(manifest.minSupVersion).toBe('19.0.1');
  });
});
