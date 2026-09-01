import { describe, it, expect } from 'vitest';
import { parseLog, formatDuration, formatTime, entryKey, hasChanged } from '../../../plugin/dashboard.js';

describe('parseLog', () => {
  const line = (over = {}) =>
    JSON.stringify({ ts: 1_756_742_531_000, tool: 'get_tasks', args: {}, ms: 82, ok: true, result: [], ...over });

  it('parses one entry per line', () => {
    const entries = parseLog([line(), line({ tool: 'log_time' })].join('\n'));
    expect(entries).toHaveLength(2);
  });

  it('returns newest first (FR-012)', () => {
    const text = [line({ tool: 'oldest' }), line({ tool: 'newest' })].join('\n');
    expect(parseLog(text).map(e => e.tool)).toEqual(['newest', 'oldest']);
  });

  it('skips a corrupt line without losing the rest (FR-016)', () => {
    const text = [line({ tool: 'before' }), '{"half written', line({ tool: 'after' })].join('\n');
    expect(parseLog(text).map(e => e.tool)).toEqual(['after', 'before']);
  });

  it('skips lines that parse but are not entries', () => {
    const text = [line({ tool: 'real' }), 'null', '42', '"a string"'].join('\n');
    expect(parseLog(text).map(e => e.tool)).toEqual(['real']);
  });

  it('tolerates a trailing newline', () => {
    expect(parseLog(`${line()}\n`)).toHaveLength(1);
  });

  it('returns nothing for an empty or absent log (FR-017)', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('   \n  ')).toEqual([]);
    expect(parseLog(null)).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('shows sub-second calls in milliseconds', () => {
    expect(formatDuration(82)).toBe('82ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('switches to seconds at a second', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1904)).toBe('1.9s');
  });

  it('switches to minutes past a minute', () => {
    expect(formatDuration(65_000)).toBe('1m 5s');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('does not render a missing duration as NaN', () => {
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatTime', () => {
  it('renders a local wall-clock time', () => {
    expect(formatTime(1_756_742_531_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('does not render a missing timestamp as Invalid Date', () => {
    expect(formatTime(undefined)).toBe('—');
  });
});

// The pane polls every 2s. Re-rendering unconditionally wiped any row the user
// had expanded, so a click snapped shut within two seconds.
describe('entryKey', () => {
  it('is stable for the same entry across refreshes', () => {
    const e = { ts: 1_756_742_531_000, tool: 'get_tasks', ms: 82, ok: true };
    expect(entryKey(e)).toBe(entryKey({ ...e }));
  });

  it('distinguishes two calls to the same tool at different times', () => {
    expect(entryKey({ ts: 1, tool: 'get_tasks' })).not.toBe(entryKey({ ts: 2, tool: 'get_tasks' }));
  });

  it('distinguishes two tools called at the same instant', () => {
    expect(entryKey({ ts: 1, tool: 'get_tasks' })).not.toBe(entryKey({ ts: 1, tool: 'log_time' }));
  });
});

describe('hasChanged', () => {
  it('is false when the log is byte-identical, so open rows survive a refresh', () => {
    expect(hasChanged('a\nb\n', 'a\nb\n')).toBe(false);
  });

  it('is true when a new entry is appended', () => {
    expect(hasChanged('a\n', 'a\nb\n')).toBe(true);
  });

  it('is true on the very first read', () => {
    expect(hasChanged(null, 'a\n')).toBe(true);
  });
});
