import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const pluginSource = readFileSync(new URL('../../plugin/plugin.js', import.meta.url), 'utf8');

describe('plugin startup path selection', () => {
  it('prefers the native macOS directory before the App Store container', () => {
    const nativePath = pluginSource.indexOf("path.join(home, 'Library', 'Application Support', APP)");
    const sandboxPath = pluginSource.indexOf("path.join(home, 'Library', 'Containers', 'com.super-productivity.app'");

    expect(nativePath).toBeGreaterThanOrEqual(0);
    expect(sandboxPath).toBeGreaterThan(nativePath);
  });

  it('defers node initialization until the bridge is ready', () => {
    expect(pluginSource).toContain('PluginAPI.onReady(init)');
  });
});
