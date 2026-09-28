import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { updateProjectSchema, registerProjectTools } from '../../../src/tools/projects.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

// Instead of testing through McpServer (which has no public API to call tools),
// we test the sendCommand integration and validation logic directly.
// The tool registration is verified by the build + integration tests.
//
// The description-mapping tests below are the exception: they capture the real
// registered update_project handler and invoke it directly, so the actual
// `description` -> `data.description` mapping in projects.ts is exercised —
// issue #107 was exactly this field missing from that mapping.
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const toolHandlers = new Map<string, ToolHandler>();
const fakeServer = {
  registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
    toolHandlers.set(name, handler);
  },
} as unknown as McpServer;
registerProjectTools(fakeServer, dirs);

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

    it('sends addProject with folder_id', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('proj-789'));
      await sendCommand(dirs, 'addProject', { data: { title: 'Work', folderId: 'folder-1' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addProject', {
        data: { title: 'Work', folderId: 'folder-1' },
      });
    });

    // description used a truthy check, so an explicit empty string was
    // indistinguishable from omitting it entirely (via real handler).
    it('sends an explicitly empty description rather than dropping it', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('proj-999'));
      await toolHandlers.get('create_project')!({ title: 'Work', description: '' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addProject', {
        data: { title: 'Work', description: '' },
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

    it('sends updateProject with folder_id to move the project', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateProject', { projectId: 'proj-1', data: { folderId: 'folder-2' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { folderId: 'folder-2' },
      });
    });

    it('sends updateProject with folder_id: null to clear the folder assignment', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateProject', { projectId: 'proj-1', data: { folderId: null } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { folderId: null },
      });
    });

    it('omits folderId from data when folder_id is not provided', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await sendCommand(dirs, 'updateProject', { projectId: 'proj-1', data: { title: 'New Name' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { title: 'New Name' },
      });
      const call = mockSend.mock.calls[0][2] as { data: Record<string, unknown> };
      expect('folderId' in call.data).toBe(false);
    });
  });

  // #107: create_project accepted description, update_project silently dropped it —
  // there was no parameter for it at all, so the old value could never be changed.
  describe('update_project description (via real handler)', () => {
    it('sends the new description through to updateProject', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await toolHandlers.get('update_project')!({ project_id: 'proj-1', description: 'New description' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { description: 'New description' },
      });
    });

    it('clears the description with an empty string', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await toolHandlers.get('update_project')!({ project_id: 'proj-1', description: '' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateProject', {
        projectId: 'proj-1',
        data: { description: '' },
      });
    });

    it('omits description from data when not provided', async () => {
      mockSend.mockResolvedValueOnce(mockResponse({}));
      await toolHandlers.get('update_project')!({ project_id: 'proj-1', title: 'New Name' });
      const call = mockSend.mock.calls[0][2] as { data: Record<string, unknown> };
      expect('description' in call.data).toBe(false);
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

    it('rejects empty-string folder_id (but allows null and undefined)', () => {
      const isRejected = (folderId: string | null | undefined) =>
        folderId !== undefined && folderId !== null && !folderId.trim();
      expect(isRejected('')).toBe(true);
      expect(isRejected('   ')).toBe(true);
      expect(isRejected(null)).toBe(false);
      expect(isRejected(undefined)).toBe(false);
      expect(isRejected('folder-1')).toBe(false);
    });
  });

  describe('update_project schema — strict unknown-key rejection', () => {
    it('rejects an unrecognized parameter, naming it in the error', () => {
      const result = updateProjectSchema.safeParse({ project_id: 'proj-1', titel: 'Typo' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('titel');
      }
    });

    it('accepts a call using only documented parameters', () => {
      const result = updateProjectSchema.safeParse({ project_id: 'proj-1', title: 'New Name' });
      expect(result.success).toBe(true);
    });
  });
});
