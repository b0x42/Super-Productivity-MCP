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

  it('uses seq to distinguish two calls to the same tool in the same millisecond', () => {
    const a = entryKey({ ts: 1, tool: 'get_tasks', seq: 0 });
    const b = entryKey({ ts: 1, tool: 'get_tasks', seq: 1 });
    expect(a).not.toBe(b);
  });

  it('falls back to ts + tool for older entries recorded before seq existed', () => {
    expect(entryKey({ ts: 1, tool: 'get_tasks' })).toBe('1|get_tasks');
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

// ---------------------------------------------------------------------------
// Server panel (above the tool-call list). Every decision is a pure function so
// it can be tested; the DOM code only draws what panelView() returns.
// ---------------------------------------------------------------------------
import {
  parsePanel,
  panelView,
  makeControlRequest,
  tokenFromConfig,
  maskToken,
  PANEL_STALE_MS,
  PENDING_TIMEOUT_MS,
} from '../../../plugin/dashboard.js';

const NOW = 1_800_000_000_000;
const model = (over: Record<string, unknown> = {}) => ({
  version: 1,
  updatedAt: NOW - 1000,
  tone: 'ok',
  headline: 'Listening on http://127.0.0.1:8765/mcp',
  detail: 'Started and managed by Super Productivity (pid 4000).',
  url: 'http://127.0.0.1:8765/mcp',
  pid: 4000,
  controls: { restart: true, stop: true, start: false },
  token: { required: false, present: false },
  ack: null,
  ...over,
});
const view = (m: unknown, state: Record<string, unknown> = {}) => panelView(m as never, { now: NOW, ...state } as never);
const ids = (v: { buttons: Array<{ id: string }> }) => v.buttons.map((b) => b.id);

describe('parsePanel (009-FR-022)', () => {
  it('reads what the plugin publishes', () => {
    expect(parsePanel(JSON.stringify(model()))).toMatchObject({ tone: 'ok', headline: expect.stringContaining('Listening') });
  });

  it.each([[null], [undefined], [''], ['{nope'], ['42'], ['null'], ['[]'], [JSON.stringify({ version: 2 })], [JSON.stringify({ version: 1 })]])(
    'returns null for %j rather than drawing garbage',
    (text) => { expect(parsePanel(text as never)).toBeNull(); },
  );

  it('coerces odd fields to safe values instead of trusting a file on disk', () => {
    const m = parsePanel(JSON.stringify(model({ tone: 'purple', headline: 5, controls: { restart: 'yes' }, token: 'x', ack: 7 })))!;
    expect(m.tone).toBe('idle');
    expect(typeof m.headline).toBe('string');
    expect(m.controls).toEqual({ restart: false, stop: false, start: false });
    expect(m.token).toEqual({ required: false, present: false });
    expect(m.ack).toBeNull();
  });
});

describe('panelView: what is drawn (009-FR-019, 009-FR-021)', () => {
  it('draws nothing when the plugin has not published anything', () => {
    expect(view(null).visible).toBe(false);
  });

  it('shows tone, headline and detail', () => {
    expect(view(model())).toMatchObject({ visible: true, tone: 'ok', headline: expect.stringContaining('Listening'), detail: expect.stringContaining('managed') });
  });

  it('offers exactly the controls the plugin says make sense', () => {
    expect(ids(view(model()))).toEqual(['restart', 'stop']);
    expect(ids(view(model({ controls: { restart: false, stop: false, start: true } })))).toEqual(['start']);
    expect(ids(view(model({ controls: { restart: false, stop: false, start: false } })))).toEqual([]);
  });

  it('labels the buttons for people', () => {
    expect(view(model()).buttons.map((b) => b.label)).toEqual(['Restart', 'Stop']);
  });

  describe('a request in flight', () => {
    const pending = { id: 'abc', action: 'restart', since: NOW - 1000 };

    it('disables the buttons and says what is happening', () => {
      const v = view(model(), { pending });
      expect(v.buttons.every((b: { disabled: boolean }) => b.disabled)).toBe(true);
      expect(v.buttons.find((b: { id: string }) => b.id === 'restart')!.label).toBe('Restarting…');
    });

    it('ends when the plugin acknowledges that request', () => {
      const v = view(model({ ack: 'abc' }), { pending });
      expect(v.buttons.some((b: { disabled: boolean }) => b.disabled)).toBe(false);
      expect(v.pending).toBe(false);
    });

    it('is not ended by an acknowledgement of some other request', () => {
      expect(view(model({ ack: 'other' }), { pending }).pending).toBe(true);
    });

    it('gives up waiting after a while, so a dead plugin cannot freeze the buttons', () => {
      const old = { ...pending, since: NOW - PENDING_TIMEOUT_MS - 1 };
      const v = view(model(), { pending: old });
      expect(v.pending).toBe(false);
      expect(v.buttons.some((b: { disabled: boolean }) => b.disabled)).toBe(false);
    });
  });

  describe('a plugin that has stopped reporting', () => {
    const stale = () => model({ updatedAt: NOW - PANEL_STALE_MS - 1 });

    it('is flagged, so old information is not mistaken for current', () => {
      const v = view(stale());
      expect(v.stale).toBe(true);
      expect(v.detail).toMatch(/not reported|out of date/i);
    });

    it('cannot be controlled', () => {
      expect(view(stale()).buttons.every((b: { disabled: boolean }) => b.disabled)).toBe(true);
    });

    it('is fine while fresh', () => {
      expect(view(model({ updatedAt: NOW - PANEL_STALE_MS + 1000 })).stale).toBe(false);
    });
  });

  describe('the token row', () => {
    const tok = (required: boolean, present: boolean) => model({ token: { required, present } });

    it('is absent when no token is required', () => {
      expect(view(tok(false, false)).token.visible).toBe(false);
    });

    it('explains itself when required but not created yet, with nothing to click', () => {
      const t = view(tok(true, false)).token;
      expect(t.visible).toBe(true);
      expect(t.canReveal).toBe(false);
      expect(t.canRotate).toBe(false);
      expect(t.hint).toMatch(/created|generated/i);
    });

    it('is masked until asked, and the mask does not reveal the length', () => {
      const t = view(tok(true, true), { token: 'a'.repeat(64) }).token;
      expect(t.visible).toBe(true);
      expect(t.text).toBe(maskToken());
      expect(t.text).not.toContain('a');
      expect(maskToken()).toBe(maskToken('short'));
    });

    it('shows the value once revealed', () => {
      const t = view(tok(true, true), { token: 'f'.repeat(64), revealed: true }).token;
      expect(t.text).toBe('f'.repeat(64));
      expect(t.revealLabel).toBe('Hide');
    });

    it('does not show a revealed token it does not have', () => {
      expect(view(tok(true, true), { revealed: true }).token.text).toBe(maskToken());
    });

    it('asks twice before replacing it', () => {
      const first = view(tok(true, true)).token;
      const second = view(tok(true, true), { confirmRotate: true }).token;
      expect(first.rotateLabel).toBe('New token');
      expect(second.rotateLabel).toMatch(/lock|confirm|really/i);
    });
  });
});

describe('makeControlRequest (009-FR-022)', () => {
  it.each(['restart', 'stop', 'start', 'rotate-token'])('builds a request for %s', (action) => {
    const r = makeControlRequest(action, NOW);
    expect(r).toMatchObject({ action, at: NOW });
    expect(typeof r.id).toBe('string');
    expect(r.id.length).toBeGreaterThan(5);
    expect(r.id.length).toBeLessThanOrEqual(64);
  });

  it('gives each request its own id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeControlRequest('restart', NOW).id));
    expect(ids.size).toBe(50);
  });

  it('refuses an action the plugin would not understand', () => {
    expect(() => makeControlRequest('format-disk', NOW)).toThrow();
  });
});

describe('tokenFromConfig (009-FR-021)', () => {
  it('reads the token the plugin published', () => {
    expect(tokenFromConfig(JSON.stringify({ enabled: true, token: 'e'.repeat(64) }))).toBe('e'.repeat(64));
  });
  it.each([[null], [''], ['{nope'], [JSON.stringify({ enabled: true })], [JSON.stringify({ token: 'short' })], [JSON.stringify({ token: 5 })], [JSON.stringify({ token: 'has space in it, long enough' })]])(
    'returns null for %j',
    (text) => { expect(tokenFromConfig(text as never)).toBeNull(); },
  );
});
