import { describe, it, expect, beforeEach, vi } from 'vitest';
import { instrumentServer, extractOutcome } from '../../../src/recording/instrument.js';
import type { ToolCallEntry, Recorder } from '../../../src/recording/recorder.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { okResult, errorResult } from '../../../src/tools/result.js';

type ToolHandler = (...args: unknown[]) => Promise<unknown>;

let recorded: ToolCallEntry[];
let recorder: Recorder;
let registered: Map<string, ToolHandler>;
let resourceCalls: string[];
let server: McpServer;

beforeEach(() => {
  recorded = [];
  recorder = { record: (e) => { recorded.push(e); } };
  registered = new Map();
  resourceCalls = [];
  server = {
    registerTool: (name: string, _cfg: unknown, handler: ToolHandler) => { registered.set(name, handler); },
    registerResource: (name: string) => { resourceCalls.push(name); },
  } as unknown as McpServer;
});

/** Register a tool through the instrumented server and return its wrapped handler. */
function register(name: string, handler: ToolHandler): ToolHandler {
  instrumentServer(server, recorder).registerTool(name, {}, handler);
  return registered.get(name)!;
}

describe('extractOutcome', () => {
  it('parses the JSON payload out of a successful tool result', () => {
    expect(extractOutcome(okResult({ taskId: 't1' }))).toEqual({ ok: true, result: { taskId: 't1' } });
  });

  it('lifts the message out of an error result', () => {
    expect(extractOutcome(errorResult('Task not found: abc'))).toEqual({ ok: false, error: 'Task not found: abc' });
  });

  it('falls back to raw text when the payload is not JSON', () => {
    const raw = { content: [{ type: 'text', text: 'plain words' }] };
    expect(extractOutcome(raw)).toEqual({ ok: true, result: 'plain words' });
  });

  it('treats an unrecognised shape as a success carrying the whole value', () => {
    expect(extractOutcome({ odd: true })).toEqual({ ok: true, result: { odd: true } });
  });
});

describe('instrumentServer', () => {
  it('records the tool name and a successful outcome', async () => {
    await register('get_tasks', async () => okResult([{ id: '1' }]))({});
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ tool: 'get_tasks', ok: true });
    expect(recorded[0].result).toEqual([{ id: '1' }]);
  });

  it('records the arguments the client sent', async () => {
    await register('log_time', async () => okResult({}))({ task_id: 't1', duration: '1h30m' });
    expect(recorded[0].args).toEqual({ task_id: 't1', duration: '1h30m' });
  });

  it('records an empty object when the tool takes no arguments', async () => {
    await register('stop_task', async () => okResult(null))();
    expect(recorded[0].args).toEqual({});
  });

  it('records an error result as a failure with its message', async () => {
    await register('update_task', async () => errorResult('Task not found: abc'))({});
    expect(recorded[0]).toMatchObject({ ok: false, error: 'Task not found: abc' });
  });

  it('records a thrown handler as a failure and re-throws unchanged', async () => {
    const boom = new Error('plugin exploded');
    const handler = register('create_task', async () => { throw boom; });
    await expect(handler({})).rejects.toBe(boom);
    expect(recorded[0]).toMatchObject({ tool: 'create_task', ok: false, error: 'plugin exploded' });
  });

  it('returns the handler result unchanged (FR-005)', async () => {
    const original = okResult({ deep: { value: 1 } });
    const returned = await register('get_projects', async () => original)({});
    expect(returned).toBe(original);
  });

  it('measures elapsed time', async () => {
    await register('slow_tool', async () => {
      await new Promise(r => setTimeout(r, 25));
      return okResult({});
    })({});
    expect(recorded[0].ms).toBeGreaterThanOrEqual(10);
  });

  it('forwards every argument the SDK passes to the handler', async () => {
    const handler = vi.fn(async () => okResult({}));
    await register('get_tasks', handler)({ a: 1 }, { requestId: 'r1' });
    expect(handler).toHaveBeenCalledWith({ a: 1 }, { requestId: 'r1' });
  });

  it('passes non-tool members through to the underlying server', () => {
    instrumentServer(server, recorder).registerResource('tasks', {} as never, {} as never, (() => {}) as never);
    expect(resourceCalls).toEqual(['tasks']);
  });

  it('does not fail the tool call when recording itself throws', async () => {
    const angry: Recorder = { record: () => { throw new Error('disk full'); } };
    instrumentServer(server, angry).registerTool('get_tags', {}, async () => okResult(['a']));
    await expect(registered.get('get_tags')!({})).resolves.toBeDefined();
  });
});
