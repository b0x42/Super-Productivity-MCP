import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Recorder } from './recorder.js';

/**
 * Recording wraps tool registration rather than the IPC layer. The IPC layer
 * only sees plugin actions — `get_worklog` and `log_time` both send `getTasks`,
 * and several tools send more than one command — so an IPC-level record could
 * not name the tool the client actually called.
 */

interface ToolResultShape {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
}

export interface Outcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Unwrap an MCP tool result into what belongs in the log. Tool results carry
 * their payload as JSON inside a text content block; storing that envelope raw
 * would make the pane show escaped JSON instead of the data.
 */
export function extractOutcome(value: unknown): Outcome {
  const shaped = value as ToolResultShape;
  const text = shaped?.content?.[0]?.text;
  if (typeof text !== 'string') return { ok: true, result: value };

  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Not JSON — keep the raw text rather than losing it.
  }

  if (shaped.isError) {
    const message = (payload as { error?: unknown })?.error;
    return { ok: false, error: typeof message === 'string' ? message : text };
  }
  return { ok: true, result: payload };
}

type ToolHandler = (...args: unknown[]) => Promise<unknown>;

/**
 * Return a server that records every tool call. Non-tool members (resources,
 * connect, …) pass straight through, so this is transparent to the seven
 * `register*Tools` functions and needs no per-tool changes.
 */
export function instrumentServer(server: McpServer, recorder: Recorder): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (name: string, config: unknown, handler: ToolHandler) => {
        const wrapped = async (...callArgs: unknown[]): Promise<unknown> => {
          const started = Date.now();
          const args = callArgs[0] ?? {};

          const write = (outcome: Outcome) => {
            try {
              recorder.record({ ts: started, tool: name, args, ms: Date.now() - started, ...outcome });
            } catch {
              // A recorder is contracted not to throw, but the tool call must
              // survive one that does regardless (FR-004).
            }
          };

          try {
            const result = await handler(...callArgs);
            write(extractOutcome(result));
            return result;
          } catch (err) {
            write({ ok: false, error: err instanceof Error ? err.message : String(err) });
            throw err;
          }
        };

        return (target.registerTool as unknown as (n: string, c: unknown, h: ToolHandler) => unknown)(
          name, config, wrapped,
        );
      };
    },
  });
}
