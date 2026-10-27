# Proposal

## Why

Super Productivity has native task priority (Low / Medium / High). `get_tasks` returns it, but no write tool accepts it, and the strict tool schemas reject the field outright. An assistant can read priorities but never set or change them (issue #138).

## What Changes

- `create_task`, `update_task`, `bulk_update_tasks` (per item) and `create_task_with_subtasks` (parent and each subtask) accept an optional `priority` parameter: `1` (Low), `2` (Medium), `3` (High), or `null` to clear.
- Omitting `priority` leaves the existing value untouched.
- Plugin: `addTask` and `createTaskWithSubtasks` persist priority through a follow-up `PluginAPI.updateTask`, because `PluginAPI.addTask()` silently drops fields outside its creation set (same as `deadlineDay`).
- Not in scope: `p1`/`p2`/`p3` title short syntax, priority filter on `get_tasks`.

## Capabilities

### New Capabilities
- `task-priority`: set and clear a task's priority on create, update, bulk update and create-with-subtasks.

### Modified Capabilities

None. `mcp-tool-input-validation` is unchanged: the new parameter is declared on each schema, so strict validation already covers it.

## Impact

- `src/tools/tasks.ts`: four tool schemas plus handler mapping.
- `plugin/plugin.js`: `addTask` and `createTaskWithSubtasks` follow-up `updateTask`.
- Tests: `tests/unit/tools/tasks.test.ts`, `tests/unit/plugin/executeCommand.test.ts`.
- Docs: tool table in README.
