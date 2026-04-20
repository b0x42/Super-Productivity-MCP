# Research: Super Productivity MCP Server

## MCP TypeScript SDK

**Decision**: Use `@modelcontextprotocol/sdk` with `McpServer` + `StdioServerTransport` for stdio-based local integration.

**Rationale**: The SDK provides `McpServer.registerTool()` with Zod schema validation, automatic tool listing, and error handling. Stdio transport is the standard for local MCP servers spawned by clients. No HTTP server needed.

**Alternatives considered**:
- Raw JSON-RPC over stdio: Too low-level, would reimplement what the SDK provides.
- Streamable HTTP transport: Overkill for a local integration; adds HTTP server complexity.

**Key pattern** (from SDK docs):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'super-productivity', version: '1.0.0' });

server.registerTool('tool_name', {
  description: 'Tool description',
  inputSchema: { param: z.string() }
}, async ({ param }) => {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## File-Based IPC Pattern

**Decision**: JSON files in shared directories with polling. Command files written by server, read/deleted by plugin. Response files written by plugin, read/deleted by server.

**Rationale**: Proven by the reference SP-MCP project. The SP plugin sandbox only allows filesystem access via `PluginAPI.executeNodeScript`. No sockets, no HTTP, no shared memory available.

**Alternatives considered**:
- WebSocket: Not available in SP plugin sandbox.
- Named pipes: Not cross-platform (Windows vs Unix), not accessible from `executeNodeScript`.
- SQLite shared DB: Adds dependency, more complex than JSON files for simple request/response.

**Improvements over reference**:
- Add `protocolVersion` field to commands.
- Explicit file permission model (700/600).
- Stale file cleanup on startup.
- Orphaned command cleanup on timeout.

## SP Plugin API Surface

**Decision**: Use the official `PluginAPI` interface as documented in `@super-productivity/plugin-api@1.0.1`.

**Key methods used**:
- `PluginAPI.getTasks()` → `Promise<Task[]>`
- `PluginAPI.addTask(data)` → `Promise<string>` (returns task ID)
- `PluginAPI.updateTask(taskId, updates)` → `Promise<Task>`
- `PluginAPI.getAllProjects()` → `Promise<Project[]>`
- `PluginAPI.addProject(data)` → `Promise<string>`
- `PluginAPI.updateProject(projectId, updates)` → `Promise<Project>`
- `PluginAPI.getAllTags()` → `Promise<Tag[]>`
- `PluginAPI.addTag(data)` → `Promise<string>`
- `PluginAPI.updateTag(tagId, updates)` → `Promise<Tag>`
- `PluginAPI.showSnack(cfg)` → `void`
- `PluginAPI.executeNodeScript(request)` → `Promise<PluginNodeScriptResult>`

**Limitation**: `getTasks()` returns ALL tasks. Filtering (FR-002) must be done server-side after receiving the full list from the plugin. The plugin sends all tasks; the MCP server filters before returning to the client.

**Subtask workaround** (from reference project, confirmed by API types): `addTask` with `parentId` does not trigger SP syntax parsing. Must create with clean title, then `updateTask` with original title.

## Cross-Platform Directory Resolution

**Decision**: Probe-based resolution with ordered candidate paths per platform.

**Resolution logic** (shared between server and plugin):
1. Check `SP_MCP_DATA_DIR` env var (server only) or `mcp_config.json` (plugin only)
2. Probe platform-specific candidates in order:
   - macOS: App Store sandbox path → standard `~/Library/Application Support/`
   - Linux: Snap path → `$XDG_DATA_HOME` → `~/.local/share/`
   - Windows: `%APPDATA%`
3. Use first writable path; create if needed

**Rationale**: Addresses reference issues #7 (Snap) and #10 (Mac App Store sandbox). Probe order prioritizes sandboxed paths because if the sandbox exists, the standard path won't be accessible.

## Build Tooling

**Decision**: `tsup` for bundling the MCP server into a single JS file.

**Rationale**: `tsup` is zero-config for TypeScript projects, produces a single CJS/ESM bundle suitable for `npx` distribution. Faster than raw `tsc` for production builds. The output is a single `dist/index.js` that `npx` can execute.

**Alternatives considered**:
- `tsc` only: Works but produces multiple files; less clean for npm distribution.
- `esbuild` directly: `tsup` wraps esbuild with better defaults for library/CLI output.

## Task Filtering Strategy

**Decision**: Server-side filtering after receiving all tasks from the plugin.

**Rationale**: The SP Plugin API's `getTasks()` returns all tasks with no filter parameters. Filtering must happen after the data arrives. The MCP server applies filters (projectId, tagId, isDone, search query) to the full task list before returning results to the client.

**Future**: If SP adds filtering to the Plugin API (reference issue #5), the plugin can filter before sending, reducing data transfer.

## MCP Best Practices (from official docs)

**Decision**: Use stdio transport, `isError: true` for errors, server-side input validation, rich tool descriptions.

**Rationale**: Reviewed Anthropic's engineering blog on code execution with MCP, modelcontextprotocol.info best practices, and modelcontextprotocol.io security best practices. Our stdio-only architecture sidesteps all HTTP-related security concerns (SSRF, session hijacking, confused deputy, token passthrough, OAuth scope issues). The three actionable items:

1. **`isError: true`**: The MCP SDK supports `{ isError: true }` on tool results to signal failure. We MUST use this instead of returning error text as a successful result. This lets MCP clients handle errors programmatically.
2. **Server-side input validation**: Validate required fields (title, IDs, non-negative numbers) before writing command files. Reject invalid inputs immediately without round-tripping through the plugin.
3. **Rich tool descriptions**: AI agents discover capabilities through tool descriptions. Each tool description should document SP short syntax support (`@`, `#`, `+`, time estimates) so assistants use it effectively.

**Alternatives considered**: None — these are additive improvements, not architectural choices.
