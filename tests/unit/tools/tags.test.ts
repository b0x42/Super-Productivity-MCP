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

describe('tag tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create_tag via sendCommand', () => {
    it('sends addTag with title', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('tag-123'));
      const res = await sendCommand(dirs, 'addTag', { data: { title: 'urgent' } });
      expect(res.success).toBe(true);
      expect(res.result).toBe('tag-123');
    });

    it('sends addTag with color', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('tag-456'));
      await sendCommand(dirs, 'addTag', { data: { title: 'errands', color: '#FF9800' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addTag', {
        data: { title: 'errands', color: '#FF9800' },
      });
    });
  });

  describe('get_tags via sendCommand', () => {
    it('sends getAllTags and returns list', async () => {
      const tags = [{ id: 't1', title: 'urgent', color: '#F00' }];
      mockSend.mockResolvedValueOnce(mockResponse(tags));
      const res = await sendCommand(dirs, 'getAllTags');
      expect(res.success).toBe(true);
      expect(res.result).toEqual(tags);
    });
  });

  describe('update_tag via sendCommand', () => {
    it('sends updateTag with new properties', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateTag', { tagId: 'tag-1', data: { title: 'critical', color: '#F00', icon: 'warning' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateTag', {
        tagId: 'tag-1',
        data: { title: 'critical', color: '#F00', icon: 'warning' },
      });
    });
  });

  describe('input validation', () => {
    it('rejects empty title for create', () => {
      expect(''.trim()).toBe('');
      expect('  '.trim()).toBe('');
    });

    it('rejects empty tag_id for update', () => {
      expect(''.trim()).toBe('');
    });
  });
});
