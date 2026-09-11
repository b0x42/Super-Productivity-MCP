import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '../../src/server.js';

// The version was hardcoded in server.ts and silently went stale at the 1.7.0
// release. This pins it to package.json so it can't drift again.
describe('readPackageVersion', () => {
  it('matches the version in package.json', () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const expected = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
    expect(readPackageVersion()).toBe(expected);
  });

  it('reports a real semver, not a placeholder', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
