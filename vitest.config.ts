import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      // Allow .js imports to resolve to .ts source files
    },
  },
});
