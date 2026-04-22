# Implementation Plan: Task Tag & Triage Operations

**Branch**: `002-task-tag-triage-ops` | **Date**: 2026-04-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-task-tag-triage-ops/spec.md`

## Summary

Add 7 new MCP tools and extend 2 existing tools to support incremental tag management, triage-focused task filtering, task organisation (move, reorder), and active-task retrieval. All 9 operations map through the existing file-based IPC layer to SP PluginAPI calls.

## Technical Context

**Language/Version**: TypeScript 5.x (MCP server), JavaScript (SP plugin), Node.js >= 18
**Primary Dependencies**: `@modelcontextprotocol/sdk`, `@super-productivity/plugin-api`, `zod`
**Storage**: File-based IPC (`plugin_commands/`, `plugin_responses/`), `PluginAPI.persistDataSynced` for current-task state
**Testing**: `vitest` (unit + integration)
**Target Platform**: macOS, Linux, Windows (cross-platform, per constitution Principle V)
**Project Type**: MCP server + SP plugin (two-component, per constitution Principle I)
**Performance Goals**: Same as existing — 30s timeout, 200ms poll interval
**Constraints**: Each tool MUST map to at most one PluginAPI call or minimal composition (Principle VI). No new protocol version bump needed — all new actions are additive.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Two-Component Architecture | ✅ | All operations use existing file IPC |
| II. TypeScript-First | ✅ | MCP server in TS, plugin handler in JS |
| III. Robust Communication | ✅ | No protocol changes; existing timeout/cleanup applies |
| IV. MCP Protocol Compliance | ✅ | New tools follow snake_case, TextContent, structured JSON |
| V. Cross-Platform | ✅ | No path changes |
| VI. Simplicity & YAGNI | ✅ | Each tool maps to one PluginAPI call or minimal read-modify-write |
| VII. Shared Directory Discovery | ✅ | No changes |
| VIII. SP Syntax Ownership | ✅ | No title parsing in MCP server |
| IX. Graceful Degradation | ✅ | Existing timeout/error handling covers new tools |
| X. Comment the Why | ✅ | Must annotate read-modify-write rationale and `persistDataSynced` key design |

No violations. No complexity justification required.

## Project Structure

### Documentation (this feature)

```text
specs/002-task-tag-triage-ops/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code changes

```text
src/
├── ipc/
│   └── types.ts           # Extend TaskFilters + Command fields
└── tools/
    └── tasks.ts           # 7 new tools + 2 extended tools

plugin/
└── plugin.js              # 5 new command handlers + fix persistDataSynced call

tests/
└── unit/tools/
    └── tasks.test.ts      # Tests for all new/modified tools
```

## Phase 0: Research

### PluginAPI Availability

| Operation | PluginAPI Method | Notes |
|-----------|-----------------|-------|
| `add_tag_to_task` | `getTasks()` + `updateTask()` | No native addTagToTask — read-modify-write required |
| `remove_tag_from_task` | `getTasks()` + `updateTask()` | Same pattern; returns error if tag not present |
| `tag_ids` in `update_task` | `updateTask()` | Already supported; just expose in MCP layer |
| `parents_only` filter | Filter in MCP server | No SP API for filtered queries (see issue #5) |
| `overdue` filter | Filter in MCP server | Compare `task.dueDay < todayLocalDate` |
| `unscheduled` filter | Filter in MCP server | `!task.dueDay && !task.dueWithTime` |
| `move_task_to_project` | `updateTask({ projectId })` | SP state management handles project.taskIds update via reducer |
| `reorder_tasks` | `PluginAPI.reorderTasks()` | Native API — `reorderTasks(taskIds, contextId, contextType)` |
| `get_current_task` | `loadSyncedData()` | Plugin stores current task in persistDataSynced on `currentTaskChange` hook |

### Key Design Decisions

**Decision**: `add_tag_to_task` / `remove_tag_from_task` use read-modify-write in the plugin handler.
**Rationale**: SP PluginAPI has no native addTagToTask/removeTagFromTask. `updateTask` replaces tagIds entirely, so we must read current tags first. The read and write happen atomically within a single plugin command execution (single-threaded JS event loop).
**Alternative rejected**: Fetch tags in MCP server — would require a separate `getTask` round-trip over file IPC, doubling latency for no benefit.

**Decision**: `get_current_task` uses `persistDataSynced` / `loadSyncedData` for storage.
**Rationale**: The plugin already registers a `currentTaskChange` hook. Storing the payload there lets `get_current_task` return instantly (O(1) lookup) rather than fetching all tasks and checking active state. The single-slot storage is sufficient since only one task can be active at a time.
**Note**: The existing plugin code incorrectly calls `persistDataSynced('currentTask', taskData)` with two arguments — the PluginAPI signature is `persistDataSynced(dataStr: string)`. Fix: `persistDataSynced(JSON.stringify(taskData || null))`.

**Decision**: `move_task_to_project` uses `updateTask({ projectId })`.
**Rationale**: SP's internal state management (NgRx reducers) handles the `projectId` change and updates the corresponding `project.taskIds` array automatically when `updateTask` is dispatched. No need for a dedicated move action.
**Risk**: If SP does not handle the project.taskIds update via `updateTask`, tasks may appear in both source and destination projects. Will verify during manual testing against SP >= 14.0.0.

**Decision**: Triage filters (`parents_only`, `overdue`, `unscheduled`) implemented in MCP server TypeScript.
**Rationale**: SP has no filtered query API (tracked in issue #5). Filtering in the MCP layer after `getTasks()` is O(n) but keeps the plugin simple and avoids a protocol version bump.

## Phase 1: Design & Contracts

See [data-model.md](data-model.md) and [contracts/](contracts/).
