import { describe, it, expect } from 'vitest';
import { truncatePayload } from '../../../src/recording/truncate.js';

describe('truncatePayload', () => {
  it('passes a small payload through untouched', () => {
    expect(truncatePayload({ a: 1 }, 8192)).toEqual({ a: 1 });
  });

  it('replaces an oversized payload with a marker', () => {
    const big = { notes: 'x'.repeat(9000) };
    const res = truncatePayload(big, 8192) as Record<string, unknown>;
    expect(res._truncated).toBe(true);
    expect(res.bytes).toBeGreaterThan(9000);
  });

  it('reports the real byte count so the pane can say what was elided', () => {
    const big = { notes: 'y'.repeat(9000) };
    const res = truncatePayload(big, 8192) as { bytes: number };
    expect(res.bytes).toBe(Buffer.byteLength(JSON.stringify(big), 'utf8'));
  });

  it('includes a readable preview', () => {
    const res = truncatePayload({ title: 'z'.repeat(9000) }, 8192) as { preview: string };
    expect(res.preview.startsWith('{"title":"zzz')).toBe(true);
    expect(res.preview.length).toBeLessThan(300);
  });

  it('keeps a payload that lands exactly on the cap', () => {
    const value = { a: 'b' };
    const exact = Buffer.byteLength(JSON.stringify(value), 'utf8');
    expect(truncatePayload(value, exact)).toEqual(value);
  });

  it('measures bytes not characters, so multi-byte content is not undercounted', () => {
    const value = { s: '€'.repeat(4000) }; // 3 bytes each
    const res = truncatePayload(value, 8192) as { _truncated?: boolean };
    expect(res._truncated).toBe(true);
  });

  it('survives an unserializable payload instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const res = truncatePayload(circular, 8192) as Record<string, unknown>;
    expect(res._truncated).toBe(true);
    expect(res.preview).toContain('unserializable');
  });

  it('passes undefined through', () => {
    expect(truncatePayload(undefined, 8192)).toBeUndefined();
  });
});
