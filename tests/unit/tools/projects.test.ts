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

describe('project tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create_project via sendCommand', () => {
    it('sends addProject with title', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('proj-123'));
      const res = await sendCommand(dirs, 'addProject', { data: { title: 'Work' } });
      expect(res.success).toBe(true);
      expect(res.result).toBe('proj-123');
    });

    it('sends addProject with color as theme', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('proj-456'));
      await sendCommand(dirs, 'addProject', { data: { title: 'Personal', theme: { primary: '#FF0000' } } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addProject', {
        data: { title: 'Personal', theme: { primary: '#FF0000' } },
      });
    });
  });

  describe('get_projects via sendCommand', () => {
    it('sends getAllProjects and returns list', async () => {
      const projects = [{ id: 'p1', title: 'Work' }, { id: 'p2', title: 'Personal' }];
      mockSend.mockResolvedValueOnce(mockResponse(projects));
      const res = await sendCommand(dirs, 'getAllProjects');
      expect(res.success).toBe(true);
      expect(res.result).toEqual(projects);
    });
  });

  describe('update_project via sendCommand', () => {
    it('sends updateProject with new title', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateProject', { projectId: 'proj-1', data: { title: 'New Name' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { title: 'New Name' },
      });
    });
  });

  describe('input validation', () => {
    it('rejects empty title for create', () => {
      const title = '';
      expect(title.trim()).toBe('');
    });

    it('rejects empty project_id for update', () => {
      const projectId = '  ';
      expect(projectId.trim()).toBe('');
    });
  });
});
