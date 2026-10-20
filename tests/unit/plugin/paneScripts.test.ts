import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_PANE_SCRIPT, READ_TOKEN_SCRIPT, WRITE_CONTROL_SCRIPT } from '../../../plugin/dashboard.js';
import { modeFor, runLikeSp } from './helpers/spExecutor.js';

// Not os.tmpdir(): the scripts (like the plugin) refuse a data dir under /tmp, which is where many CI runners put it.
const repoNodeModules = fileURLToPath(new URL('../../../node_modules/', import.meta.url));

// The pane's file access goes through executeNodeScript. SP runs a script in a restricted vm sandbox
// (fs/path/os only, no `process`) unless it contains one of its trigger words, so these must work there
// and must not accidentally trip the heavyweight real-process mode every 2 seconds.

describe('the pane scripts, as SP will run them (009-SC-006)', () => {
  let home: string;
  let dataDir: string;
  const realHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(repoNodeModules, '.sp-pane-test-'));
    process.env.HOME = home;
    dataDir = join(home, '.local', 'share', 'super-productivity-mcp');
    mkdirSync(dataDir, { recursive: true });
  });
  afterEach(() => {
    process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  const run = async (script: string, args: unknown[] = []) => runLikeSp(script, args) as Promise<any>;

  it.each([['read pane', READ_PANE_SCRIPT], ['read token', READ_TOKEN_SCRIPT], ['write control', WRITE_CONTROL_SCRIPT]])(
    '%s runs in the cheap sandbox mode',
    (_n, script) => { expect(modeFor(script)).toBe('vm'); },
  );

  describe('READ_PANE_SCRIPT', () => {
    it('returns the log and the panel from the same data dir', async () => {
      writeFileSync(join(dataDir, 'tool-calls.jsonl'), '{"tool":"a"}\n');
      writeFileSync(join(dataDir, 'http_panel.json'), '{"version":1}');
      const r = await run(READ_PANE_SCRIPT);
      expect(r.dir).toBe(dataDir);
      expect(r.log).toBe('{"tool":"a"}\n');
      expect(r.panel).toBe('{"version":1}');
    });

    it('works with only one of them present', async () => {
      writeFileSync(join(dataDir, 'http_panel.json'), '{"version":1}');
      const r = await run(READ_PANE_SCRIPT);
      expect(r.panel).toBe('{"version":1}');
      expect(r.log).toBeNull();
    });

    it('reports nothing when there is no data dir content yet (and creates nothing)', async () => {
      const r = await run(READ_PANE_SCRIPT);
      expect(r).toMatchObject({ dir: null, log: null, panel: null });
    });

    it('follows an SP_MCP_DATA_DIR override recorded in mcp_config.json', async () => {
      const other = join(home, 'elsewhere');
      mkdirSync(other);
      writeFileSync(join(dataDir, 'mcp_config.json'), JSON.stringify({ dataDir: other }));
      writeFileSync(join(other, 'http_panel.json'), '{"version":1}');
      writeFileSync(join(dataDir, 'http_panel.json'), '{"version":"decoy"}');
      const r = await run(READ_PANE_SCRIPT);
      expect(r.dir).toBe(other);
      expect(r.panel).toBe('{"version":1}');
    });
  });

  describe('WRITE_CONTROL_SCRIPT', () => {
    const request = JSON.stringify({ id: 'r1', action: 'restart', at: 1 });

    it('writes the request next to the panel the plugin publishes, owner-only', async () => {
      writeFileSync(join(dataDir, 'http_panel.json'), '{}');
      const r = await run(WRITE_CONTROL_SCRIPT, [request]);
      expect(r.success).toBe(true);
      expect(readFileSync(join(dataDir, 'http_control.json'), 'utf-8')).toBe(request);
      expect(statSync(join(dataDir, 'http_control.json')).mode & 0o777).toBe(0o600);
    });

    it('leaves no temp file behind', async () => {
      writeFileSync(join(dataDir, 'http_panel.json'), '{}');
      await run(WRITE_CONTROL_SCRIPT, [request]);
      const { readdirSync } = await import('node:fs');
      expect(readdirSync(dataDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('refuses, rather than invent a location, when the plugin has published nothing', async () => {
      const r = await run(WRITE_CONTROL_SCRIPT, [request]);
      expect(r.success).toBe(false);
      expect(existsSync(join(dataDir, 'http_control.json'))).toBe(false);
    });
  });

  describe('READ_TOKEN_SCRIPT', () => {
    it('returns the token from the published config', async () => {
      writeFileSync(join(dataDir, 'http_panel.json'), '{}');
      writeFileSync(join(dataDir, 'http_config.json'), JSON.stringify({ enabled: true, token: 'c'.repeat(64) }));
      expect((await run(READ_TOKEN_SCRIPT)).text).toContain('c'.repeat(64));
    });

    it('returns nothing when there is no config', async () => {
      writeFileSync(join(dataDir, 'http_panel.json'), '{}');
      expect((await run(READ_TOKEN_SCRIPT)).text).toBeNull();
    });
  });
});
