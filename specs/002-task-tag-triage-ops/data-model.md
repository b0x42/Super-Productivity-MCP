# Data Model: Task Tag & Triage Operations

**Feature**: Task Tag & Triage Operations
**Created**: 2026-04-20
**Source**: [spec.md](spec.md)

## Entities

### Task

Existing entity extended with fields required for new operations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique task identifier |
| `title` | `string` | Task title |
| `isDone` | `boolean` | Completion state |
| `projectId` | `string \| null` | Owning project (null = Inbox; subtasks inherit parent's project) |
| `parentId` | `string \| null` | Parent task ID if subtask; null for top-level tasks |
| `tagIds` | `string[]` | Ordered list of tag IDs assigned to this task |
| `dueDay` | `string \| null` | Due date as ISO date string (`YYYY-MM-DD`); null = no due date |
| `dueWithTime` | `number \| null` | Scheduled time as Unix ms; null = no scheduled time |
| `plannedAt` | `number \| null` | When the task was planned (internal SP field) |
| `timeEstimate` | `number` | Estimated duration in ms |
| `timeSpent` | `number` | Total time spent in ms |
| `timeSpentOnDay` | `Record<string, number>` | Time spent per ISO date |
| `doneOn` | `number \| null` | Unix ms timestamp when marked done |

**Derived properties** (computed in MCP server, not stored):
- `isSubtask`: `parentId !== null`
- `isOverdue`: `dueDay !== null && dueDay < todayLocalDate`
- `isUnscheduled`: `dueDay === null && dueWithTime === null`

**Constraints**:
- A subtask (`parentId !== null`) MUST NOT have a `projectId` directly assigned
- `tagIds` contains no duplicates; order is insertion order
- `dueDay` format: `YYYY-MM-DD` (local date)

### Tag

Referenced by tasks via `tagIds`. Tags are managed through SP's tag system.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique tag identifier |
| `title` | `string` | Display name |
| `color` | `string \| null` | Hex colour string or null |

**Constraints**:
- Tags are shared across all projects
- A tag ID in `task.tagIds` MUST exist in SP's tag registry

### Project

Top-level container for tasks.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique project identifier |
| `title` | `string` | Display name |
| `taskIds` | `string[]` | Ordered list of top-level task IDs (determines display order) |

**Constraints**:
- Only top-level tasks (`parentId === null`) belong directly to a project
- `project.taskIds` order determines the display/triage order
- SP state management updates `taskIds` automatically when `updateTask({ projectId })` is dispatched

## Command Data Extensions

The following new fields extend the `Command` interface in `src/ipc/types.ts`.

### Existing `Command` fields (for reference)

```typescript
interface Command {
  id: string;
  action: string;
  protocolVersion: number;
  timestamp: number;
  data?: Record<string, unknown>;   // task fields for addTask / updateTask
  taskId?: string;
  projectId?: string;
  tagId?: string;
  message?: string;
  filters?: TaskFilters;
}
```

### New fields added to `Command`

| Field | Type | Used by actions |
|-------|------|----------------|
| `taskIds` | `string[]` | `reorderTasks` — ordered list of task IDs |
| `contextId` | `string` | `reorderTasks` — project ID or parent task ID that owns the tasks |
| `contextType` | `'project' \| 'parent'` | `reorderTasks` — which kind of container `contextId` refers to |

### Extended `TaskFilters`

New fields added to `TaskFilters` in `src/ipc/types.ts`:

| Field | Type | Description |
|-------|------|-------------|
| `parentsOnly` | `boolean \| undefined` | When true, exclude subtasks from results |
| `overdue` | `boolean \| undefined` | When true, return only tasks with `dueDay < today` |
| `unscheduled` | `boolean \| undefined` | When true, return only tasks with no due date and no scheduled time |

**Filter combination semantics**:
- All filters combine with AND logic
- `overdue: true` AND `unscheduled: true` → always empty (mutually exclusive by definition)
- `parentsOnly` is orthogonal and can combine with any date filter

## State Transitions

### Tag list on a Task

```
[A, B]  --add_tag_to_task(C)-->  [A, B, C]
[A, B, C]  --add_tag_to_task(B)-->  [A, B, C]   (idempotent, no error)
[A, B, C]  --remove_tag_from_task(B)-->  [A, C]
[A, C]  --remove_tag_from_task(B)-->  ERROR: tag B not on task
```

### Task project assignment

```
task.projectId = "proj-A"  --move_task_to_project("proj-B")-->  task.projectId = "proj-B"
task.parentId = "parent-X"  --move_task_to_project(any)-->  ERROR: cannot move subtask
```

### Current task (active timer)

```
no timer running  --get_current_task()-->  null
timer started on task T  --get_current_task()-->  Task T
timer stopped  --get_current_task()-->  null
```

Storage mechanism: plugin writes `JSON.stringify(task || null)` to `persistDataSynced` on `currentTaskChange` hook; MCP reads via `loadSyncedData` action.
