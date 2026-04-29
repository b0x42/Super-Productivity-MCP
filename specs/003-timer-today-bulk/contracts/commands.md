# Command Protocol Contracts: Timer Control, Today Tasks & Bulk Operations

**Feature**: Timer Control, Today Tasks & Bulk Operations
**Created**: 2026-04-28
**Protocol Version**: 1 (no bump — all additions are additive)

---

## New Actions

### `startTask`

Start the time tracker on a task. If another task is being tracked, SP automatically stops it.

**Plugin handler**: Reads task via `getTasks()`, validates not done, dispatches `[Task] Set Current Task` NgRx action.

**Request**:
```json
{
  "action": "startTask",
  "taskId": "<task-id>"
}
```

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- `taskId` not found → `{ "success": false, "error": "Task not found: <taskId>" }`
- Task is done → `{ "success": false, "error": "Cannot start tracking a completed task: <taskId>" }`

---

### `stopTask`

Stop the currently running timer. Idempotent — succeeds silently if no timer is running.

**Plugin handler**: Dispatches `[Task] Unset Current Task` NgRx action.

**Request**:
```json
{
  "action": "stopTask"
}
```

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**: None — always succeeds.

---

### `bulkCompleteTasks`

Mark multiple tasks as done in a single command. Uses partial-success semantics.

**Plugin handler**: Iterates `taskIds`, calls `updateTask(id, { isDone: true, doneOn: Date.now() })` for each. Collects per-item results.

**Request**:
```json
{
  "action": "bulkCompleteTasks",
  "taskIds": ["<id-1>", "<id-2>", "<id-3>"]
}
```

**Success response**:
```json
{
  "success": true,
  "result": {
    "results": [
      { "id": "<id-1>", "success": true },
      { "id": "<id-2>", "success": true },
      { "id": "<id-3>", "success": false, "error": "Task not found: <id-3>" }
    ]
  }
}
```

**Error cases**: Per-item errors in `results` array. Top-level `success` is always `true` unless the command itself fails.

---

### `bulkUpdateTasks`

Apply different updates to multiple tasks in a single command.

**Plugin handler**: Iterates `updates`, calls `updateTask(item.taskId, item.data)` for each. Collects per-item results.

**Request**:
```json
{
  "action": "bulkUpdateTasks",
  "updates": [
    { "taskId": "<id-1>", "data": { "dueDay": "2026-05-01" } },
    { "taskId": "<id-2>", "data": { "tagIds": ["tag-a", "tag-b"] } }
  ]
}
```

**Success response**:
```json
{
  "success": true,
  "result": {
    "results": [
      { "id": "<id-1>", "success": true },
      { "id": "<id-2>", "success": true }
    ]
  }
}
```

**Error cases**: Per-item errors in `results` array.

---

### `bulkDeleteTasks`

Delete multiple tasks permanently. Deleting a parent also deletes its subtasks (SP native behaviour).

**Plugin handler**: Reads all tasks, iterates `taskIds`, dispatches `[Task] Delete Task` NgRx action for each. Collects per-item results.

**Request**:
```json
{
  "action": "bulkDeleteTasks",
  "taskIds": ["<id-1>", "<id-2>"]
}
```

**Success response**:
```json
{
  "success": true,
  "result": {
    "results": [
      { "id": "<id-1>", "success": true },
      { "id": "<id-2>", "success": true }
    ]
  }
}
```

**Error cases**:
- `taskId` not found → per-item `{ "id": "<id>", "success": false, "error": "Task not found: <id>" }`

---

## Extended Actions

### `getTasks` — new filter field

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `plannedForToday` | `boolean` | `false` | Include only tasks whose `plannedAt` falls within today (local timezone) |

**Filter application**: Applied in MCP server after existing filters. Uses local timezone boundaries:
- `startOfToday = new Date(year, month, day).getTime()`
- `startOfTomorrow = startOfToday + 86400000`
- Match: `task.plannedAt >= startOfToday && task.plannedAt < startOfTomorrow`

**Request**:
```json
{
  "action": "getTasks",
  "filters": {
    "plannedForToday": true,
    "parentsOnly": true
  }
}
```

---

## Summary of New MCP Tools

| MCP Tool | IPC Action | Plugin Method |
|----------|-----------|---------------|
| `start_task` | `startTask` | `dispatchAction` (NgRx) |
| `stop_task` | `stopTask` | `dispatchAction` (NgRx) |
| `bulk_complete_tasks` | `bulkCompleteTasks` | `updateTask` × N |
| `bulk_update_tasks` | `bulkUpdateTasks` | `updateTask` × N |
| `bulk_delete_tasks` | `bulkDeleteTasks` | `dispatchAction` × N |
| (extended) `get_tasks` | `getTasks` | filter in MCP server |
