import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../../src/tools/duration.js';

describe('parseDuration', () => {
  it('parses a bare hours token', () => {
    expect(parseDuration('2h')).toBe(7_200_000);
  });

  it('parses a bare minutes token', () => {
    expect(parseDuration('45m')).toBe(2_700_000);
  });

  it('parses a bare seconds token', () => {
    expect(parseDuration('90s')).toBe(90_000);
  });

  it('sums combined tokens', () => {
    expect(parseDuration('1h30m')).toBe(5_400_000);
  });

  it('tolerates whitespace between tokens', () => {
    expect(parseDuration('1h 30m 15s')).toBe(5_415_000);
  });

  it('is case-insensitive', () => {
    expect(parseDuration('1H30M')).toBe(5_400_000);
  });

  it('accepts zero so set mode can clear a day', () => {
    expect(parseDuration('0m')).toBe(0);
  });

  it('rejects an empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  it('rejects a number with no unit', () => {
    expect(parseDuration('90')).toBeNull();
  });

  it('rejects a trailing unitless number', () => {
    expect(parseDuration('1h30')).toBeNull();
  });

  it('rejects a negative duration', () => {
    expect(parseDuration('-1h')).toBeNull();
  });

  it('rejects fractional values', () => {
    expect(parseDuration('1.5h')).toBeNull();
  });

  it('rejects an unsupported unit', () => {
    expect(parseDuration('1d')).toBeNull();
  });

  it('rejects free text', () => {
    expect(parseDuration('about an hour')).toBeNull();
  });
});
