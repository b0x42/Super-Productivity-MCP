import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import {
  buildAttachment,
  normalizePath,
  addTaskAttachmentSchema,
  removeTaskAttachmentSchema,
  registerAttachmentTools,
} from '../../../src/tools/attachments.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const toolHandlers = new Map<string, ToolHandler>();
const fakeServer = {
  registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
    toolHandlers.set(name, handler);
  },
} as unknown as McpServer;
registerAttachmentTools(fakeServer, dirs);

const opts = { home: '/home/me', newId: () => 'att-1' };
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

describe('buildAttachment', () => {
  it('turns an absolute path into a FILE attachment titled with the file name', () => {
    expect(buildAttachment({ path: '/home/me/docs/report.pdf' }, opts)).toEqual({
      attachment: { id: 'att-1', type: 'FILE', path: '/home/me/docs/report.pdf', title: 'report.pdf', icon: 'insert_drive_file' },
    });
  });

  it('expands ~/ against the home directory', () => {
    const r = buildAttachment({ path: '~/notes/plan.md' }, opts);
    expect(r).toMatchObject({ attachment: { type: 'FILE', path: '/home/me/notes/plan.md', title: 'plan.md' } });
  });

  it('converts file:// URLs to plain paths (SP opens FILE attachments with openPath)', () => {
    const r = buildAttachment({ path: 'file:///home/me/My%20Docs/a.txt' }, opts);
    expect(r).toMatchObject({ attachment: { type: 'FILE', path: '/home/me/My Docs/a.txt', title: 'a.txt' } });
  });

  it('titles a folder with its last segment, ignoring a trailing slash', () => {
    expect(buildAttachment({ path: '/srv/projects/thesis/' }, opts)).toMatchObject({ attachment: { type: 'FILE', title: 'thesis' } });
  });

  it('accepts Windows absolute paths as FILE', () => {
    expect(buildAttachment({ path: 'C:\\Users\\me\\a.docx' }, opts)).toMatchObject({ attachment: { type: 'FILE' } });
  });

  it('turns an https URL into a LINK with SP\'s bookmark icon', () => {
    expect(buildAttachment({ path: 'https://example.com/spec/v2' }, opts)).toEqual({
      attachment: { id: 'att-1', type: 'LINK', path: 'https://example.com/spec/v2', title: 'example.com/…/v2', icon: 'bookmark' },
    });
  });

  it('uses the host as title for a bare-domain URL', () => {
    expect(buildAttachment({ path: 'https://example.com' }, opts)).toMatchObject({ attachment: { title: 'example.com' } });
  });

  it('infers IMG for an http(s) image URL, like SP does for URLs in titles', () => {
    expect(buildAttachment({ path: 'https://example.com/a/shot.PNG?x=1' }, opts)).toMatchObject({ attachment: { type: 'IMG', icon: 'image' } });
  });

  it('keeps an explicit title and type', () => {
    expect(buildAttachment({ path: 'https://example.com/a.png', type: 'LINK', title: 'Mockup' }, opts))
      .toMatchObject({ attachment: { type: 'LINK', title: 'Mockup', icon: 'bookmark' } });
  });

  it('rejects relative paths', () => {
    const r = buildAttachment({ path: 'docs/report.pdf' }, opts);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/absolute/);
  });

  it('rejects an empty path', () => {
    expect(buildAttachment({ path: '  ' }, opts)).toEqual({ error: 'path is required' });
  });

  it('rejects type FILE with a URL and type LINK/IMG with a local path', () => {
    expect(buildAttachment({ path: 'https://x.org', type: 'FILE' }, opts)).toHaveProperty('error');
    expect(buildAttachment({ path: '/tmp/a', type: 'LINK' }, opts)).toHaveProperty('error');
    expect(buildAttachment({ path: '/tmp/a.png', type: 'IMG' }, opts)).toHaveProperty('error');
  });

  it('generates a fresh id per attachment by default', () => {
    const a = buildAttachment({ path: '/tmp/a' });
    const b = buildAttachment({ path: '/tmp/a' });
    expect('attachment' in a && 'attachment' in b && a.attachment.id !== b.attachment.id).toBe(true);
  });
});

