import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../../../plugin/plugin.js';

// executeCommand reads the global PluginAPI SP injects at runtime; tests stub it directly.
type Stub = ReturnType<typeof vi.fn>;
const api = () => globalThis.PluginAPI as unknown as { updateTask: Stub; getTasks: Stub; getArchivedTasks?: Stub };

const fileAtt = { id: 'new-1', type: 'FILE', path: '/home/me/a.pdf', title: 'a.pdf', icon: 'insert_drive_file' };
const linkAtt = { id: 'old-1', type: 'LINK', path: 'https://x.org', title: 'x.org', icon: 'bookmark' };

function setTasks(tasks: unknown[], archived: unknown[] = []) {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    addTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(undefined),
    getTasks: vi.fn().mockResolvedValue(tasks),
    getArchivedTasks: vi.fn().mockResolvedValue(archived),
  };
}

describe('executeCommand: addTaskAttachment', () => {
  beforeEach(() => setTasks([{ id: 't1', title: 'T', attachments: [linkAtt] }, { id: 't2', title: 'No attachments field' }]));

  it('appends to the existing attachments instead of replacing them', async () => {
    const res = await executeCommand({ action: 'addTaskAttachment', taskId: 't1', data: { attachment: fileAtt } });
    expect(res.success).toBe(true);
    expect(api().updateTask).toHaveBeenCalledWith('t1', { attachments: [linkAtt, fileAtt] });
    expect(res.result).toEqual({ attachmentId: 'new-1', attachment: fileAtt, alreadyAttached: false });
  });

  it('works on a task without an attachments field', async () => {
    await executeCommand({ action: 'addTaskAttachment', taskId: 't2', data: { attachment: fileAtt } });
    expect(api().updateTask).toHaveBeenCalledWith('t2', { attachments: [fileAtt] });
  });

  it('is idempotent per path: returns the existing attachment and writes nothing', async () => {
    const res = await executeCommand({
      action: 'addTaskAttachment', taskId: 't1', data: { attachment: { ...linkAtt, id: 'other-id', title: 'dup' } },
    });
    expect(res.success).toBe(true);
    expect(api().updateTask).not.toHaveBeenCalled();
    expect(res.result).toEqual({ attachmentId: 'old-1', attachment: linkAtt, alreadyAttached: true });
  });

  it('sends only the TaskAttachment fields SP validates', async () => {
    await executeCommand({ action: 'addTaskAttachment', taskId: 't2', data: { attachment: { ...fileAtt, extra: 'x' } } });
    expect(api().updateTask).toHaveBeenCalledWith('t2', { attachments: [fileAtt] });
  });

  it('reports a missing task', async () => {
    const res = await executeCommand({ action: 'addTaskAttachment', taskId: 'nope', data: { attachment: fileAtt } });
    expect(res).toMatchObject({ success: false, error: 'Task not found: nope' });
  });

  it('names an archived task as archived', async () => {
    setTasks([], [{ id: 'arch' }]);
    const res = await executeCommand({ action: 'addTaskAttachment', taskId: 'arch', data: { attachment: fileAtt } });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/archived/);
  });

  it('rejects a malformed attachment', async () => {
    const res = await executeCommand({ action: 'addTaskAttachment', taskId: 't1', data: { attachment: { path: '' } } });
    expect(res.success).toBe(false);
    expect(api().updateTask).not.toHaveBeenCalled();
  });
});

describe('executeCommand: removeTaskAttachment', () => {
  beforeEach(() => setTasks([{ id: 't1', title: 'T', attachments: [linkAtt, fileAtt] }]));

  it('removes by id and keeps the rest', async () => {
    const res = await executeCommand({ action: 'removeTaskAttachment', taskId: 't1', data: { attachmentId: 'old-1' } });
    expect(res.success).toBe(true);
    expect(api().updateTask).toHaveBeenCalledWith('t1', { attachments: [fileAtt] });
    expect(res.result).toEqual({ removed: [linkAtt] });
  });

  it('removes by path', async () => {
    await executeCommand({ action: 'removeTaskAttachment', taskId: 't1', data: { path: '/home/me/a.pdf' } });
    expect(api().updateTask).toHaveBeenCalledWith('t1', { attachments: [linkAtt] });
  });

  it('errors when the task has no such attachment, without writing', async () => {
    const res = await executeCommand({ action: 'removeTaskAttachment', taskId: 't1', data: { attachmentId: 'zzz' } });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no attachment with id zzz/);
    expect(api().updateTask).not.toHaveBeenCalled();
  });

  it('reports a missing task', async () => {
    const res = await executeCommand({ action: 'removeTaskAttachment', taskId: 'nope', data: { attachmentId: 'old-1' } });
    expect(res).toMatchObject({ success: false, error: 'Task not found: nope' });
  });
});
