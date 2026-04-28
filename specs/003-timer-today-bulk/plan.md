# Implementation Plan: Timer Control, Today Tasks & Bulk Operations

**Branch**: `003-timer-today-bulk` | **Date**: 2026-04-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003-timer-today-bulk/spec.md`

## Summary

Add 5 new MCP tools (`start_task`, `stop_task`, `bulk_complete_tasks`, `bulk_update_tasks`, `bulk_delete_tasks`) and extend `get_tasks` with a `planned_for_today` filter. Timer control uses `dispatchAction` with NgRx actions since PluginAPI has no direct timer methods. Bulk operations use partial-success semantics.

## Technical Context

**Language/Version**: TypeScript 5.x (MCP server), JavaScript (SP plugin), Node.js >= 18
**Primary Dependencies**: `@modelcontextprotocol/sdk`, `@super-productivity/plugin-api`, `zod`
**Storage**: File-based IPC (`plugin_commands/`, `plugin_responses/`)
**Testing**: `vitest` (unit)
**Target Platform**: macOS, Linux, Windows
**Performance Goals**: Same as existing — 30s timeout, 2s poll interval
**Constraints**: Timer control requires `dispatchAction` (NgRx) — no native PluginAPI method exists. Delete also requires `dispatchAction`. Both need the full task object as payload.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Two-Component Architecture | ✅ | All operations use existing file IPC |
| II. TypeScript-First | ✅ | MCP server in TS, plugin handler in JS |
| III. Robust Communication | ✅ | No protocol changes; existing timeout/cleanup applies |
| IV. MCP Protocol Compliance | ✅ | New tools follow snake_case, TextContent, structured JSON |
| V. Cross-Platform | ✅ | No path changes |
| VI. Simplicity & YAGNI | ⚠️ | `dispatchAction` is less stable than PluginAPI methods — document risk |
| VII. Shared Directory Discovery | ✅ | No changes |
| VIII. SP Syntax Ownership | ✅ | No title parsing |
| IX. Graceful Degradation | ✅ | Existing timeout/error handling covers new tools |
| X. Comment the Why | ✅ | Must annotate dispatchAction usage and NgRx action types |

**Principle VI justification**: `dispatchAction` is the only way to control the timer and delete tasks. The NgRx action types are stable internal SP actions unlikely to change within 14.x. Risk is documented and mitigated by error handling.

## Project Structure

### Source Code changes

```text
src/
├── ipc/
│   └── types.ts           # Extend TaskFilters with plannedForToday
└── tools/
    └── tasks.ts           # 5 new tools + extended get_tasks filter

plugin/
└── plugin.js              # 5 new command handlers (startTask, stopTask, bulk*)

tests/
└── unit/tools/
    └── tasks.test.ts      # Tests for all new/modified tools
```

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| NgRx action type strings change in SP 15.x | Timer/delete tools break | Pin to SP >= 14.0.0; document action types; test against SP |
| `dispatchAction` doesn't await completion | Timer may not start before response | Add small delay or verify state after dispatch |
| `plannedAt` semantics change | Today filter returns wrong tasks | Document assumption; test with real SP data |
| Bulk delete of parent with subtasks | Unexpected cascade | Document in tool description; SP native behaviour |

## Phases

### Phase 1: Foundational

Extend type system for new filters and bulk command data.

### Phase 2: Timer Control (US1 — P1)

Implement `start_task` and `stop_task` using `dispatchAction`.

### Phase 3: Today Tasks (US2 — P2)

Add `planned_for_today` filter to `get_tasks`.

### Phase 4: Bulk Operations (US3 — P3)

Implement `bulk_complete_tasks`, `bulk_update_tasks`, `bulk_delete_tasks` with partial-success semantics.

### Phase 5: Polish

Manual integration testing against SP >= 14.0.0.
