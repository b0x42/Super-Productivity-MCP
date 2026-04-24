import { startServer } from './server.js';
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

startServer().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
