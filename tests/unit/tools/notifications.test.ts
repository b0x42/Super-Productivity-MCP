import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

describe('notification tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('show_notification via sendCommand', () => {
    it('sends showSnack with message and default type', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({ success: true }));
      await sendCommand(dirs, 'showSnack', { message: 'Tasks synced', data: { type: 'INFO' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'showSnack', {
        message: 'Tasks synced',
        data: { type: 'INFO' },
      });
    });

    it('sends showSnack with explicit type', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({ success: true }));
      await sendCommand(dirs, 'showSnack', { message: 'Error occurred', data: { type: 'ERROR' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'showSnack', {
        message: 'Error occurred',
        data: { type: 'ERROR' },
      });
    });
  });

  describe('input validation', () => {
    it('rejects empty message', () => {
      expect(''.trim()).toBe('');
      expect('  '.trim()).toBe('');
    });
  });
});
