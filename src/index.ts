import { startServer, startHttpMode } from './server.js';
import { parseParentPid, watchParent } from './http/parent.js';
import { copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--extract-plugin')) {
  const src = join(dirname(fileURLToPath(import.meta.url)), 'plugin.zip');
  const dest = join(process.cwd(), 'plugin.zip');
  copyFileSync(src, dest);
  console.log(`Extracted plugin.zip to ${dest}`);
  console.log('Upload it in Super Productivity → Settings → Plugins → Upload Plugin');
  process.exit(0);
}

if (process.argv.includes('--http')) {
  // Long-lived Streamable HTTP mode; the listener itself is controlled from the
  // plugin's settings. Distinct from stdio, which a client spawns per session.
  // The SP plugin launches this with `--parent-pid <SP's pid>` and we exit with it, so a
  // quit or crash of Super Productivity can't leave an orphan holding the port.
  const parentPid = parseParentPid(process.argv);
  startHttpMode({ parentPid }).then((supervisor) => {
    const shutdown = () => { void supervisor.stop().finally(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    if (parentPid !== undefined) watchParent(parentPid, shutdown);
  }).catch((err) => {
    console.error('Failed to start MCP server (HTTP mode):', err);
    process.exit(1);
  });
} else {
  startServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
