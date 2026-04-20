<!--
  Sync Impact Report
  Version change: 1.0.0 → 1.1.0 (minor — added principles VII–IX, new sections)
  Added principles:
    - VII. Shared Directory Discovery
    - VIII. SP Syntax Ownership
    - IX. Graceful Degradation
  Added sections:
    - Protocol Versioning
    - Licensing
    - Distribution
  Modified principles:
    - IV. MCP Protocol Compliance — added Inbox-default rule for task creation
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no changes needed (generic)
    - .specify/templates/spec-template.md ✅ no changes needed (generic)
    - .specify/templates/tasks-template.md ✅ no changes needed (generic)
  Follow-up TODOs: none
-->

# Super Productivity MCP Server Constitution

## Core Principles

### I. Two-Component Architecture

The system MUST consist of exactly two components:

1. **MCP Server** — a standalone process that speaks the Model Context Protocol over stdio. It translates MCP tool calls into file-based commands and waits for responses.
2. **SP Plugin** — a Super Productivity plugin (JavaScript) that polls for command files, executes operations via the official `PluginAPI`, and writes response files.

Communication between the two components MUST use file-based IPC through shared `plugin_commands/` and `plugin_responses/` directories. No direct network connections, no WebSockets, no HTTP between the components.

Rationale: Super Productivity plugins run in a sandboxed environment with `PluginAPI` as the only interface. File-based IPC is the proven pattern from the reference implementation and avoids introducing unnecessary complexity.

### II. TypeScript-First

The MCP Server MUST be written in TypeScript using the official `@modelcontextprotocol/sdk` package. The SP Plugin MUST be written in JavaScript (SP plugin runtime requirement) with types informed by `@super-productivity/plugin-api`.

Rationale: TypeScript provides type safety for the MCP protocol layer. The reference project uses Python, but TypeScript aligns better with the MCP SDK ecosystem and enables shared type definitions between server and plugin command/response schemas.

### III. Robust Communication

- Command files MUST be valid JSON with a unique `id`, `action`, and `timestamp`.
- Response files MUST include `success` (boolean), optional `result`, optional `error`, and `timestamp`.
- The MCP server MUST implement configurable timeouts (default 30 seconds) when waiting for responses.
- The plugin MUST clean up processed command files after writing responses.
- The MCP server MUST clean up response files after reading them.
- Stale command/response files (older than 5 minutes) SHOULD be cleaned up on startup.

Rationale: The reference project suffers from orphaned files and race conditions. Explicit cleanup rules prevent filesystem pollution.

### IV. MCP Protocol Compliance

- All tools MUST follow the MCP specification for tool definitions (`name`, `description`, `inputSchema`).
- Tool names MUST use `snake_case`.
- The server MUST return `TextContent` results with structured JSON strings.
- Error responses MUST include actionable error messages, not stack traces.
- The server MUST expose tools for the full set of operations supported by the SP Plugin API: tasks (CRUD, complete, reorder), projects (CRUD), tags (CRUD), and notifications.
- `create_task` without a `projectId` MUST create the task with no project assignment and no scheduled date, so it lands in the Super Productivity Inbox. The MCP server MUST NOT default to "Today" or any other context.

Rationale: MCP compliance ensures the server works with any MCP client (Claude Desktop, Kiro, etc.), not just one specific host. The Inbox-default rule addresses reference issue #9.

### V. Cross-Platform by Default

The data directory MUST be resolved per platform:
- **macOS**: `~/Library/Application Support/super-productivity-mcp/`
- **macOS (App Store sandbox)**: `~/Library/Containers/com.superproductivity.app/Data/Library/Application Support/super-productivity-mcp/`
- **macOS (Homebrew)**: `~/Library/Application Support/super-productivity-mcp/`
- **Linux**: `$XDG_DATA_HOME/super-productivity-mcp/` (default `~/.local/share/super-productivity-mcp/`)
- **Linux (Snap)**: `~/snap/superproductivity/current/.local/share/super-productivity-mcp/`
- **Windows**: `%APPDATA%\super-productivity-mcp\`

The data directory MUST be configurable via a `SP_MCP_DATA_DIR` environment variable to override platform detection.

Rationale: The reference project has open issues (#7, #10) for Snap and Mac App Store sandbox paths. Handling these from day one avoids the same problems.

### VI. Simplicity & YAGNI

- Start with the core tool set: task CRUD, project CRUD, tag CRUD, notifications, and debug info.
- Do NOT implement batch operations, event streaming, or dashboard UI in v1.
- Each tool MUST map to exactly one SP Plugin API call (or a minimal composition of calls when the API requires it, e.g., subtask creation with SP syntax).
- Prefer fewer, well-tested tools over many partially-working ones.

Rationale: The reference project's batch operations and dashboard add complexity without clear MCP client use cases. Ship a reliable core first.

### VII. Shared Directory Discovery

Both the MCP server and the SP plugin MUST use identical directory resolution logic. Since the plugin cannot read environment variables, the canonical resolution order is:

1. The plugin computes the data directory using `os.platform()` and `os.homedir()` inside `PluginAPI.executeNodeScript`, probing for known paths (App Store sandbox, Snap, standard) and using the first that exists or is writable.
2. The MCP server uses the same probe logic, but `SP_MCP_DATA_DIR` env var takes precedence if set.
3. If `SP_MCP_DATA_DIR` is set, the MCP server MUST write a `mcp_config.json` file in the standard platform directory containing `{"dataDir": "<path>"}`. The plugin MUST check for this file on startup and use its `dataDir` value if present, overriding its own detection.

This ensures both components always agree on the data directory, even when the env var override is used.

Rationale: The reference project assumes both sides independently compute the same path, which breaks for non-standard installations. The config-file bridge solves the env-var asymmetry.

### VIII. SP Syntax Ownership

Super Productivity's title syntax (`@` for scheduling, `#` for tags, `+` for projects) MUST be handled by the SP Plugin, not the MCP server. The MCP server passes titles through verbatim. The plugin relies on `PluginAPI.addTask` and `PluginAPI.updateTask` to interpret the syntax natively.

