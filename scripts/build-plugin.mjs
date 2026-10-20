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
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const SCRIPT_TAG = '<script src="dashboard.js"></script>';

/** The exact line in plugin.js that embedServer() fills in. */
export const SERVER_PLACEHOLDER = "const EMBEDDED_SERVER = { sha256: '', gzB64: '' };";

/**
 * Embed the self-contained server bundle into plugin.js (009-FR-014, 009-FR-015).
 *
 * plugin.zip carries only plugin files and the plugin's node scripts run with no PATH, so the
 * plugin cannot count on npx or a separate install to find a server to launch. It ships its own
 * (gzip + base64, written to the data dir on first use). The hash is of the uncompressed bundle
 * and doubles as the on-disk file name, so each plugin version runs exactly the server it shipped.
 */
export function embedServer(pluginJs, bundle) {
  if (!pluginJs.includes(SERVER_PLACEHOLDER)) {
    throw new Error(`plugin.js has no placeholder (${SERVER_PLACEHOLDER}) — the server would not be embedded`);
  }
  if (!bundle.length) throw new Error('server bundle is empty');
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  const gzB64 = gzipSync(bundle, { level: 9 }).toString('base64');
  // A replacer function: the base64 may contain '$' sequences that String.replace would interpret.
  const code = pluginJs.replace(SERVER_PLACEHOLDER, () => `const EMBEDDED_SERVER = { sha256: '${sha256}', gzB64: '${gzB64}' };`);
  return { code, sha256 };
}

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

  // SP reads the settings-dialog schema out of the uploaded ZIP via manifest.jsonSchemaCfg;
  // leave it out and the plugin's gear button errors instead of opening.
  for (const file of ['manifest.json', 'icon.svg', 'config-schema.json']) {
    copyFileSync(join(pluginDir, file), join(stage, file));
  }

  const bundlePath = join(root, 'dist', 'server-http.mjs');
  if (!existsSync(bundlePath)) {
    throw new Error(`${bundlePath} not found — run "npm run build:embedded" first (npm run build does)`);
  }
  const { code: pluginCode, sha256 } = embedServer(readFileSync(join(pluginDir, 'plugin.js'), 'utf-8'), readFileSync(bundlePath));
  writeFileSync(join(stage, 'plugin.js'), pluginCode);

  const html = readFileSync(join(pluginDir, 'index.html'), 'utf-8');
  const js = readFileSync(join(pluginDir, 'dashboard.js'), 'utf-8');
  writeFileSync(join(stage, 'index.html'), inlinePaneScript(html, js));

  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync('zip', ['-r', '-q', zipPath, 'manifest.json', 'plugin.js', 'index.html', 'icon.svg', 'config-schema.json'], { cwd: stage });
  console.log(`Built ${zipPath} (pane script inlined, ${js.length} bytes; server ${sha256.slice(0, 8)} embedded)`);
}

// Only build when run directly — importing this from a test must not zip anything.
if (process.argv[1] && process.argv[1].endsWith('build-plugin.mjs')) main();