describe('normalizePath', () => {
  it('leaves URLs and absolute paths alone', () => {
    expect(normalizePath('https://x.org/a', '/h')).toBe('https://x.org/a');
    expect(normalizePath(' /a/b ', '/h')).toBe('/a/b');
  });
  it('expands bare ~', () => {
    expect(normalizePath('~', '/h')).toBe('/h');
  });
});

describe('schemas', () => {
  it('reject unknown keys', () => {
    expect(addTaskAttachmentSchema.safeParse({ task_id: 't', path: '/a', url: 'x' }).success).toBe(false);
    expect(removeTaskAttachmentSchema.safeParse({ task_id: 't', id: 'x' }).success).toBe(false);
  });
  it('reject an unknown attachment type', () => {
    expect(addTaskAttachmentSchema.safeParse({ task_id: 't', path: '/a', type: 'COMMAND' }).success).toBe(false);
  });
});

describe('add_task_attachment handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the built attachment to the plugin and returns its result', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { attachmentId: 'x', alreadyAttached: false }, timestamp: 0 });
    const res = await toolHandlers.get('add_task_attachment')!({ task_id: 'task-1', path: 'https://example.com/doc' });
    expect(mockSend).toHaveBeenCalledWith(dirs, 'addTaskAttachment', {
      taskId: 'task-1',
      data: { attachment: expect.objectContaining({ type: 'LINK', path: 'https://example.com/doc', icon: 'bookmark' }) },
    });
    expect(res.isError).toBeUndefined();
    expect(parse(res)).toEqual({ attachmentId: 'x', alreadyAttached: false });
  });

  it('warns, but still attaches, when the local file does not exist', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { attachmentId: 'x' }, timestamp: 0 });
    const res = await toolHandlers.get('add_task_attachment')!({ task_id: 'task-1', path: '/definitely/not/here.pdf' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(parse(res).warning).toMatch(/Nothing exists/);
  });

  it('does not warn for an existing file', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { attachmentId: 'x' }, timestamp: 0 });
    const res = await toolHandlers.get('add_task_attachment')!({ task_id: 'task-1', path: '/' });
    expect(parse(res).warning).toBeUndefined();
  });

  it('validates before sending anything', async () => {
    const res = await toolHandlers.get('add_task_attachment')!({ task_id: 'task-1', path: 'relative.txt' });
    expect(res.isError).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('passes plugin errors through', async () => {
    mockSend.mockResolvedValueOnce({ success: false, error: 'Task not found: nope', timestamp: 0 });
    const res = await toolHandlers.get('add_task_attachment')!({ task_id: 'nope', path: 'https://x.org' });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('Task not found: nope');
  });
});

describe('remove_task_attachment handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes by attachment_id', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { removed: [] }, timestamp: 0 });
    await toolHandlers.get('remove_task_attachment')!({ task_id: 't', attachment_id: 'a1' });
    expect(mockSend).toHaveBeenCalledWith(dirs, 'removeTaskAttachment', { taskId: 't', data: { attachmentId: 'a1' } });
  });

  it('removes by path, normalised the same way as on add', async () => {
    mockSend.mockResolvedValueOnce({ success: true, result: { removed: [] }, timestamp: 0 });
    await toolHandlers.get('remove_task_attachment')!({ task_id: 't', path: 'file:///tmp/a%20b.txt' });
    expect(mockSend).toHaveBeenCalledWith(dirs, 'removeTaskAttachment', { taskId: 't', data: { path: '/tmp/a b.txt' } });
  });

  it('requires exactly one of attachment_id and path', async () => {
    const none = await toolHandlers.get('remove_task_attachment')!({ task_id: 't' });
    const both = await toolHandlers.get('remove_task_attachment')!({ task_id: 't', attachment_id: 'a', path: '/x' });
    expect(none.isError).toBe(true);
    expect(both.isError).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
