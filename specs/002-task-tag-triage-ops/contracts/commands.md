# Command Protocol Contracts: Task Tag & Triage Operations

**Feature**: Task Tag & Triage Operations
**Created**: 2026-04-20
**Protocol Version**: 1 (no bump — all additions are additive)

This file documents the new and extended command actions added to the file-based IPC protocol. All commands follow the existing `Command` / `Response` envelope format in `src/ipc/types.ts`.

---

## New Actions

### `addTagToTask`

Add a single tag to a task. Idempotent: calling with an already-present tag is a no-op.

**Plugin handler**: Reads current `task.tagIds` via `getTasks()`, appends tag if absent, calls `updateTask({ tagIds: [...] })`.

**Request**:
```json
{
  "action": "addTagToTask",
  "taskId": "<task-id>",
  "tagId": "<tag-id>"
}
```

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- `taskId` not found → `{ "success": false, "error": "Task not found: <taskId>" }`
- `tagId` not found in SP tag registry → `{ "success": false, "error": "Tag not found: <tagId>" }`

---

### `removeTagFromTask`

Remove a single tag from a task. Returns an error if the tag is not currently on the task.

**Plugin handler**: Reads current `task.tagIds`, filters out the tag, calls `updateTask({ tagIds: [...] })`. Errors if tag was not present.

**Request**:
```json
{
  "action": "removeTagFromTask",
  "taskId": "<task-id>",
  "tagId": "<tag-id>"
}
```

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- `taskId` not found → `{ "success": false, "error": "Task not found: <taskId>" }`
- Tag not on task → `{ "success": false, "error": "Tag <tagId> not on task <taskId>" }`

---

### `reorderTasks`

Reorder tasks within a project or subtasks within a parent task.

**Plugin handler**: Calls `PluginAPI.reorderTasks(taskIds, contextId, contextType)`. Validates all `taskIds` belong to `contextId` before calling; returns error if any ID is foreign.

**Request**:
```json
{
  "action": "reorderTasks",
  "taskIds": ["<id-1>", "<id-2>", "<id-3>"],
  "contextId": "<project-id-or-parent-task-id>",
  "contextType": "project"
}
```

`contextType` must be `"project"` or `"parent"`.

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- Any `taskId` not belonging to `contextId` → `{ "success": false, "error": "Task <id> does not belong to context <contextId>" }`
- `contextId` not found → `{ "success": false, "error": "Context not found: <contextId>" }`

---

### `moveTaskToProject`

Move a top-level task to a different project.

**Plugin handler**: Validates task is not a subtask (`parentId === null`), then calls `updateTask({ projectId: newProjectId })`. SP's NgRx reducer handles updating both source and destination `project.taskIds` arrays.

**Request**:
```json
{
  "action": "moveTaskToProject",
  "taskId": "<task-id>",
  "projectId": "<destination-project-id>"
}
```

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- `taskId` not found → `{ "success": false, "error": "Task not found: <taskId>" }`
- Task is a subtask → `{ "success": false, "error": "Cannot move subtask: <taskId> has parentId <parentId>" }`
- `projectId` not found → `{ "success": false, "error": "Project not found: <projectId>" }`

---

### `loadCurrentTask`

Retrieve the currently time-tracked task.

**Plugin handler**: Calls `PluginAPI.loadSyncedData()` and parses the stored JSON string. Returns the task object or `null` if no timer is running.

**Storage**: The plugin writes to `persistDataSynced` in response to the `currentTaskChange` hook:
```js
PluginAPI.persistDataSynced(JSON.stringify(taskData || null));
```

**Request**:
```json
{
  "action": "loadCurrentTask"
}
```

**Success response — timer active**:
```json
{ "success": true, "result": { "id": "<task-id>", "title": "...", ... } }
```

**Success response — no active timer**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- Stored data is malformed JSON → `{ "success": false, "error": "Failed to parse stored current task" }`

---

## Extended Actions

### `getTasks` — new filter fields

The existing `getTasks` action is extended to support three new filter fields passed in `filters`. All new fields are optional; existing behaviour is preserved when omitted.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `parentsOnly` | `boolean` | `false` | Exclude subtasks (tasks with `parentId !== null`) |
| `overdue` | `boolean` | `false` | Include only tasks where `dueDay < todayLocalDate` |
| `unscheduled` | `boolean` | `false` | Include only tasks where `dueDay === null && dueWithTime === null` |

**Filter application order** (applied in MCP server after plugin returns all tasks):
1. Existing filters: `projectId`, `tagId`, `includeDone`, `includeArchived`, `searchQuery`
2. New filters: `parentsOnly`, then `overdue` or `unscheduled`

**Request**:
```json
{
  "action": "getTasks",
  "filters": {
    "parentsOnly": true,
    "unscheduled": true
  }
}
```

---

### `updateTask` — `tagIds` field

The existing `updateTask` action already accepts arbitrary `data` fields. Passing `tagIds` in `data` bulk-replaces the entire tag list on the task. No plugin-side changes needed — this is already supported by `PluginAPI.updateTask()`.

**Request**:
```json
{
  "action": "updateTask",
  "taskId": "<task-id>",
  "data": {
    "tagIds": ["<tag-id-1>", "<tag-id-2>"]
  }
}
```

This is already handled by the existing plugin handler. The MCP tool `update_task` only needs a new `tag_ids` input parameter exposed to the caller.
