import { defineConfig } from 'tsup';

// The server as ONE self-contained file, embedded into plugin.js by scripts/build-plugin.mjs so the
// SP plugin can launch it without npx, PATH or a separate install. Everything is bundled (the main
// build keeps dependencies external); dist/index.js is untouched, hence clean: false.
export default defineConfig({
  entry: { 'server-http': 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }), // no package.json beside it in the data dir: .js would be CJS
  clean: false,
  minify: true,
  sourcemap: false,
  noExternal: [/.*/],
  // Some bundled CommonJS dependencies call require() on node built-ins.
  banner: { js: "import { createRequire as __spCreateRequire } from 'node:module'; const require = __spCreateRequire(import.meta.url);" },
});
