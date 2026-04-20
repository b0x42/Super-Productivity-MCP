# Implementation Plan: Super Productivity MCP Server

**Branch**: `001-sp-mcp-server` | **Date**: 2026-04-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-sp-mcp-server/spec.md`

## Summary

Build a two-component system — a TypeScript MCP server and a JavaScript Super Productivity plugin — that enables any MCP-compatible AI assistant to manage tasks, projects, and tags in Super Productivity via file-based IPC. The server exposes 13 MCP tools, the plugin executes them against the SP Plugin API.

## Technical Context

**Language/Version**: TypeScript 5.x (MCP server), JavaScript ES2020 (SP plugin)
**Primary Dependencies**: `@modelcontextprotocol/sdk`, `@super-productivity/plugin-api` (types only)
**Storage**: File-based IPC (JSON files in shared data directory)
**Testing**: vitest (unit + integration via mocked IPC layer)
**Target Platform**: macOS, Linux, Windows (Node.js >= 18)
**Project Type**: MCP server (stdio) + SP plugin (sandboxed JS)
**Performance Goals**: < 5s round-trip per tool call (2s polling + processing)
**Constraints**: No direct network between components; plugin limited to `PluginAPI`; `nodeExecution` permission required
**Scale/Scope**: Single user, single SP instance, ~13 MCP tools

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Two-Component Architecture | ✅ PASS | MCP server + SP plugin, file-based IPC |
| II. TypeScript-First | ✅ PASS | Server in TS, plugin in JS |
| III. Robust Communication | ✅ PASS | JSON commands with id/action/timestamp/protocolVersion, cleanup rules |
| IV. MCP Protocol Compliance | ✅ PASS | 13 tools, snake_case, TextContent, Inbox-default |
| V. Cross-Platform by Default | ✅ PASS | Platform-specific paths + SP_MCP_DATA_DIR override |
| VI. Simplicity & YAGNI | ✅ PASS | Core tools only, no batch/events/dashboard |
| VII. Shared Directory Discovery | ✅ PASS | Identical probe logic + mcp_config.json bridge |
| VIII. SP Syntax Ownership | ✅ PASS | Plugin handles @/#/+, server passes verbatim |
| IX. Graceful Degradation | ✅ PASS | check_connection tool, clear timeout errors, orphan cleanup |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-sp-mcp-server/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── command-protocol.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── server.ts              # MCP server entry point (stdio transport)
├── tools/                 # One file per MCP tool (or grouped by domain)
│   ├── tasks.ts           # create_task, get_tasks, update_task, complete_task
│   ├── projects.ts        # create_project, get_projects, update_project
│   ├── tags.ts            # create_tag, get_tags, update_tag
│   ├── notifications.ts   # show_notification
│   └── diagnostics.ts     # check_connection, debug_directories
├── ipc/
│   ├── command-sender.ts  # Write command files, poll for responses
│   ├── types.ts           # Command/Response TypeScript interfaces
│   └── directories.ts     # Cross-platform directory resolution
└── index.ts               # Package entry point

plugin/
├── manifest.json          # SP plugin manifest (v1, minSupVersion 14.0.0)
├── plugin.js              # SP plugin (polls commands, executes PluginAPI, writes responses)
└── index.html             # Optional dashboard (empty for v1)

tests/
├── unit/
│   ├── directories.test.ts
│   ├── command-sender.test.ts
│   └── tools/
│       ├── tasks.test.ts
│       ├── projects.test.ts
│       └── tags.test.ts
└── integration/
    └── round-trip.test.ts  # Full command→response cycle with mocked filesystem

package.json
tsconfig.json
tsup.config.ts
README.md
LICENSE
```

**Structure Decision**: Custom two-component layout. `src/` contains the MCP server (TypeScript, compiled to JS). `plugin/` contains the SP plugin (plain JavaScript, packaged as ZIP). `tests/` covers the server only — the plugin is tested manually against SP.

## Complexity Tracking

No violations. No complexity justifications needed.
