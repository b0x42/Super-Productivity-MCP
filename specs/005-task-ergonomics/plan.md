# Implementation Plan: Task Ergonomics

**Feature**: Task Ergonomics
**Created**: 2026-04-29
**Source**: [spec.md](spec.md), [data-model.md](data-model.md)

## Implementation Steps

### Step 1: Field selection on get_tasks (server-side only)

Add `fields` parameter to `get_tasks` input schema. After filtering, if `fields` is non-empty, map tasks to include only specified fields.

**Files**: `src/tools/tasks.ts`

### Step 2: delete_task plugin handler

Add `deleteTask` case to `plugin/plugin.js`. Use `PluginAPI.deleteTask(taskId)` — verify this method exists in the plugin API. If not, use `dispatchAction` with the NgRx delete action.

**Files**: `plugin/plugin.js`

### Step 3: delete_task MCP tool

Register `delete_task` tool in `src/tools/tasks.ts`.

**Files**: `src/tools/tasks.ts`

### Step 4: createTaskWithSubtasks plugin handler

Add `createTaskWithSubtasks` case to `plugin/plugin.js`. Creates parent via `addTask`, then creates each subtask with `parentId` set.

**Files**: `plugin/plugin.js`

### Step 5: create_task_with_subtasks MCP tool

Register `create_task_with_subtasks` tool in `src/tools/tasks.ts`.

**Files**: `src/tools/tasks.ts`

### Step 6: Unit tests

- Test field selection shaping logic
- Test delete_task sendCommand integration
- Test create_task_with_subtasks sendCommand integration

**Files**: `tests/unit/tools/tasks.test.ts`

### Step 7: Build + typecheck + lint + test

Verify everything passes.

## File Changes

| File | Change |
|------|--------|
| `src/tools/tasks.ts` | Add `fields` param to get_tasks, add `delete_task` tool, add `create_task_with_subtasks` tool |
| `plugin/plugin.js` | Add `deleteTask` and `createTaskWithSubtasks` handlers |
| `tests/unit/tools/tasks.test.ts` | Add tests for new features |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `PluginAPI.deleteTask()` may not exist | Fall back to `dispatchAction` with NgRx action (proven pattern from start_task/stop_task) |
| Subtask creation partially fails mid-batch | Return partial result with parentId + whatever subtaskIds were created |
| Field selection with typos returns empty objects | Spec says silently ignore unknown fields — document valid field names in tool description |