Exception: when creating a subtask (with `parentId`), SP does not parse title syntax on `addTask`. In this case, the plugin MUST use the two-step workaround: create the subtask with a clean title, then immediately call `updateTask` with the original title to trigger syntax parsing.

The MCP server MUST document in its tool descriptions that users can include SP syntax in task titles and it will be interpreted by Super Productivity.

Rationale: Duplicating SP's syntax parser in the MCP server is fragile and will break when SP changes its parsing rules. Let SP own its own syntax.

### IX. Graceful Degradation

- When the plugin is not running (SP is closed), the MCP server MUST return a clear error: `"Super Productivity is not responding. Ensure the app is running with the MCP Bridge plugin enabled."` — not a generic timeout.
- The server MUST expose a `check_connection` tool that writes a ping command and waits for a pong response, returning connection status, plugin version, and data directory paths.
- If a tool call times out, the server MUST clean up the orphaned command file before returning the error.

Rationale: MCP clients display tool errors to users. A clear message is the difference between "I know what's wrong" and "something broke."

## Technology Stack

- **Runtime**: Node.js >= 18
- **Language**: TypeScript 5.x (MCP server), JavaScript (SP plugin)
- **MCP SDK**: `@modelcontextprotocol/sdk` (latest stable)
- **Build**: `tsup` or `tsc` for bundling the MCP server
- **Package Manager**: npm
- **Testing**: `vitest` for unit and integration tests
- **Linting**: `eslint` with TypeScript support
- **Plugin Packaging**: ZIP archive containing `manifest.json`, `plugin.js`, and optional `index.html`
- **Plugin Manifest Version**: 1 (per SP plugin spec, `minSupVersion: "14.0.0"`)
- **Plugin Permission**: `nodeExecution` (required for filesystem access via `PluginAPI.executeNodeScript`)

## Protocol Versioning

- Command files MUST include a `protocolVersion` field (integer, starting at `1`).
- The plugin MUST reject commands with a `protocolVersion` higher than it supports and write an error response: `"Unsupported protocol version X. Plugin supports up to version Y. Please update the plugin."`.
- The plugin MUST accept commands with a `protocolVersion` equal to or lower than its supported version (backward compatible).
- The `check_connection` response MUST include the plugin's supported `protocolVersion`.
- Protocol version increments when: a new required command field is added, a command action's semantics change, or a response schema changes in a breaking way. Adding new optional fields or new actions does NOT require a version bump.

Rationale: The two components are distributed and updated independently. Without a version handshake, a server upgrade can silently break communication with an older plugin.

## Development Workflow

- Feature branches off `main`, merged via PR.
- Each PR MUST include: implementation, tests for new/changed tools, and updated README if tool surface changes.
- The MCP server MUST be testable without a running Super Productivity instance by mocking the file-based IPC layer.
- The plugin MUST be manually tested against Super Productivity >= 14.0.0 before release.
- Releases follow semantic versioning: MAJOR for breaking tool schema changes, MINOR for new tools, PATCH for bug fixes.

## Distribution

- The MCP server MUST be publishable as an npm package and runnable via `npx`.
- The MCP client configuration entry should be: `{"command": "npx", "args": ["-y", "super-productivity-mcp"]}` (or equivalent with the chosen package name).
- The SP plugin MUST be distributed as a `plugin.zip` file attached to GitHub releases.
- A setup guide in the README MUST cover: installing the plugin in SP, configuring the MCP client, and verifying the connection with `check_connection`.

Rationale: `npx` eliminates manual installation for the server. A zip file is the standard SP plugin distribution format.

## Licensing

This project is licensed under the **MIT License**, consistent with both the reference SP-MCP project and Super Productivity itself.

## Governance

This constitution supersedes all other development practices for this project. Amendments require:

1. A documented rationale for the change.
2. Version bump of the constitution itself.
3. Review of all dependent templates for consistency.

All implementation decisions MUST be traceable to a principle in this document. If a decision cannot be justified by an existing principle, propose an amendment first.

**Version**: 1.1.0 | **Ratified**: 2026-04-20 | **Last Amended**: 2026-04-20
