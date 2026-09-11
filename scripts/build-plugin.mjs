// Builds plugin.zip.
//
// SP serves only index.html to the plugin iframe (via srcdoc) — arbitrary extra
// files from the ZIP are not served. A <script src="dashboard.js"> tag fetches
// nothing and fails silently, so the pane's JS is inlined here at build time.
// dashboard.js stays the source of truth: it's what the unit tests import.

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT_TAG = '<script src="dashboard.js"></script>';

/** Inline the pane's JS into index.html, replacing the external script tag. */
export function inlinePaneScript(html, js) {
  if (!html.includes(SCRIPT_TAG)) {
    throw new Error(`index.html has no ${SCRIPT_TAG} to replace — dashboard.js would not be loaded`);
  }
  const browserJs = js
    // The CommonJS export block exists so vitest can import the pure helpers;
    // in a browser `module` is undefined and the block is dead weight.
    .replace(/if \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}\n/, '')
    // A literal </script> anywhere in the source would end the element early.
    .replace(/<\/script>/g, '<\\/script>');
  return html.replace(SCRIPT_TAG, `<script>\n${browserJs}\n</script>`);
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pluginDir = join(root, 'plugin');
  const stage = join(root, 'dist', 'plugin-build');
  const zipPath = join(root, 'dist', 'plugin.zip');

  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  for (const file of ['manifest.json', 'plugin.js', 'icon.svg']) {
    copyFileSync(join(pluginDir, file), join(stage, file));
  }

  const html = readFileSync(join(pluginDir, 'index.html'), 'utf-8');
  const js = readFileSync(join(pluginDir, 'dashboard.js'), 'utf-8');
  writeFileSync(join(stage, 'index.html'), inlinePaneScript(html, js));

  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync('zip', ['-r', '-q', zipPath, 'manifest.json', 'plugin.js', 'index.html', 'icon.svg'], { cwd: stage });
  console.log(`Built ${zipPath} (pane script inlined, ${js.length} bytes)`);
}

// Only build when run directly — importing this from a test must not zip anything.
if (process.argv[1] && process.argv[1].endsWith('build-plugin.mjs')) main();
