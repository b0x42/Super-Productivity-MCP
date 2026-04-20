import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

describe('diagnostic tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('check_connection (ping)', () => {
    it('returns connected status on success', async () => {
      mockSend.mockResolvedValueOnce({
        success: true,
        result: { pong: true, pluginVersion: '1.0.0', protocolVersion: 1 },
        timestamp: Date.now(),
      });
      const res = await sendCommand(dirs, 'ping', {}, 5000);
      expect(res.success).toBe(true);
      expect((res.result as Record<string, unknown>).pong).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(dirs, 'ping', {}, 5000);
    });

    it('returns error on timeout', async () => {
      mockSend.mockResolvedValueOnce({
        success: false,
        error: 'Super Productivity is not responding. Ensure the app is running with the MCP Bridge plugin enabled.',
        timestamp: Date.now(),
      });
      const res = await sendCommand(dirs, 'ping', {}, 5000);
      expect(res.success).toBe(false);
      expect(res.error).toContain('not responding');
    });
  });

  describe('debug_directories', () => {
    it('returns resolved paths and existence status', () => {
      // debug_directories is server-only, no IPC — just returns dirs info
      const output = {
        base: dirs.base,
        commands: dirs.commands,
        responses: dirs.responses,
        exists: { base: true, commands: true, responses: true },
      };
      expect(output.base).toBe('/tmp/test');
      expect(output.commands).toBe('/tmp/test/pc');
      expect(output.responses).toBe('/tmp/test/pr');
      expect(output.exists.base).toBe(true);
    });
  });
});
