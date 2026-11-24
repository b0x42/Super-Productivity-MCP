import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { errorResult, okResult } from './result.js';

export type AttachmentType = 'LINK' | 'FILE' | 'IMG';

/** SP's TaskAttachment shape, as PluginAPI.updateTask validates it. */
export interface TaskAttachment {
  id: string;
  type: AttachmentType;
  path: string;
  title?: string;
  icon?: string;
}

// The icons SP itself assigns when it turns a URL in a task title into an attachment.
const ICONS: Record<AttachmentType, string> = {
  LINK: 'bookmark',
  FILE: 'insert_drive_file',
  IMG: 'image',
};

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const IMAGE_URL = /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?(#.*)?$/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

/**
 * Turn the caller's path/URL into the attachment SP stores, or an error message.
 * Exported for testability.
 *
 * - `https://…` and other `scheme://` URLs become LINK, or IMG for an http(s) image URL
 *   (the same rule SP applies to URLs in task titles).
 * - Absolute local paths become FILE. `~/` is expanded and `file://` URLs are converted
 *   to plain paths, because SP's desktop app opens FILE attachments with
 *   `openPath(path)`, which takes a filesystem path, not a URL.
 * - Relative paths are rejected: SP has no working directory to resolve them against.
 */
export function buildAttachment(
  input: { path: string; type?: AttachmentType; title?: string },
  opts: { home?: string; newId?: () => string } = {},
): { attachment: TaskAttachment } | { error: string } {
  if (!input.path.trim()) return { error: 'path is required' };
  const path = normalizePath(input.path, opts.home);
  if (path === null) return { error: `Invalid file:// URL "${input.path}"` };

  const isUrl = URL_SCHEME.test(path);
  const isLocalAbsolute = !isUrl && (isAbsolute(path) || WINDOWS_ABSOLUTE.test(path));
  if (!isUrl && !isLocalAbsolute) {
    return { error: `"${input.path}" is neither a URL nor an absolute file path. Pass an absolute path (e.g. /home/me/doc.pdf or ~/doc.pdf) or a full URL (https://…).` };
  }

  const inferred: AttachmentType = isUrl ? (IMAGE_URL.test(path) ? 'IMG' : 'LINK') : 'FILE';
  const type = input.type ?? inferred;
  if (type === 'FILE' && !isLocalAbsolute) {
    return { error: `type FILE needs an absolute local path, got the URL "${input.path}". Use type LINK for URLs.` };
  }
  if (type !== 'FILE' && !isUrl) {
    return { error: `type ${type} needs a URL, got the local path "${input.path}". Use type FILE (or omit type) for local files.` };
  }

  const title = input.title?.trim() || defaultTitle(path, isUrl);
  return {
    attachment: {
      id: (opts.newId ?? randomUUID)(),
      type,
      path,
      title,
      icon: ICONS[type],
    },
  };
}

/** Expand `~/` and convert `file://` URLs to plain paths; null for a malformed file:// URL. */
export function normalizePath(raw: string, home: string = homedir()): string | null {
  let path = raw.trim();
  if (path === '~' || path.startsWith('~/')) path = join(home, path.slice(1));
  if (/^file:\/\//i.test(path)) {
    try {
      path = fileURLToPath(path);
    } catch {
      return null;
    }
  }
  return path;
}

function defaultTitle(path: string, isUrl: boolean): string {
  if (isUrl) {
    try {
      const u = new URL(path);
      const tail = u.pathname.split('/').filter(Boolean).pop();
      return tail ? `${u.hostname}/…/${decodeURIComponent(tail)}` : u.hostname || path;
    } catch {
      return path;
    }
  }
  return basename(path.replace(/[\\/]+$/, '')) || path;
}

const attachmentTypeSchema = z.enum(['LINK', 'FILE', 'IMG']);

const addTaskAttachmentShape = {
  task_id: z.string().describe('Task ID to attach to'),
  path: z.string().describe('What to attach: an absolute local file or folder path (/home/me/report.pdf, ~/notes/plan.md, file:///…) or a URL (https://…).'),
  type: attachmentTypeSchema.optional().describe('Attachment type. Omit to infer: URLs become LINK (IMG for http(s) image URLs), local paths become FILE.'),
  title: z.string().optional().describe('Display title. Defaults to the file name, or a short form of the URL.'),
};
export const addTaskAttachmentSchema = z.object(addTaskAttachmentShape).strict();

const removeTaskAttachmentShape = {
  task_id: z.string().describe('Task ID'),
  attachment_id: z.string().optional().describe('ID of the attachment to remove (from add_task_attachment or the task\'s `attachments` in get_tasks)'),
  path: z.string().optional().describe('Alternatively, the attached path/URL exactly as stored. Pass attachment_id or path, not both.'),
};
export const removeTaskAttachmentSchema = z.object(removeTaskAttachmentShape).strict();

export function registerAttachmentTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool(
    'add_task_attachment',
    {
      description: 'Attach a local file/folder or a link to a task, so it shows up in the task\'s attachment list in Super Productivity (clickable: files open in their default app on the desktop). Use this instead of pasting paths or URLs into notes. Idempotent: attaching a path the task already has returns the existing attachment. Read attachments back via the `attachments` field of get_tasks.',
      inputSchema: addTaskAttachmentSchema,
    },
    async ({ task_id, path, type, title }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      const built = buildAttachment({ path, type, title });
      if ('error' in built) return errorResult(built.error);
      const { attachment } = built;

      const res = await sendCommand(dirs, 'addTaskAttachment', { taskId: task_id, data: { attachment } });
      if (!res.success) return errorResult(res.error ?? 'Failed to add attachment');

      const out: Record<string, unknown> = { ...(res.result as Record<string, unknown>) };
      // Not fatal: the file may be created later, or live on a mount that is offline now.
      if (attachment.type === 'FILE' && !existsSync(attachment.path)) {
        out.warning = `Nothing exists at ${attachment.path} on this machine yet; the attachment was added anyway.`;
      }
      return okResult(out);
    },
  );

  server.registerTool(
    'remove_task_attachment',
    {
      description: 'Remove one attachment from a task, by attachment_id or by its path/URL. Returns an error if the task has no such attachment. Only removes the attachment entry, never the file itself.',
      inputSchema: removeTaskAttachmentSchema,
    },
    async ({ task_id, attachment_id, path }) => {
      if (!task_id?.trim()) return errorResult('task_id is required');
      if (!attachment_id === !path) return errorResult('Pass exactly one of attachment_id or path');
      let data: Record<string, string>;
      if (attachment_id) {
        data = { attachmentId: attachment_id };
      } else {
        // Same normalisation as add_task_attachment, so `~/x.pdf` finds what `~/x.pdf` added.
        const normalised = normalizePath(path as string);
        if (normalised === null) return errorResult(`Invalid file:// URL "${path}"`);
        data = { path: normalised };
      }
      const res = await sendCommand(dirs, 'removeTaskAttachment', { taskId: task_id, data });
      if (!res.success) return errorResult(res.error ?? 'Failed to remove attachment');
      return okResult(res.result);
    },
  );
}
