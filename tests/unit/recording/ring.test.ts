import { describe, it, expect } from 'vitest';
import { needsPrune, prune } from '../../../src/recording/ring.js';

describe('needsPrune', () => {
  it('is false at the cap', () => {
    expect(needsPrune(500, 500)).toBe(false);
  });

  it('is false while within the 20% slack', () => {
    expect(needsPrune(599, 500)).toBe(false);
  });

  it('is true once the slack is exceeded', () => {
    expect(needsPrune(601, 500)).toBe(true);
  });

  it('keeps rewrites rarer than 1 call in 100 (SC-003)', () => {
    // The slack must span at least 100 appends, or the amortized prune
    // stops being amortized and the append path pays for it.
    const max = 500;
    const firstPrune = 501;
    let count = firstPrune;
    while (!needsPrune(count, max)) count++;
    expect(count - firstPrune).toBeGreaterThanOrEqual(100);
  });
});

describe('prune', () => {
  it('keeps the newest entries when over the cap', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    expect(prune(lines, 3)).toEqual(['c', 'd', 'e']);
  });

  it('drops the oldest first', () => {
    expect(prune(['old', 'new'], 1)).toEqual(['new']);
  });

  it('leaves a list under the cap untouched', () => {
    expect(prune(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('leaves a list exactly at the cap untouched', () => {
    expect(prune(['a', 'b'], 2)).toEqual(['a', 'b']);
  });

  it('discards blank lines from a trailing newline', () => {
    expect(prune(['a', '', 'b', ''], 5)).toEqual(['a', 'b']);
  });
});
