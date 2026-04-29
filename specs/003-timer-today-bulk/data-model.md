# Data Model: Timer Control, Today Tasks & Bulk Operations

**Feature**: Timer Control, Today Tasks & Bulk Operations
**Created**: 2026-04-28
**Source**: [spec.md](spec.md)

## Research: PluginAPI Availability

The official `PluginAPI` interface (from `@super-productivity/plugin-api`) does NOT expose:
- `setCurrentTask` / `startTracking` — no direct timer control method
- `deleteTask` — no task deletion method

**Available escape hatch**: `PluginAPI.dispatchAction(action: any)` dispatches arbitrary NgRx actions to SP's store. This enables:
- Timer start: `dispatchAction({ type: '[Task] Set Current Task', payload: { task } })`
- Timer stop: `dispatchAction({ type: '[Task] Unset Current Task' })`
- Task delete: `dispatchAction({ type: '[Task] Delete Task', payload: { task } })`

**Timer state detection** (existing pattern): A task with `currentTimestamp > 0` has an active timer. This field is not in the official `Task` type but exists at runtime.

**`plannedAt`**: A Unix ms timestamp set when a task is moved to SP's "Today" view. Not in the official `Task` type but exists at runtime and is already used in the plugin's `addTask` handler.

## Entities

### Task (extended runtime fields)

Fields beyond the official `Task` interface that exist at runtime:

| Field | Type | Description |
|-------|------|-------------|
| `currentTimestamp` | `number` | Unix ms when timer was started; 0 = no active timer |
| `plannedAt` | `number \| null` | Unix ms when task was planned for today; null = not planned |
| `dueDay` | `string \| null` | Due date as `YYYY-MM-DD`; null = no due date |
| `dueWithTime` | `number \| null` | Scheduled time as Unix ms; null = no scheduled time |

**Derived properties** (computed in MCP server):
- `isPlannedForToday`: `plannedAt != null && startOfToday <= plannedAt && plannedAt < startOfTomorrow`
- `hasActiveTimer`: `currentTimestamp > 0`

### Bulk Result Item

Per-item result in bulk operations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Task ID that was processed |
| `success` | `boolean` | Whether this item succeeded |
| `error` | `string \| undefined` | Error message if failed |

### Bulk Update Item (input)

Per-item update specification for `bulk_update_tasks`.

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | `string` | Task ID to update |
| `title` | `string \| undefined` | New title |
| `notes` | `string \| undefined` | New notes |
| `due_day` | `string \| undefined` | New due date or empty string to clear |
| `tag_ids` | `string[] \| undefined` | Bulk-replace tags |
| `time_estimate` | `number \| undefined` | Time estimate in ms |
| `time_spent` | `number \| undefined` | Time spent in ms |

## Command Data Extensions

### New fields on `Command`

| Field | Type | Used by actions |
|-------|------|----------------|
| `taskIds` | `string[]` | `bulkCompleteTasks`, `bulkDeleteTasks` — list of task IDs |
| `updates` | `Array<{taskId, data}>` | `bulkUpdateTasks` — per-task update payloads |

### Extended `TaskFilters`

New field added to `TaskFilters` in `src/ipc/types.ts`:

| Field | Type | Description |
|-------|------|-------------|
| `plannedForToday` | `boolean \| undefined` | When true, return only tasks whose `plannedAt` falls within today (local timezone) |

**Filter combination semantics**:
- `plannedForToday` combines with all existing filters via AND logic
- `plannedForToday` + `overdue` is valid (tasks planned for today that are also overdue)
- `plannedForToday` + `unscheduled` is valid (tasks planned for today with no due date)

## NgRx Actions (for `dispatchAction`)

### Start Timer

```typescript
{
  type: '[Task] Set Current Task',
  payload: { task: taskObject }  // full task object required
}
```

SP behaviour: Starting a task while another is tracked automatically stops the previous timer.

### Stop Timer

```typescript
{
  type: '[Task] Unset Current Task'
}
```

SP behaviour: Idempotent — dispatching when no timer is running is a no-op.

### Delete Task

```typescript
{
  type: '[Task] Delete Task',
  payload: { task: taskObject }  // full task object required
}
```

SP behaviour: Deleting a parent task also deletes all subtasks.

## State Transitions

### Timer

```
no timer  --start_task(T)-->  T.currentTimestamp = Date.now()
T active  --start_task(U)-->  T stops, U.currentTimestamp = Date.now()
T active  --stop_task()-->    T.currentTimestamp = 0
no timer  --stop_task()-->    no-op (idempotent)
T done    --start_task(T)-->  ERROR: cannot track completed task
```

### Planned for Today filter

```
task.plannedAt = 1714300800000 (today 8am)  --get_tasks(planned_for_today=true)-->  included
task.plannedAt = 1714214400000 (yesterday)  --get_tasks(planned_for_today=true)-->  excluded
task.plannedAt = null                       --get_tasks(planned_for_today=true)-->  excluded
```

### Bulk operations

```
[id1, id2, id3]  --bulk_complete_tasks-->  [{id1, success:true}, {id2, success:true}, {id3, success:true}]
[id1, invalid]   --bulk_complete_tasks-->  [{id1, success:true}, {invalid, success:false, error:"not found"}]
[]               --bulk_complete_tasks-->  []  (empty input = empty result)
```
