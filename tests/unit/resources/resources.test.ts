import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { registerResources } from '../../../src/resources/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

function errorResponse(error: string): Response {
  return { success: false, error, timestamp: Date.now() };
}

// Capture registered resource callbacks
type ResourceCallback = (uri: URL) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>;
const registeredResources: Record<string, ResourceCallback> = {};

const mockServer = {
  registerResource: vi.fn((name: string, _uri: string, _config: unknown, cb: ResourceCallback) => {
    registeredResources[name] = cb;
  }),
} as unknown as McpServer;

describe('MCP Resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredResources).forEach(k => delete registeredResources[k]);
    registerResources(mockServer, dirs);
  });

  it('registers all 4 resources', () => {
    expect(mockServer.registerResource).toHaveBeenCalledTimes(4);
    expect(registeredResources['sp-projects']).toBeDefined();
    expect(registeredResources['sp-tags']).toBeDefined();
    expect(registeredResources['sp-tasks-today']).toBeDefined();
    expect(registeredResources['sp-tasks-overdue']).toBeDefined();
  });

  describe('sp://projects', () => {
    it('returns shaped project data', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([
        { id: 'p1', title: 'Work', theme: { primary: '#2196F3' }, taskIds: ['t1'] },
        { id: 'p2', title: 'Personal', theme: { primary: '#4CAF50' }, taskIds: [] },
      ]));
      const result = await registeredResources['sp-projects'](new URL('sp://projects'));
      const data = JSON.parse(result.contents[0].text);
      expect(data).toEqual([
        { id: 'p1', title: 'Work', color: '#2196F3' },
        { id: 'p2', title: 'Personal', color: '#4CAF50' },
      ]);
    });

    it('throws on IPC error', async () => {
      mockSend.mockResolvedValueOnce(errorResponse('SP not running'));
      await expect(registeredResources['sp-projects'](new URL('sp://projects'))).rejects.toThrow('SP not running');
    });
  });

  describe('sp://tags', () => {
    it('returns shaped tag data', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([
        { id: 't1', title: 'urgent', theme: { primary: '#FF5722' }, icon: 'warning' },
        { id: 't2', title: 'backlog', color: '#999', icon: null },
      ]));
      const result = await registeredResources['sp-tags'](new URL('sp://tags'));
      const data = JSON.parse(result.contents[0].text);
      expect(data).toEqual([
        { id: 't1', title: 'urgent', color: '#FF5722', icon: 'warning' },
        { id: 't2', title: 'backlog', color: '#999', icon: null },
      ]);
    });
  });

  describe('sp://tasks/today', () => {
    it('returns only tasks planned for today', async () => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      mockSend.mockResolvedValueOnce(mockResponse([
        { id: '1', title: 'Today task', projectId: 'p1', tagIds: [], plannedAt: startOfToday + 3600000, timeEstimate: 0, timeSpent: 0 },
        { id: '2', title: 'No plan', projectId: 'p1', tagIds: [], plannedAt: null, timeEstimate: 0, timeSpent: 0 },
      ]));
      const result = await registeredResources['sp-tasks-today'](new URL('sp://tasks/today'));
      const data = JSON.parse(result.contents[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('1');
    });
  });

  describe('sp://tasks/overdue', () => {
    it('returns only tasks with due date before today', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([
        { id: '1', title: 'Overdue', projectId: null, tagIds: [], dueDay: '2020-01-01', timeEstimate: 0, timeSpent: 0 },
        { id: '2', title: 'Future', projectId: null, tagIds: [], dueDay: '2099-12-31', timeEstimate: 0, timeSpent: 0 },
        { id: '3', title: 'No due', projectId: null, tagIds: [], timeEstimate: 0, timeSpent: 0 },
      ]));
      const result = await registeredResources['sp-tasks-overdue'](new URL('sp://tasks/overdue'));
      const data = JSON.parse(result.contents[0].text);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('1');
    });
  });
});
